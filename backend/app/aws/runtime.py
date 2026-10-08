from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from datetime import datetime
from typing import Any
from uuid import uuid4

from app.aws.services import CloudWatchMetrics, EventBridgePublisher, S3RawEventArchive
from app.domain.models import AuditEvent, MeterReading, NodeKind, SiteSettings, to_dict
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


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@contextmanager
def site_write_lock(runtime: "AwsRuntime", site_id: str, attempts: int = 40, wait_seconds: float = 0.25):
    """Serialize load-modify-save mutations for one site using the repository lock.

    Repositories without lock support (in-memory test fakes) run unlocked.
    """
    acquire = getattr(runtime.repository, "acquire_write_lock", None)
    release = getattr(runtime.repository, "release_write_lock", None)
    owner = uuid4().hex
    acquired = False
    if acquire is not None:
        acquired = acquire(site_id, owner, ttl_seconds=120, attempts=attempts, wait_seconds=wait_seconds)
        if not acquired:
            raise TimeoutError("site write lock not acquired; another writer is active")
    try:
        yield
    finally:
        if acquired and release is not None:
            release(site_id, owner)


class AwsRuntime:
    # EventBridge -> SQS delivery can split one physical interval across several
    # Lambda invocations. A batch waits briefly for its sibling meters so a complete
    # interval is reconciled once; if the interval never completes (a genuinely
    # missing meter), the deadline expires and fail-closed evaluation still happens.
    SETTLE_TIMEOUT_SECONDS = 8.0
    SETTLE_POLL_SECONDS = 0.75

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
        for reading in readings:
            if self.repository.claim_event(site_id, reading.event_id):
                claimed.append(reading)
            else:
                duplicates += 1
                self.metrics.increment("DuplicateEventsIgnored", site_id=site_id)
        if not claimed:
            return {"processed": 0, "duplicates": duplicates, "balances": 0, "incident": None}
        deadline = time.time() + self.SETTLE_TIMEOUT_SECONDS
        appended_total: list[MeterReading] = []
        already_total = 0
        stale_total = 0
        superseded_total = 0
        result: dict[str, Any] | None = None
        try:
            while result is None:
                with site_write_lock(self, site_id):
                    store = self.repository.load_store(site_id)
                    demo_state = self.repository.get_demo_state(site_id)
                    generation = demo_state.get("generation") if demo_state else None
                    appended, already, stale, superseded = self._append_readings(store, claimed, generation)
                    appended_total.extend(appended)
                    already_total += already
                    stale_total += stale
                    superseded_total += superseded
                    if appended:
                        self.repository.save_store(store, site_id)
                    newest = self._site_newest_timestamp(store)
                    newest_complete = newest is not None and self._interval_complete(store, newest)
                    if newest_complete or time.time() >= deadline:
                        result = self._reconcile_locked(site_id, store, claimed, started, duplicates, appended_total, already_total, stale_total, superseded_total)
                if result is None:
                    time.sleep(self.SETTLE_POLL_SECONDS)
        except Exception:
            for reading in claimed:
                self.repository.release_event(site_id, reading.event_id)
            raise
        return result

    def _reconcile_locked(self, site_id, store, claimed, started, duplicates, appended_total, already_total, stale_total, superseded_total) -> dict[str, Any]:
        engine = engine_for(store.settings)
        incident_service = IncidentService(engine)
        before = {i.id: i.status.value for i in store.incidents.values()}
        balances = engine.reconcile_all(store, require_reading_pairs=True)
        incident = incident_service.evaluate(store, balances)
        correlation_id = f"batch:{claimed[0].timestamp}:{claimed[0].event_id}"
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
        for reading in claimed:
            store.processed_event_ids.add(reading.event_id)
        self.repository.save_store(store, site_id)
        for reading in claimed:
            self.repository.mark_event_done(site_id, reading.event_id)

        self.metrics.increment("ReadingsProcessed", value=len(appended_total), site_id=site_id)
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
        return {
            "processed": len(appended_total),
            "duplicates": duplicates + already_total,
            "balances": len(balances),
            "incident": to_dict(incident) if incident else None,
            "stale": stale_total,
            "superseded": superseded_total,
        }

    @staticmethod
    def _interval_complete(store, timestamp: str) -> bool:
        for node in store.nodes.values():
            if node.kind != NodeKind.METER:
                continue
            if not any(r.timestamp == timestamp for r in store.readings.get(node.id, [])):
                return False
        return True

    @staticmethod
    def _site_newest_timestamp(store) -> str | None:
        newest_ts: str | None = None
        newest_parsed: datetime | None = None
        for node in store.nodes.values():
            if node.kind != NodeKind.METER:
                continue
            rows = store.readings.get(node.id, [])
            if not rows:
                continue
            parsed = _parse_ts(rows[-1].timestamp)
            if newest_parsed is None or parsed > newest_parsed:
                newest_parsed = parsed
                newest_ts = rows[-1].timestamp
        return newest_ts

    def _append_readings(self, store, claimed: list[MeterReading], current_generation: str | None = None) -> tuple[list[MeterReading], int, int, int]:
        """Append only readings that advance the ledger for their meter.

        Returns (appended, already_persisted, stale, superseded). SQS standard queues can
        deliver siblings out of order and can deliver messages from a previous demo
        generation after a reset; out-of-order readings are inserted in timestamp order so
        the interval pair stays correct, while previous-generation readings are ignored.
        Idempotency records are only marked done in the final reconcile step so a crash
        mid-settle cannot lose events.
        """
        appended: list[MeterReading] = []
        already_persisted = 0
        stale = 0
        superseded = 0
        for reading in claimed:
            if current_generation and self._is_superseded(reading.event_id, current_generation):
                superseded += 1
                continue
            if reading.meter_id not in store.nodes:
                raise ValueError(f"Unknown meter {reading.meter_id}")
            rows = store.readings.get(reading.meter_id, [])
            if reading.event_id in store.processed_event_ids or any(r.event_id == reading.event_id for r in rows):
                already_persisted += 1
                continue
            rows.append(reading)
            rows.sort(key=lambda x: (x.timestamp, x.event_id))
            store.readings[reading.meter_id] = rows
            appended.append(reading)
            store.audit.append(AuditEvent(
                timestamp=reading.timestamp,
                event_type="MeterReadingReceived",
                detail=f"{reading.meter_id} = {reading.cumulative_m3:.3f} m³",
                correlation_id=reading.event_id,
                payload={"meter_id": reading.meter_id, "event_id": reading.event_id, "source": reading.source},
            ))
        return appended, already_persisted, stale, superseded

    @staticmethod
    def _is_superseded(event_id: str, current_generation: str) -> bool:
        parts = event_id.split("-")
        if len(parts) >= 3 and parts[0] == "demo" and len(parts[1]) == 8 and all(c in "0123456789abcdef" for c in parts[1]):
            return parts[1] != current_generation
        return False

    def reset_demo(self, scenario: str, site_id: str = "northbridge") -> dict[str, Any]:
        self.ensure_seed(site_id)
        with site_write_lock(self, site_id):
            state = self._reset_demo_locked(scenario, site_id)
            readings = self._draw_snapshot(state, site_id)
            self.repository.save_demo_state(state, site_id)
        for reading in readings:
            self.ingest_async(reading)
        return state

    def _reset_demo_locked(self, scenario: str, site_id: str) -> dict[str, Any]:
        self.repository.clear_operational_state(site_id)
        store = self.repository.load_store(site_id)
        meter_ids = [n.id for n in store.nodes.values() if n.kind.value == "METER"]
        return {
            "scenario": scenario,
            "step": 0,
            "running": False,
            "counters": initial_counters(meter_ids),
            "generation": uuid4().hex[:8],
        }

    def step_demo(self, site_id: str = "northbridge") -> dict[str, Any]:
        with site_write_lock(self, site_id):
            state = self.repository.get_demo_state(site_id)
            if not state:
                state = self._reset_demo_locked("normal", site_id)
            state["step"] = int(state.get("step", 0)) + 1
            readings = self._draw_snapshot(state, site_id)
            self.repository.save_demo_state(state, site_id)
        for reading in readings:
            self.ingest_async(reading)
        return state

    def _draw_snapshot(self, state: dict[str, Any], site_id: str) -> list[MeterReading]:
        store = self.repository.load_store(site_id)
        repair_reported = any(i.repair is not None for i in store.incidents.values())
        snapshot = generate_snapshot(
            scenario=state["scenario"],
            step=int(state["step"]),
            counters={k: float(v) for k, v in state["counters"].items()},
            repair_reported=repair_reported,
            site_id=site_id,
            generation=state.get("generation", ""),
        )
        state["counters"] = snapshot.counters
        return snapshot.readings
