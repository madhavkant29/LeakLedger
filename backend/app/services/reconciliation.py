from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from app.domain.models import (
    BalanceResult,
    BalanceState,
    EvidenceQuality,
    MeterNode,
    NodeKind,
)
from app.repositories.memory import LocalStore
from app.services.topology import children


@dataclass
class ReconciliationConfig:
    minimum_residual_m3: float = 0.05
    minimum_residual_ratio: float = 0.08
    persistence_intervals: int = 3
    minimum_coverage: float = 0.85
    freshness_limit_seconds: int = 1800
    alignment_tolerance_seconds: int = 120


class ReconciliationEngine:
    def __init__(self, config: ReconciliationConfig | None = None):
        self.config = config or ReconciliationConfig()

    @staticmethod
    def _parse(ts: str) -> datetime:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)

    def _pair_at(self, store: LocalStore, meter_id: str, interval_end: str, expected_previous: str | None = None):
        """Return the (previous, current) readings for the interval ending at interval_end.

        When expected_previous is supplied, the predecessor must be that exact interval
        boundary. A meter with a gap before interval_end is treated as missing a reading
        pair so parent/child volumes are never compared across different periods.
        """
        rows = store.readings.get(meter_id, [])
        for i, reading in enumerate(rows):
            if reading.timestamp == interval_end:
                if i < 1:
                    return None
                previous = rows[i - 1]
                if expected_previous is not None and self._parse(previous.timestamp) != self._parse(expected_previous):
                    return None
                return (previous, reading)
        return None

    @staticmethod
    def _reading_at(store: LocalStore, meter_id: str, interval_end: str):
        for reading in store.readings.get(meter_id, []):
            if reading.timestamp == interval_end:
                return reading
        return None

    def _interval_volume(self, store: LocalStore, meter_id: str, interval_end: str | None = None, expected_previous: str | None = None) -> tuple[Optional[float], str | None]:
        if interval_end is not None:
            pair = self._pair_at(store, meter_id, interval_end, expected_previous)
            if pair is None:
                return None, "missing reading pair"
            before, after = pair
        else:
            readings = store.latest_two(meter_id)
            if len(readings) < 2:
                return None, "missing reading pair"
            before, after = readings
        delta = after.cumulative_m3 - before.cumulative_m3
        if delta < -1e-9:
            return None, "counter reset detected"
        return delta, None

    def reconcile_node(self, store: LocalStore, node: MeterNode, interval_end: str | None = None, expected_previous: str | None = None) -> BalanceResult:
        if interval_end is not None:
            pair = self._pair_at(store, node.id, interval_end, expected_previous)
            latest = self._reading_at(store, node.id, interval_end)
            now_ts = interval_end
            start_ts = pair[0].timestamp if pair else interval_end
        else:
            latest = store.latest(node.id)
            previous = store.latest_two(node.id)
            now_ts = latest.timestamp if latest else datetime.now(timezone.utc).isoformat()
            start_ts = previous[0].timestamp if len(previous) == 2 else now_ts

        if node.kind == NodeKind.UNMETERED:
            return BalanceResult(
                node_id=node.id,
                interval_start=start_ts,
                interval_end=now_ts,
                inflow_m3=0,
                measured_children_m3=0,
                known_unmetered_m3=node.known_unmetered_m3_per_interval,
                storage_change_m3=0,
                residual_m3=0,
                residual_ratio=0,
                coverage=0,
                completeness=1,
                freshness_seconds=0,
                alignment_valid=True,
                state=BalanceState.UNMETERED,
                evidence_quality=EvidenceQuality.INSUFFICIENT,
                explanation="This branch is explicitly modelled as unmetered and is never treated as unexplained loss.",
            )

        inflow, parent_err = self._interval_volume(store, node.id, interval_end, expected_previous)
        child_nodes = children(store.nodes, node.id)
        measured_children = [c for c in child_nodes if c.kind == NodeKind.METER]
        unmetered_children = [c for c in child_nodes if c.kind == NodeKind.UNMETERED]

        # A terminal meter represents accounted end-use. It has no downstream boundary to reconcile.
        if not child_nodes:
            terminal_volume, terminal_err = self._interval_volume(store, node.id, interval_end, expected_previous)
            if terminal_err:
                return BalanceResult(
                    node_id=node.id, interval_start=start_ts, interval_end=now_ts,
                    inflow_m3=0, measured_children_m3=0, known_unmetered_m3=0, storage_change_m3=0,
                    residual_m3=0, residual_ratio=0, coverage=1.0, completeness=0.0, freshness_seconds=0,
                    alignment_valid=True, state=BalanceState.INSUFFICIENT_DATA,
                    evidence_quality=EvidenceQuality.INSUFFICIENT,
                    explanation=f"Terminal consumption meter cannot form an interval: {terminal_err}."
                )
            if node.buffered:
                return BalanceResult(
                    node_id=node.id, interval_start=start_ts, interval_end=now_ts,
                    inflow_m3=round(terminal_volume or 0.0, 6), measured_children_m3=round(terminal_volume or 0.0, 6),
                    known_unmetered_m3=0, storage_change_m3=0, residual_m3=0, residual_ratio=0,
                    coverage=1.0, completeness=1.0, freshness_seconds=0, alignment_valid=True,
                    state=BalanceState.BUFFERED, evidence_quality=EvidenceQuality.MEDIUM,
                    explanation=f"{terminal_volume or 0.0:.3f} m³ crossed a buffered/storage node. Instantaneous downstream localisation is intentionally reduced unless storage level change is supplied."
                )
            return BalanceResult(
                node_id=node.id, interval_start=start_ts, interval_end=now_ts,
                inflow_m3=round(terminal_volume or 0.0, 6), measured_children_m3=round(terminal_volume or 0.0, 6),
                known_unmetered_m3=0, storage_change_m3=0, residual_m3=0, residual_ratio=0,
                coverage=1.0, completeness=1.0, freshness_seconds=0, alignment_valid=True,
                state=BalanceState.BALANCED, evidence_quality=EvidenceQuality.HIGH,
                explanation=f"Terminal consumption meter accounts for {terminal_volume or 0.0:.3f} m³ in this interval."
            )

        child_volumes: list[float] = []
        child_errors: list[str] = []
        child_latest_times: list[datetime] = []
        for child in measured_children:
            volume, err = self._interval_volume(store, child.id, interval_end, expected_previous)
            if err:
                child_errors.append(f"{child.label}: {err}")
            else:
                child_volumes.append(volume or 0.0)
                child_reading = self._reading_at(store, child.id, interval_end) if interval_end is not None else store.latest(child.id)
                if child_reading:
                    child_latest_times.append(self._parse(child_reading.timestamp))

        completeness = 1.0
        required_count = 1 + len(measured_children)
        available_count = (0 if parent_err else 1) + len(child_volumes)
        if required_count:
            completeness = available_count / required_count

        known_unmetered = sum(c.known_unmetered_m3_per_interval for c in unmetered_children)
        inflow_value = inflow or 0.0
        measured_sum = sum(child_volumes)

        # Coverage estimates the proportion of parent flow explicitly represented downstream.
        denominator = max(inflow_value, 0.0001)
        coverage = min(1.0, max(0.0, (measured_sum + known_unmetered) / denominator)) if inflow_value > 0 else 1.0

        alignment_valid = True
        if latest and child_latest_times:
            p = self._parse(latest.timestamp)
            max_skew = max(abs((p - t).total_seconds()) for t in child_latest_times)
            alignment_valid = max_skew <= self.config.alignment_tolerance_seconds

        # Freshness is measured against the newest observation in the site rather than wall-clock time.
        # When reconciling a specific historical interval, freshness is measured against that
        # interval so out-of-order processing cannot mark a valid interval as stale.
        if interval_end is not None:
            reference_time = self._parse(interval_end)
        else:
            site_latest_times = [self._parse(r[-1].timestamp) for r in store.readings.values() if r]
            reference_time = max(site_latest_times) if site_latest_times else (self._parse(latest.timestamp) if latest else datetime.now(timezone.utc))
        freshness_seconds = 0.0
        if latest:
            freshness_seconds = max(0.0, (reference_time - self._parse(latest.timestamp)).total_seconds())

        storage_change = getattr(node, "storage_change_m3_per_interval", None) or 0.0
        residual = inflow_value - measured_sum - known_unmetered - storage_change
        residual_ratio = residual / inflow_value if inflow_value > 0 else 0.0

        # A negative residual is a data-quality issue, not "negative leakage".
        if freshness_seconds > self.config.freshness_limit_seconds:
            state = BalanceState.STALE
            quality = EvidenceQuality.INSUFFICIENT
            explanation = f"Latest reading is {freshness_seconds:.0f}s behind the newest site observation; leak classification is suspended."
        elif parent_err or child_errors:
            state = BalanceState.INSUFFICIENT_DATA
            quality = EvidenceQuality.INSUFFICIENT
            explanation = "; ".join([x for x in [parent_err, *child_errors] if x]) or "Required readings unavailable."
        elif not alignment_valid:
            state = BalanceState.DATA_QUALITY_FAILURE
            quality = EvidenceQuality.INSUFFICIENT
            explanation = "Required readings are not sufficiently time-aligned; leak classification is suspended."
        elif residual < -max(self.config.minimum_residual_m3, 0.01):
            state = BalanceState.DATA_QUALITY_FAILURE
            quality = EvidenceQuality.INSUFFICIENT
            explanation = "Measured downstream volume exceeds parent inflow. Check topology, units, timestamps, or counter epochs."
        elif node.buffered:
            state = BalanceState.BUFFERED
            quality = EvidenceQuality.MEDIUM
            explanation = "This node contains storage/buffering. Instantaneous balance is informational unless storage change is supplied."
        elif completeness < 1.0:
            state = BalanceState.INSUFFICIENT_DATA
            quality = EvidenceQuality.INSUFFICIENT
            explanation = "Not all required meters reported for this interval; no leak conclusion is permitted."
        elif coverage < self.config.minimum_coverage:
            state = BalanceState.INSUFFICIENT_DATA
            quality = EvidenceQuality.INSUFFICIENT
            explanation = f"Downstream accounting coverage is only {coverage:.0%}; localisation is paused rather than treating uncovered consumption as leakage."
        else:
            anomalous = residual >= self.config.minimum_residual_m3 and residual_ratio >= self.config.minimum_residual_ratio
            state = BalanceState.ANOMALOUS if anomalous else BalanceState.BALANCED
            quality = EvidenceQuality.HIGH if completeness >= 1.0 and alignment_valid else EvidenceQuality.MEDIUM
            explanation = (
                f"{inflow_value:.3f} m³ entered; {measured_sum:.3f} m³ was measured downstream; "
                f"{known_unmetered:.3f} m³ is known unmetered use; {residual:.3f} m³ remains unexplained."
            )

        return BalanceResult(
            node_id=node.id,
            interval_start=start_ts,
            interval_end=now_ts,
            inflow_m3=round(inflow_value, 6),
            measured_children_m3=round(measured_sum, 6),
            known_unmetered_m3=round(known_unmetered, 6),
            storage_change_m3=round(storage_change, 6),
            residual_m3=round(residual, 6),
            residual_ratio=round(residual_ratio, 6),
            coverage=round(coverage, 6),
            completeness=round(completeness, 6),
            freshness_seconds=round(freshness_seconds, 3),
            alignment_valid=alignment_valid,
            state=state,
            evidence_quality=quality,
            explanation=explanation,
        )

    def reconcile_all(self, store: LocalStore, require_reading_pairs: bool = False, interval_end: str | None = None) -> list[BalanceResult]:
        results = []
        expected_previous: str | None = None
        if interval_end is not None:
            target = self._parse(interval_end)
            best = None
            for node in store.nodes.values():
                if node.kind != NodeKind.METER:
                    continue
                for reading in store.readings.get(node.id, []):
                    parsed = self._parse(reading.timestamp)
                    if parsed < target and (best is None or parsed > best):
                        best = parsed
                        expected_previous = reading.timestamp
        for node in store.nodes.values():
            if node.kind == NodeKind.METER:
                # In the event-driven runtime a batch may only contain a subset of
                # sibling meters, and bursts can deliver several intervals at once.
                # Reconciling a specific interval keeps every physical interval
                # evaluated exactly once, regardless of processing order.
                if require_reading_pairs and interval_end is not None:
                    # The first observed interval has no predecessor anywhere; no
                    # interval can be formed yet. Nodes with a reading at this interval
                    # are still reconciled, and a missing predecessor fails closed.
                    if expected_previous is None or self._reading_at(store, node.id, interval_end) is None:
                        continue
                if require_reading_pairs and interval_end is None and len(store.latest_two(node.id)) < 2:
                    continue
                result = self.reconcile_node(store, node, interval_end, expected_previous)
                results.append(result)
        store.balances.extend(results)
        return results

    def deepest_trustworthy_anomaly(self, store: LocalStore, balances: list[BalanceResult], start_node_id: str | None = None) -> tuple[str | None, str]:
        by_id = {b.node_id: b for b in balances}
        anomalous_ids = [b.node_id for b in balances if b.state == BalanceState.ANOMALOUS and b.evidence_quality == EvidenceQuality.HIGH]
        if not anomalous_ids:
            return None, "No trustworthy anomalous water balance exists."

        if start_node_id and start_node_id in anomalous_ids:
            current = store.nodes[start_node_id]
        else:
            # Prefer the shallowest anomalous node, then descend only through a single trustworthy anomalous child.
            def depth(node_id: str) -> int:
                d = 0
                n = store.nodes[node_id]
                while n.parent_id is not None:
                    d += 1
                    n = store.nodes[n.parent_id]
                return d
            current = store.nodes[sorted(anomalous_ids, key=depth)[0]]

        while True:
            child_nodes = [c for c in children(store.nodes, current.id) if c.kind == NodeKind.METER]
            anomalous_children = [c for c in child_nodes if by_id.get(c.id) and by_id[c.id].state == BalanceState.ANOMALOUS and by_id[c.id].evidence_quality == EvidenceQuality.HIGH]
            if len(anomalous_children) == 1:
                current = anomalous_children[0]
                continue
            break

        child_nodes = children(store.nodes, current.id)
        unmetered = [c.label for c in child_nodes if c.kind == NodeKind.UNMETERED]
        insufficient = [
            c.label for c in child_nodes
            if c.kind == NodeKind.METER and by_id.get(c.id) and by_id[c.id].state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE}
        ]
        reasons = []
        if unmetered:
            reasons.append("unmetered branches: " + ", ".join(unmetered))
        if insufficient:
            reasons.append("insufficient child evidence: " + ", ".join(insufficient))
        if not reasons:
            reasons.append("no single trustworthy child remains anomalous")
        return current.id, "Localisation stops here because " + "; ".join(reasons) + "."
