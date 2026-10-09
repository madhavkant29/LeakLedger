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
            # An interval may be recalculated while sibling meter events arrive, and
            # out-of-order delivery can present older intervals later. Persistence may
            # only advance or reset for intervals newer than the last one processed.
            last = store.persistence_last_interval.get(b.node_id)
            if last is not None and b.interval_end <= last:
                continue
            if b.state == BalanceState.ANOMALOUS and b.evidence_quality == EvidenceQuality.HIGH:
                store.persistence[b.node_id] = store.persistence.get(b.node_id, 0) + 1
                store.persistence_last_interval[b.node_id] = b.interval_end
            elif b.state == BalanceState.BALANCED:
                store.persistence[b.node_id] = 0
                store.persistence_last_interval[b.node_id] = b.interval_end

        if active:
            target = by_id.get(active.node_id)
            if target is None:
                return active
            basis = active.status_basis_interval_end
            stale_interval = basis is not None and target.interval_end < basis
            if target.state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE, BalanceState.STALE}:
                if active.status in {IncidentStatus.REPAIR_REPORTED, IncidentStatus.VERIFYING}:
                    # Verification is in progress: record that this interval could not be
                    # evaluated instead of silently skipping it.
                    self._evaluate_verification(store, active, target)
                    return active
                if stale_interval:
                    return active
                if active.status != IncidentStatus.EVIDENCE_INSUFFICIENT:
                    active.pre_evidence_status = active.status.value
                if basis is None or target.interval_end > basis:
                    active.status_basis_interval_end = target.interval_end
                    self._event(store, active, "EvidenceInsufficient", "system", target.explanation)
                active.status = IncidentStatus.EVIDENCE_INSUFFICIENT
                return active
            if active.status == IncidentStatus.EVIDENCE_INSUFFICIENT and target.evidence_quality == EvidenceQuality.HIGH:
                # Only evidence at or after the interval that caused the pause can
                # restore localisation; a late-arriving older interval cannot.
                if stale_interval:
                    return active
                restored = IncidentStatus.INVESTIGATING
                if active.pre_evidence_status in {IncidentStatus.OPEN.value, IncidentStatus.ACKNOWLEDGED.value, IncidentStatus.INVESTIGATING.value}:
                    restored = IncidentStatus(active.pre_evidence_status)
                active.pre_evidence_status = None
                active.status = restored
                active.status_basis_interval_end = target.interval_end
                detail = f"Valid readings restored; incident returned to {restored.value}."
                if target.state == BalanceState.BALANCED:
                    detail += " Current balance is healthy, but the open incident still requires an explicit repair/verification lifecycle or operator disposition."
                self._event(store, active, "EvidenceRestored", "system", detail)
            if active.status in {IncidentStatus.REPAIR_REPORTED, IncidentStatus.VERIFYING}:
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
            status_basis_interval_end=target_balance.interval_end,
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
        incident.verification_evidence = {}
        self._event(store, incident, "RepairReported", repair.actor, "Repair recorded. LeakLedger will verify subsequent valid intervals.", {"repair": repair.repair_type, "location": repair.location})
        return incident

    def _evaluate_verification(self, store: LocalStore, incident: Incident, target_balance: BalanceResult) -> None:
        interval = target_balance.interval_end
        # Only intervals that end after the repair was recorded may count toward the
        # verification streak; out-of-order delivery must not verify a repair with
        # pre-repair evidence.
        if incident.verification_floor_interval_end and interval <= incident.verification_floor_interval_end:
            return
        insufficient = (
            target_balance.evidence_quality != EvidenceQuality.HIGH
            or target_balance.state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE, BalanceState.STALE}
        )
        valid = (not insufficient) and target_balance.state == BalanceState.BALANCED
        record = {"residual": target_balance.residual_m3, "valid": bool(valid), "state": target_balance.state.value}
        evidence = dict(incident.verification_evidence or {})
        if evidence.get(interval) == record:
            return
        evidence[interval] = record
        incident.verification_evidence = evidence

        # Recompute the streak from interval order rather than arrival order, so burst
        # or out-of-order delivery cannot skip or double-count a verification interval.
        keys = sorted(evidence)
        streak = 0
        for key in reversed(keys):
            if evidence[key]["valid"]:
                streak += 1
            else:
                break
        incident.post_repair_residuals = [float(evidence[key]["residual"]) for key in keys]
        incident.verification_valid_intervals = streak
        incident.verification_last_interval_end = keys[-1] if keys else None
        incident.status = IncidentStatus.VERIFYING

        if insufficient:
            self._event(store, incident, "VerificationPaused", "system", "Verification interval ignored because evidence quality is insufficient.")
            return
        if valid:
            self._event(
                store,
                incident,
                "VerificationInterval",
                "system",
                f"Healthy verification interval {streak}/{incident.verification_required_intervals}.",
                {"residual_m3": target_balance.residual_m3, "streak": streak},
            )
            if streak >= incident.verification_required_intervals:
                incident.status = IncidentStatus.RESOLVED
                self._event(store, incident, "RepairVerified", "system", "Required healthy intervals observed; repair verified.")
            return
        self._event(store, incident, "VerificationFailedInterval", "system", f"Residual remains {target_balance.residual_m3:.3f} m³; verification streak reset.", {"residual_m3": target_balance.residual_m3})
        recent = [evidence[key] for key in keys[-incident.verification_required_intervals:]]
        if len(recent) == incident.verification_required_intervals and all(
            (not entry["valid"]) and entry["residual"] >= self.engine.config.minimum_residual_m3 for entry in recent
        ):
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
