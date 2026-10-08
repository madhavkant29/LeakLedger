import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.domain.models import IncidentStatus, RepairAction, BalanceState
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
