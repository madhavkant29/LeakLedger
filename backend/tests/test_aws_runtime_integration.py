import os
import sys
from copy import deepcopy
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.aws.runtime import AwsRuntime, engine_for
from app.domain.models import RepairAction
from app.repositories.memory import LocalStore
from app.services.incidents import IncidentService
from app.simulator.generator import generate_snapshot, initial_counters
from app.simulator.seed import seed_nodes


class FakeRepository:
    def __init__(self):
        self.store = LocalStore(nodes=seed_nodes())
        self.claimed = set()
        self.done = set()
        self.demo_state = None

    def ensure_seed(self, site_id="northbridge"): pass
    def load_store(self, site_id="northbridge"): return deepcopy(self.store)
    def save_store(self, store, site_id="northbridge"): self.store = deepcopy(store)
    def claim_event(self, site_id, event_id):
        if event_id in self.claimed or event_id in self.done: return False
        self.claimed.add(event_id); return True
    def mark_event_done(self, site_id, event_id): self.claimed.discard(event_id); self.done.add(event_id)
    def release_event(self, site_id, event_id): self.claimed.discard(event_id)
    def is_processed(self, site_id, event_id): return event_id in self.done
    def clear_operational_state(self, site_id="northbridge"):
        settings = self.store.settings
        nodes = deepcopy(self.store.nodes)
        self.store = LocalStore(nodes=nodes, settings=settings)
        self.claimed.clear(); self.done.clear()
    def save_demo_state(self, state, site_id="northbridge"): self.demo_state = deepcopy(state)
    def get_demo_state(self, site_id="northbridge"): return deepcopy(self.demo_state)


class FakeArchive:
    def archive(self, reading): return f"raw/{reading.event_id}.json"


class FakeEvents:
    def __init__(self): self.domain=[]; self.meters=[]
    def publish_meter_reading(self, reading): self.meters.append(reading.event_id); return f"eb-{reading.event_id}"
    def publish_domain_event(self, event_type, site_id, detail): self.domain.append((event_type,site_id,detail)); return "domain-id"


class FakeMetrics:
    def __init__(self): self.items=[]
    def increment(self, name, value=1.0, site_id="northbridge"): self.items.append((name,value,site_id))
    def timing(self, name, milliseconds, site_id="northbridge"): self.items.append((name,milliseconds,site_id))


def make_runtime():
    repo=FakeRepository(); events=FakeEvents(); metrics=FakeMetrics()
    runtime=AwsRuntime(repository=repo, archive=FakeArchive(), events=events, metrics=metrics)
    return runtime,repo,events,metrics


def test_aws_batch_runtime_localises_once_per_physical_interval_and_dedupes():
    runtime, repo, events, _ = make_runtime()
    meter_ids=[n.id for n in repo.store.nodes.values() if n.kind.value=="METER"]
    counters=initial_counters(meter_ids)
    last_snapshot=None
    for step in range(0,6):
        snapshot=generate_snapshot(scenario="hidden-leak", step=step, counters=counters, repair_reported=False)
        counters=snapshot.counters
        last_snapshot=snapshot
        result=runtime.process_readings(snapshot.readings)
        assert result["processed"] == len(snapshot.readings)
    assert repo.store.persistence["HOSTEL-B-MAIN"] == 3
    assert len(repo.store.incidents) == 1
    incident=next(iter(repo.store.incidents.values()))
    assert incident.node_id == "HOSTEL-B-MAIN"
    assert incident.status.value == "OPEN"
    assert [x[0] for x in events.domain].count("IncidentOpened") == 1

    before=repo.store.persistence["HOSTEL-B-MAIN"]
    duplicate=runtime.process_readings(last_snapshot.readings)
    assert duplicate["processed"] == 0
    assert duplicate["duplicates"] == len(last_snapshot.readings)
    assert repo.store.persistence["HOSTEL-B-MAIN"] == before


def test_aws_batch_runtime_verifies_repair_with_three_distinct_intervals():
    runtime, repo, events, _ = make_runtime()
    meter_ids=[n.id for n in repo.store.nodes.values() if n.kind.value=="METER"]
    counters=initial_counters(meter_ids)
    for step in range(0,6):
        snapshot=generate_snapshot(scenario="repair", step=step, counters=counters, repair_reported=False)
        counters=snapshot.counters
        runtime.process_readings(snapshot.readings)
    store=repo.load_store()
    incident=next(iter(store.incidents.values()))
    service=IncidentService(engine_for(store.settings))
    service.record_repair(store, incident.id, RepairAction(
        timestamp=datetime.now(timezone.utc).isoformat(), actor="Neha Sharma", repair_type="Pipe repair",
        location="Hostel B common distribution", notes="Completed",
    ))
    repo.save_store(store)

    for step in range(6,9):
        snapshot=generate_snapshot(scenario="repair", step=step, counters=counters, repair_reported=True)
        counters=snapshot.counters
        runtime.process_readings(snapshot.readings)
    final=next(iter(repo.store.incidents.values()))
    assert final.verification_valid_intervals == 3
    assert final.status.value == "RESOLVED"
    assert [x[0] for x in events.domain].count("RepairVerified") == 1
