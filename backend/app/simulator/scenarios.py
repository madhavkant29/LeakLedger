from __future__ import annotations

from app.domain.models import AuditEvent
from app.repositories.memory import LocalStore
from app.services.incidents import IncidentService
from app.services.reconciliation import ReconciliationEngine
from app.simulator.generator import demo_timestamp, generate_snapshot, initial_counters


class DemoSimulator:
    def __init__(self, store: LocalStore, engine: ReconciliationEngine, incidents: IncidentService):
        self.store = store
        self.engine = engine
        self.incidents = incidents
        meter_ids = [m.id for m in self.store.nodes.values() if m.kind.value == "METER"]
        self.counters: dict[str, float] = initial_counters(meter_ids)

    def reset(self, scenario: str = "normal") -> None:
        self.store.reset()
        self.store.scenario = scenario
        meter_ids = [m.id for m in self.store.nodes.values() if m.kind.value == "METER"]
        self.counters = initial_counters(meter_ids)
        self._emit_snapshot(step=0)
        self.store.scenario_step = 0
        self.store.audit.append(AuditEvent(timestamp=demo_timestamp(0), event_type="DemoReset", detail=f"Scenario reset to {scenario}."))

    def step(self) -> dict:
        self.store.scenario_step += 1
        step = self.store.scenario_step
        self._emit_snapshot(step)
        balances = self.engine.reconcile_all(self.store)
        incident = self.incidents.evaluate(self.store, balances)
        self._audit_balances(balances)
        return {
            "step": step,
            "timestamp": demo_timestamp(step),
            "balances": balances,
            "incident": incident,
        }

    def _emit_snapshot(self, step: int) -> None:
        repair_reported = any(i.repair is not None for i in self.store.incidents.values())
        snapshot = generate_snapshot(
            scenario=self.store.scenario,
            step=step,
            counters=self.counters,
            repair_reported=repair_reported,
        )
        self.counters = snapshot.counters
        for reading in snapshot.readings:
            self._ingest(reading)

    def _ingest(self, reading) -> None:
        if reading.event_id in self.store.processed_event_ids:
            return
        self.store.processed_event_ids.add(reading.event_id)
        self.store.readings[reading.meter_id].append(reading)
        self.store.audit.append(AuditEvent(
            timestamp=reading.timestamp,
            event_type="MeterReadingReceived",
            detail=f"{reading.meter_id} = {reading.cumulative_m3:.3f} m³",
            correlation_id=reading.event_id,
            payload={"meter_id": reading.meter_id, "event_id": reading.event_id},
        ))

    def _audit_balances(self, balances) -> None:
        for balance in balances:
            self.store.audit.append(AuditEvent(
                timestamp=balance.interval_end,
                event_type="ReconciliationCompleted",
                detail=f"{balance.node_id}: {balance.state.value}; residual {balance.residual_m3:.3f} m³.",
                correlation_id=f"reconcile-{balance.interval_end}-{balance.node_id}",
                payload={
                    "node_id": balance.node_id,
                    "state": balance.state.value,
                    "evidence_quality": balance.evidence_quality.value,
                    "residual_m3": balance.residual_m3,
                },
            ))
