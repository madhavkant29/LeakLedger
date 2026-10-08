from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.domain.models import (
    AuditEvent,
    BalanceResult,
    BalanceState,
    EvidenceQuality,
    Incident,
    IncidentEvent,
    IncidentStatus,
    RepairAction,
)
from app.repositories.memory import LocalStore
from app.services.reconciliation import ReconciliationEngine


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class IncidentService:
    def __init__(self, engine: ReconciliationEngine):
        self.engine = engine

    def evaluate(self, store: LocalStore, balances: list[BalanceResult]) -> Incident | None:
        by_id = {b.node_id: b for b in balances}
        active = next((i for i in store.incidents.values() if i.status not in {IncidentStatus.RESOLVED, IncidentStatus.REPAIR_FAILED}), None)

        for b in balances:
            # A physical reconciliation interval may be recalculated several times while
            # sibling meter events arrive. It can advance/reset persistence only once.
            if store.persistence_last_interval.get(b.node_id) == b.interval_end:
                continue
            if b.state == BalanceState.ANOMALOUS and b.evidence_quality == EvidenceQuality.HIGH:
                store.persistence[b.node_id] = store.persistence.get(b.node_id, 0) + 1
                store.persistence_last_interval[b.node_id] = b.interval_end
            elif b.state == BalanceState.BALANCED:
                store.persistence[b.node_id] = 0
                store.persistence_last_interval[b.node_id] = b.interval_end

        if active:
            target = by_id.get(active.node_id)
            if target and target.state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE, BalanceState.STALE}:
                if active.status not in {IncidentStatus.REPAIR_REPORTED, IncidentStatus.VERIFYING}:
                    active.status = IncidentStatus.EVIDENCE_INSUFFICIENT
                    self._event(store, active, "EvidenceInsufficient", "system", target.explanation)
                return active
            if target and active.status == IncidentStatus.EVIDENCE_INSUFFICIENT and target.evidence_quality == EvidenceQuality.HIGH:
                active.status = IncidentStatus.INVESTIGATING
                detail = "Valid readings restored; investigation resumed."
                if target.state == BalanceState.BALANCED:
                    detail += " Current balance is healthy, but the open incident still requires an explicit repair/verification lifecycle or operator disposition."
                self._event(store, active, "EvidenceRestored", "system", detail)
            if target and active.status in {IncidentStatus.REPAIR_REPORTED, IncidentStatus.VERIFYING}:
                self._evaluate_verification(store, active, target)
            return active

        required = self.engine.config.persistence_intervals
        candidates = [
            b for b in balances
            if b.state == BalanceState.ANOMALOUS
            and b.evidence_quality == EvidenceQuality.HIGH
            and store.persistence.get(b.node_id, 0) >= required
        ]
        if not candidates:
            return None

        def depth(node_id: str) -> int:
            d = 0
            node = store.nodes[node_id]
            while node.parent_id is not None:
                d += 1
                node = store.nodes[node.parent_id]
            return d

        start = sorted(candidates, key=lambda b: depth(b.node_id))[0]
        deepest, reason = self.engine.deepest_trustworthy_anomaly(store, balances, start.node_id)
        if not deepest:
            return None
        target_balance = by_id[deepest]
        incident = Incident(
            id=f"LL-{uuid4().hex[:6].upper()}",
            site_id="northbridge",
            node_id=deepest,
            status=IncidentStatus.OPEN,
            opened_at=utcnow(),
            residual_m3=target_balance.residual_m3,
            residual_ratio=target_balance.residual_ratio,
            persistence_count=store.persistence.get(deepest, required),
            evidence_quality=target_balance.evidence_quality,
            deepest_trustworthy_node_id=deepest,
            boundary_explanation=reason,
            verification_required_intervals=store.settings.verification_required_intervals,
        )
        store.incidents[incident.id] = incident
        self._event(store, incident, "IncidentOpened", "system", reason, {"residual_m3": target_balance.residual_m3})
        return incident

    def transition(self, store: LocalStore, incident_id: str, action: str, actor: str) -> Incident:
        incident = store.incidents[incident_id]
        transitions = {
            "acknowledge": ({IncidentStatus.OPEN, IncidentStatus.EVIDENCE_INSUFFICIENT}, IncidentStatus.ACKNOWLEDGED),
            "investigate": ({IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED, IncidentStatus.EVIDENCE_INSUFFICIENT}, IncidentStatus.INVESTIGATING),
        }
        if action not in transitions:
            raise ValueError(f"Unknown incident action {action}")
        allowed, target = transitions[action]
        if incident.status not in allowed:
            raise ValueError(f"Cannot {action} incident from {incident.status.value}")
        incident.status = target
        self._event(store, incident, "IncidentStateChanged", actor, f"Incident moved to {target.value}.", {"status": target.value})
        return incident

    def record_repair(self, store: LocalStore, incident_id: str, repair: RepairAction) -> Incident:
        incident = store.incidents[incident_id]
        if incident.status not in {IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED, IncidentStatus.INVESTIGATING, IncidentStatus.EVIDENCE_INSUFFICIENT}:
            raise ValueError(f"Cannot report repair from {incident.status.value}")
        incident.repair = repair
        incident.status = IncidentStatus.VERIFYING
        incident.pre_repair_residual_rate = incident.residual_m3
        incident.verification_valid_intervals = 0
        incident.verification_required_intervals = store.settings.verification_required_intervals
        incident.post_repair_residuals = []
        incident.verification_last_interval_end = None
        self._event(store, incident, "RepairReported", repair.actor, "Repair recorded. LeakLedger will verify subsequent valid intervals.", {"repair": repair.repair_type, "location": repair.location})
        return incident

    def _evaluate_verification(self, store: LocalStore, incident: Incident, target_balance: BalanceResult) -> None:
        if incident.verification_last_interval_end == target_balance.interval_end:
            return
        if target_balance.evidence_quality != EvidenceQuality.HIGH or target_balance.state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE, BalanceState.STALE}:
            self._event(store, incident, "VerificationPaused", "system", "Verification interval ignored because evidence quality is insufficient.")
            return
        incident.verification_last_interval_end = target_balance.interval_end
        incident.status = IncidentStatus.VERIFYING
        incident.post_repair_residuals.append(target_balance.residual_m3)
        if target_balance.state == BalanceState.BALANCED:
            incident.verification_valid_intervals += 1
            self._event(
                store,
                incident,
                "VerificationInterval",
                "system",
                f"Healthy verification interval {incident.verification_valid_intervals}/{incident.verification_required_intervals}.",
                {"residual_m3": target_balance.residual_m3, "streak": incident.verification_valid_intervals},
            )
            if incident.verification_valid_intervals >= incident.verification_required_intervals:
                incident.status = IncidentStatus.RESOLVED
                self._event(store, incident, "RepairVerified", "system", "Required healthy intervals observed; repair verified.")
        else:
            incident.verification_valid_intervals = 0
            self._event(store, incident, "VerificationFailedInterval", "system", f"Residual remains {target_balance.residual_m3:.3f} m³; verification streak reset.", {"residual_m3": target_balance.residual_m3})
            recent = incident.post_repair_residuals[-incident.verification_required_intervals:]
            if len(recent) == incident.verification_required_intervals and all(v >= self.engine.config.minimum_residual_m3 for v in recent):
                incident.status = IncidentStatus.REPAIR_FAILED
                self._event(store, incident, "RepairFailed", "system", "Reported repair did not restore the water balance.")

    @staticmethod
    def _event(store: LocalStore, incident: Incident, event_type: str, actor: str, detail: str, payload: dict | None = None) -> None:
        ts = utcnow()
        event = IncidentEvent(timestamp=ts, event_type=event_type, actor=actor, detail=detail, payload=payload or {})
        incident.events.append(event)
        store.audit.append(AuditEvent(
            timestamp=ts,
            event_type=event_type,
            detail=f"{incident.id}: {detail}",
            actor=actor,
            correlation_id=incident.id,
            payload={"incident_id": incident.id, **(payload or {})},
        ))
