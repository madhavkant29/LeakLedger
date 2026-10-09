import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.domain.models import IncidentStatus, RepairAction, BalanceState, BalanceResult, EvidenceQuality, MeterReading
from app.repositories.memory import LocalStore
from app.services.reconciliation import ReconciliationEngine, ReconciliationConfig
from app.services.incidents import IncidentService
from app.simulator.seed import seed_nodes
from app.simulator.scenarios import DemoSimulator


def make_system(scenario="normal"):
    store = LocalStore(nodes=seed_nodes())
    engine = ReconciliationEngine(ReconciliationConfig())
    service = IncidentService(engine)
    sim = DemoSimulator(store, engine, service)
    sim.reset(scenario)
    return store, engine, service, sim


def step(sim, n):
    result = None
    for _ in range(n):
        result = sim.step()
    return result


def latest_balance(store, node_id):
    return [b for b in store.balances if b.node_id == node_id][-1]


def test_normal_has_no_incident_after_many_intervals():
    store, _, _, sim = make_system("normal")
    step(sim, 8)
    assert len(store.incidents) == 0
    assert latest_balance(store, "HOSTEL-B-MAIN").state == BalanceState.BALANCED


def test_hidden_loss_localises_to_hostel_b():
    store, _, _, sim = make_system("hidden-leak")
    step(sim, 6)
    assert len(store.incidents) == 1
    incident = next(iter(store.incidents.values()))
    assert incident.node_id == "HOSTEL-B-MAIN"
    assert incident.residual_m3 >= 0.34
    assert incident.status == IncidentStatus.OPEN


def test_missing_reading_fails_closed_after_incident_exists():
    store, _, _, sim = make_system("missing-reading")
    step(sim, 6)
    incident = next(iter(store.incidents.values()))
    assert incident.status == IncidentStatus.OPEN
    sim.step()  # step 7: missing F2 after the incident has already opened
    b = latest_balance(store, "HOSTEL-B-MAIN")
    assert b.state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE, BalanceState.STALE}
    assert incident.status == IncidentStatus.EVIDENCE_INSUFFICIENT


def test_counter_reset_does_not_create_negative_leak():
    store, _, _, sim = make_system("counter-reset")
    step(sim, 5)
    b = latest_balance(store, "HOSTEL-B-MAIN")
    assert b.state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE}


def test_duplicate_event_is_ignored_by_store_contract():
    store, _, _, sim = make_system("normal")
    sim.step()
    any_reading = next(iter(store.readings.values()))[-1]
    count = len(store.readings[any_reading.meter_id])
    # Simulator's ingestion path uses the processed-event id set.
    sim._ingest(any_reading)
    assert len(store.readings[any_reading.meter_id]) == count


def test_repair_requires_three_healthy_intervals():
    store, _, service, sim = make_system("repair")
    step(sim, 6)
    incident = next(iter(store.incidents.values()))
    service.record_repair(store, incident.id, RepairAction(
        timestamp=datetime.now(timezone.utc).isoformat(),
        actor="Neha Sharma",
        repair_type="Valve and pipe repair",
        location="Hostel B common distribution",
        notes="Completed",
    ))
    sim.step()
    assert incident.status == IncidentStatus.VERIFYING
    assert incident.verification_valid_intervals == 1
    sim.step()
    assert incident.status == IncidentStatus.VERIFYING
    assert incident.verification_valid_intervals == 2
    sim.step()
    assert incident.status == IncidentStatus.RESOLVED


def test_failed_repair_is_not_closed():
    store, _, service, sim = make_system("failed-repair")
    step(sim, 6)
    incident = next(iter(store.incidents.values()))
    service.record_repair(store, incident.id, RepairAction(
        timestamp=datetime.now(timezone.utc).isoformat(),
        actor="Neha Sharma",
        repair_type="Partial repair",
        location="Hostel B common distribution",
        notes="Attempted repair",
    ))
    step(sim, 3)
    assert incident.status == IncidentStatus.REPAIR_FAILED


def test_same_interval_cannot_advance_persistence_twice():
    store, engine, service, sim = make_system("hidden-leak")
    step(sim, 3)
    assert store.persistence.get("HOSTEL-B-MAIN") == 1
    balances = engine.reconcile_all(store)
    service.evaluate(store, balances)
    assert store.persistence.get("HOSTEL-B-MAIN") == 1


def test_same_interval_cannot_advance_repair_verification_twice():
    store, engine, service, sim = make_system("repair")
    step(sim, 6)
    incident = next(iter(store.incidents.values()))
    service.record_repair(store, incident.id, RepairAction(
        timestamp=datetime.now(timezone.utc).isoformat(),
        actor="Neha Sharma",
        repair_type="Pipe repair",
        location="Hostel B",
        notes="Complete",
    ))
    sim.step()
    assert incident.verification_valid_intervals == 1
    balances = engine.reconcile_all(store)
    service.evaluate(store, balances)
    assert incident.verification_valid_intervals == 1


def synthetic_balance(node_id, interval_end, state, residual=0.35, evidence=None):
    if evidence is None:
        evidence = (
            EvidenceQuality.INSUFFICIENT
            if state in {BalanceState.INSUFFICIENT_DATA, BalanceState.DATA_QUALITY_FAILURE, BalanceState.STALE}
            else EvidenceQuality.HIGH
        )
    return BalanceResult(
        node_id=node_id,
        interval_start="2026-10-08T09:00:00+00:00",
        interval_end=interval_end,
        inflow_m3=3.85,
        measured_children_m3=3.4,
        known_unmetered_m3=0.1,
        storage_change_m3=0.0,
        residual_m3=residual,
        residual_ratio=residual / 3.85,
        coverage=1.0,
        completeness=1.0,
        freshness_seconds=0.0,
        alignment_valid=True,
        state=state,
        evidence_quality=evidence,
        explanation="synthetic interval used to test out-of-order delivery",
    )


def test_older_interval_cannot_reset_a_newer_anomaly_streak():
    """Out-of-order delivery must not let a pre-incident healthy interval erase a
    newer anomalous streak (which would stop a legitimate incident from opening)."""
    store = LocalStore(nodes=seed_nodes())
    engine = ReconciliationEngine(ReconciliationConfig())
    service = IncidentService(engine)

    for end in ("2026-10-08T09:45:00+00:00", "2026-10-08T10:00:00+00:00", "2026-10-08T10:30:00+00:00"):
        service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", end, BalanceState.ANOMALOUS)])

    assert store.persistence["HOSTEL-B-MAIN"] == 3
    assert len(store.incidents) == 1

    service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", "2026-10-08T09:15:00+00:00", BalanceState.BALANCED, residual=0.0)])

    assert store.persistence["HOSTEL-B-MAIN"] == 3
    assert next(iter(store.incidents.values())).status == IncidentStatus.OPEN


def build_gap_store(include_0945):
    store = LocalStore(nodes=seed_nodes())

    def reading(meter, ts, value):
        return MeterReading(event_id=f"{meter}-{ts}", meter_id=meter, timestamp=ts, cumulative_m3=value)

    t0 = "2026-10-08T09:00:00+00:00"
    t1 = "2026-10-08T09:45:00+00:00"
    t2 = "2026-10-08T10:00:00+00:00"
    series = {
        "HOSTEL-B-MAIN": {t0: 100.0, t1: 107.70, t2: 111.55},
        "HOSTEL-B-F1": {t0: 100.0, t1: 103.50, t2: 105.25},
        "HOSTEL-B-F2": {t0: 100.0, t1: 103.30, t2: 104.95},
    }
    for meter, values in series.items():
        for ts, value in values.items():
            if ts == t1 and not include_0945 and meter == "HOSTEL-B-MAIN":
                continue
            store.readings[meter].append(reading(meter, ts, value))
    return store


def test_gapped_predecessor_fails_closed_instead_of_misaligned_arithmetic():
    """A meter missing the preceding interval boundary must not have its volume compared
    against a parent whose volume spans a different period."""
    engine = ReconciliationEngine(ReconciliationConfig())
    balances = engine.reconcile_all(build_gap_store(include_0945=False), interval_end="2026-10-08T10:00:00+00:00")
    main = next(b for b in balances if b.node_id == "HOSTEL-B-MAIN")
    assert main.state == BalanceState.INSUFFICIENT_DATA
    assert "missing reading pair" in main.explanation


def test_aligned_predecessor_reconciles_normally():
    engine = ReconciliationEngine(ReconciliationConfig())
    balances = engine.reconcile_all(build_gap_store(include_0945=True), interval_end="2026-10-08T10:00:00+00:00")
    main = next(b for b in balances if b.node_id == "HOSTEL-B-MAIN")
    assert main.state == BalanceState.ANOMALOUS


def test_stale_interval_cannot_restore_an_incident_that_lost_evidence():
    """Once localisation is paused for a newer interval, a late-arriving older healthy
    interval must not restore the claim."""
    store = LocalStore(nodes=seed_nodes())
    engine = ReconciliationEngine(ReconciliationConfig())
    service = IncidentService(engine)
    at = lambda t: f"2026-10-08T{t}:00+00:00"  # noqa: E731

    for end in ("09:45", "10:00", "10:30"):
        service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", at(end), BalanceState.ANOMALOUS)])
    incident = next(iter(store.incidents.values()))
    assert incident.status == IncidentStatus.OPEN

    service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", at("10:45"), BalanceState.INSUFFICIENT_DATA, residual=0.0)])
    assert incident.status == IncidentStatus.EVIDENCE_INSUFFICIENT

    service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", at("10:00"), BalanceState.BALANCED, residual=0.0)])
    assert incident.status == IncidentStatus.EVIDENCE_INSUFFICIENT

    service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", at("10:45"), BalanceState.BALANCED, residual=0.0)])
    assert incident.status in {IncidentStatus.OPEN, IncidentStatus.INVESTIGATING}


def test_repair_verification_streak_is_order_independent():
    """Distinct valid intervals must count regardless of the order they are processed."""
    store = LocalStore(nodes=seed_nodes())
    engine = ReconciliationEngine(ReconciliationConfig())
    service = IncidentService(engine)
    at = lambda t: f"2026-10-08T{t}:00+00:00"  # noqa: E731

    for end in ("09:45", "10:00", "10:30"):
        service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", at(end), BalanceState.ANOMALOUS)])
    incident = next(iter(store.incidents.values()))
    service.record_repair(store, incident.id, RepairAction(
        timestamp=datetime.now(timezone.utc).isoformat(),
        actor="Neha Sharma", repair_type="Pipe repair", location="Hostel B", notes="Complete",
    ))
    incident.verification_floor_interval_end = at("10:30")

    for end in ("11:15", "10:45", "11:00"):
        service.evaluate(store, [synthetic_balance("HOSTEL-B-MAIN", at(end), BalanceState.BALANCED, residual=0.0)])

    assert incident.verification_valid_intervals == 3
    assert incident.status == IncidentStatus.RESOLVED
