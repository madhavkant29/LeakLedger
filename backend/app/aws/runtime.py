from __future__ import annotations

import logging
import os
import time
from typing import Any

from app.aws.services import CloudWatchMetrics, EventBridgePublisher, S3RawEventArchive
from app.domain.models import AuditEvent, MeterReading, SiteSettings, to_dict
from app.repositories.dynamodb import DynamoDbStateRepository
from app.services.incidents import IncidentService
from app.services.reconciliation import ReconciliationConfig, ReconciliationEngine
from app.simulator.generator import generate_snapshot, initial_counters

logger = logging.getLogger(__name__)


def engine_for(settings: SiteSettings) -> ReconciliationEngine:
    return ReconciliationEngine(ReconciliationConfig(
        minimum_residual_m3=settings.minimum_residual_m3,
        minimum_residual_ratio=settings.minimum_residual_ratio,
        persistence_intervals=settings.persistence_intervals,
        minimum_coverage=settings.minimum_coverage,
        freshness_limit_seconds=settings.freshness_limit_seconds,
        alignment_tolerance_seconds=settings.alignment_tolerance_seconds,
    ))


class AwsRuntime:
    def __init__(
        self,
        repository: DynamoDbStateRepository | None = None,
        archive: S3RawEventArchive | None = None,
        events: EventBridgePublisher | None = None,
        metrics: CloudWatchMetrics | None = None,
    ):
        region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
        self.repository = repository or DynamoDbStateRepository(os.environ["STATE_TABLE"], region_name=region)
        self.archive = archive or S3RawEventArchive(os.environ["RAW_BUCKET"])
        self.events = events or EventBridgePublisher(os.environ["EVENT_BUS"])
        self.metrics = metrics or CloudWatchMetrics()

    def ensure_seed(self, site_id: str = "northbridge") -> None:
        self.repository.ensure_seed(site_id)

    def ingest_async(self, reading: MeterReading) -> dict[str, Any]:
        self.ensure_seed(reading.site_id)
        if self.repository.is_processed(reading.site_id, reading.event_id):
            self.metrics.increment("DuplicateEventsIgnored", site_id=reading.site_id)
            return {"accepted": False, "duplicate": True, "queued": False}
        archive_key = self.archive.archive(reading)
        eventbridge_id = self.events.publish_meter_reading(reading)
        return {"accepted": True, "duplicate": False, "queued": True, "archive_key": archive_key, "eventbridge_event_id": eventbridge_id}

    def process_reading(self, reading: MeterReading) -> dict[str, Any]:
        """Compatibility helper for a single SQS event; worker batches should use process_readings."""
        return self.process_readings([reading])

    def process_readings(self, readings: list[MeterReading]) -> dict[str, Any]:
        if not readings:
            return {"processed": 0, "duplicates": 0, "balances": 0, "incident": None}
        site_ids = {r.site_id for r in readings}
        if len(site_ids) != 1:
            raise ValueError("A reconciliation batch must contain exactly one site")
        site_id = next(iter(site_ids))
        started = time.perf_counter()
        self.ensure_seed(site_id)
        claimed: list[MeterReading] = []
        duplicates = 0
        try:
            for reading in readings:
                if self.repository.claim_event(site_id, reading.event_id):
                    claimed.append(reading)
                else:
                    duplicates += 1
                    self.metrics.increment("DuplicateEventsIgnored", site_id=site_id)
            if not claimed:
                return {"processed": 0, "duplicates": duplicates, "balances": 0, "incident": None}

            store = self.repository.load_store(site_id)
            correlation_id = f"batch:{claimed[0].timestamp}:{claimed[0].event_id}"
            for reading in claimed:
                if reading.meter_id not in store.nodes:
                    raise ValueError(f"Unknown meter {reading.meter_id}")
                store.processed_event_ids.add(reading.event_id)
                store.readings[reading.meter_id].append(reading)
                store.readings[reading.meter_id].sort(key=lambda x: (x.timestamp, x.event_id))
                store.audit.append(AuditEvent(
                    timestamp=reading.timestamp,
                    event_type="MeterReadingReceived",
                    detail=f"{reading.meter_id} = {reading.cumulative_m3:.3f} m³",
                    correlation_id=reading.event_id,
                    payload={"meter_id": reading.meter_id, "event_id": reading.event_id, "source": reading.source},
                ))

            engine = engine_for(store.settings)
            incident_service = IncidentService(engine)
            before = {i.id: i.status.value for i in store.incidents.values()}
            balances = engine.reconcile_all(store)
            incident = incident_service.evaluate(store, balances)
            for balance in balances:
                store.audit.append(AuditEvent(
                    timestamp=balance.interval_end,
                    event_type="ReconciliationCompleted",
                    detail=f"{balance.node_id}: {balance.state.value}; residual {balance.residual_m3:.3f} m³.",
                    correlation_id=correlation_id,
                    payload={"node_id": balance.node_id, "state": balance.state.value, "evidence_quality": balance.evidence_quality.value, "residual_m3": balance.residual_m3},
                ))
            for item in store.incidents.values():
                item.verification_required_intervals = store.settings.verification_required_intervals
            self.repository.save_store(store, site_id)
            for reading in claimed:
                self.repository.mark_event_done(site_id, reading.event_id)

            self.metrics.increment("ReadingsProcessed", value=len(claimed), site_id=site_id)
            self.metrics.increment("ReconciliationsCompleted", value=len(balances), site_id=site_id)
            self.metrics.increment("BalanceViolations", value=sum(1 for b in balances if b.state.value == "ANOMALOUS"), site_id=site_id)
            self.metrics.increment("DataQualityFailures", value=sum(1 for b in balances if b.state.value in {"DATA_QUALITY_FAILURE", "INSUFFICIENT_DATA", "STALE"}), site_id=site_id)
            after = {i.id: i.status.value for i in store.incidents.values()}
            for incident_id, status in after.items():
                previous = before.get(incident_id)
                if previous is None:
                    self.metrics.increment("IncidentsOpened", site_id=site_id)
                    self.events.publish_domain_event("IncidentOpened", site_id, {"incident_id": incident_id, "status": status})
                elif previous != status and status == "RESOLVED":
                    self.metrics.increment("RepairsVerified", site_id=site_id)
                    self.events.publish_domain_event("RepairVerified", site_id, {"incident_id": incident_id})
                elif previous != status and status == "REPAIR_FAILED":
                    self.metrics.increment("RepairsFailed", site_id=site_id)
                    self.events.publish_domain_event("RepairFailed", site_id, {"incident_id": incident_id})
            self.metrics.timing("ProcessingLatency", (time.perf_counter() - started) * 1000.0, site_id=site_id)
            return {"processed": len(claimed), "duplicates": duplicates, "balances": len(balances), "incident": to_dict(incident) if incident else None}
        except Exception:
            for reading in claimed:
                self.repository.release_event(site_id, reading.event_id)
            raise

    def reset_demo(self, scenario: str, site_id: str = "northbridge") -> dict[str, Any]:
        self.ensure_seed(site_id)
        self.repository.clear_operational_state(site_id)
        store = self.repository.load_store(site_id)
        meter_ids = [n.id for n in store.nodes.values() if n.kind.value == "METER"]
        state = {"scenario": scenario, "step": 0, "running": False, "counters": initial_counters(meter_ids)}
        self.repository.save_demo_state(state, site_id)
        self._publish_demo_snapshot(state, site_id)
        return state

    def step_demo(self, site_id: str = "northbridge") -> dict[str, Any]:
        state = self.repository.get_demo_state(site_id) or self.reset_demo("normal", site_id)
        state["step"] = int(state.get("step", 0)) + 1
        self._publish_demo_snapshot(state, site_id)
        self.repository.save_demo_state(state, site_id)
        return state

    def _publish_demo_snapshot(self, state: dict[str, Any], site_id: str) -> None:
        store = self.repository.load_store(site_id)
        repair_reported = any(i.repair is not None for i in store.incidents.values())
        snapshot = generate_snapshot(
            scenario=state["scenario"],
            step=int(state["step"]),
            counters={k: float(v) for k, v in state["counters"].items()},
            repair_reported=repair_reported,
            site_id=site_id,
        )
        state["counters"] = snapshot.counters
        for reading in snapshot.readings:
            self.ingest_async(reading)
