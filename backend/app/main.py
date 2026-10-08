from __future__ import annotations

import csv
import io
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.aws.runtime import AwsRuntime, engine_for, site_write_lock
from app.domain.models import AuditEvent, MeterReading, NodeKind, RepairAction, SiteSettings, to_dict
from app.repositories.memory import LocalStore
from app.services.incidents import IncidentService
from app.services.reconciliation import ReconciliationEngine
from app.services.topology import topology_tree
from app.simulator.scenarios import DemoSimulator
from app.simulator.seed import seed_nodes

MODE = os.getenv("LEAKLEDGER_MODE", "local").lower()
SITE_ID = "northbridge"
SITE_NAME = "Northbridge University Campus"

SERVE_FRONTEND = os.getenv("LEAKLEDGER_SERVE_FRONTEND", "").lower() in {"1", "true", "yes"}
FRONTEND_DIR = Path(os.getenv(
    "FRONTEND_DIR",
    str(Path(__file__).resolve().parent.parent / "frontend_static"),
))


class StripApiPrefixMiddleware:
    """Serve API paths both with and without the CloudFront `/api` prefix.

    CloudFront strips `/api` before forwarding. When the static frontend is
    served directly through API Gateway (CloudFront disabled), requests arrive
    as `/api/...`, so the same routes must also resolve after stripping.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            if path == "/api" or path.startswith("/api/"):
                new_path = path[4:] or "/"
                scope = dict(scope)
                scope["path"] = new_path
                if scope.get("raw_path"):
                    scope["raw_path"] = new_path.encode("utf-8")
        await self.app(scope, receive, send)


app = FastAPI(title="LeakLedger API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(StripApiPrefixMiddleware)

store = LocalStore(nodes=seed_nodes())
engine = engine_for(store.settings)
incident_service = IncidentService(engine)
simulator = DemoSimulator(store, engine, incident_service)
simulator.reset("normal")
aws_runtime = AwsRuntime() if MODE == "aws" else None


class ReadingIn(BaseModel):
    event_id: str
    meter_id: str
    timestamp: str
    cumulative_m3: float = Field(ge=0)
    unit: str = "m3"
    source: str = "manual"


class RepairIn(BaseModel):
    actor: str = "Neha Sharma"
    repair_type: str = "Pipe repair"
    location: str = "Hostel B common distribution"
    notes: str = "Repair completed and line returned to service."
    cost: float | None = Field(default=None, ge=0)
    cause: str | None = None


class ScenarioIn(BaseModel):
    scenario: str = Field(pattern="^(normal|hidden-leak|missing-reading|counter-reset|repair|failed-repair)$")


class ActorIn(BaseModel):
    actor: str = "Aarav Mehta"


class SettingsIn(BaseModel):
    minimum_residual_m3: float = Field(ge=0, le=1000)
    minimum_residual_ratio: float = Field(ge=0, le=1)
    persistence_intervals: int = Field(ge=1, le=20)
    minimum_coverage: float = Field(ge=0, le=1)
    freshness_limit_seconds: int = Field(ge=30, le=86400)
    alignment_tolerance_seconds: int = Field(ge=0, le=3600)
    verification_required_intervals: int = Field(ge=1, le=20)
    quiet_hours_start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    quiet_hours_end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    site_timezone: str = "Asia/Kolkata"


class NodeConfigIn(BaseModel):
    expected_interval_minutes: int = Field(ge=1, le=1440)
    known_unmetered_m3_per_interval: float = Field(ge=0, le=10000)
    buffered: bool = False
    storage_capacity_m3: float | None = Field(default=None, ge=0)
    storage_change_m3_per_interval: float | None = Field(default=None, ge=-10000, le=10000)
    active: bool = True


def serialize(items: Any):
    if isinstance(items, list):
        return [to_dict(i) for i in items]
    return to_dict(items)


def current_store() -> LocalStore:
    if MODE == "aws":
        assert aws_runtime is not None
        aws_runtime.ensure_seed(SITE_ID)
        return aws_runtime.repository.load_store(SITE_ID)
    return store


def configure_local_engine() -> None:
    global engine, incident_service
    engine = engine_for(store.settings)
    incident_service = IncidentService(engine)
    simulator.engine = engine
    simulator.incidents = incident_service


def service_for(s: LocalStore) -> IncidentService:
    return IncidentService(engine_for(s.settings))


def latest_balance_map(s: LocalStore) -> dict[str, Any]:
    latest: dict[str, Any] = {}
    for b in s.balances:
        latest[b.node_id] = b
    return latest


def audit_balances(s: LocalStore, balances, correlation_id: str | None = None) -> None:
    for balance in balances:
        s.audit.append(AuditEvent(
            timestamp=balance.interval_end,
            event_type="ReconciliationCompleted",
            detail=f"{balance.node_id}: {balance.state.value}; residual {balance.residual_m3:.3f} m³.",
            correlation_id=correlation_id,
            payload={"node_id": balance.node_id, "state": balance.state.value, "evidence_quality": balance.evidence_quality.value, "residual_m3": balance.residual_m3},
        ))


def validate_site(site_id: str) -> None:
    if site_id != SITE_ID:
        raise HTTPException(404, "Site not found")


def reading_from(body: ReadingIn, site_id: str = SITE_ID) -> MeterReading:
    if body.meter_id not in current_store().nodes:
        raise HTTPException(400, f"Unknown meter {body.meter_id}")
    try:
        datetime.fromisoformat(body.timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(400, f"Invalid ISO-8601 timestamp: {body.timestamp}") from exc
    unit = body.unit.strip().lower().replace("³", "3")
    if unit in {"m3", "m^3", "cubic_meter", "cubic_meters"}:
        cumulative_m3 = body.cumulative_m3
    elif unit in {"l", "liter", "liters", "litre", "litres"}:
        cumulative_m3 = body.cumulative_m3 / 1000.0
    else:
        raise HTTPException(400, f"Unsupported unit {body.unit!r}; use m3 or L")
    return MeterReading(
        event_id=body.event_id,
        meter_id=body.meter_id,
        timestamp=body.timestamp,
        cumulative_m3=round(cumulative_m3, 9),
        source=body.source,
        site_id=site_id,
        schema_version=1,
    )


def ingest_one_local(reading: MeterReading) -> dict[str, Any]:
    if reading.meter_id not in store.nodes:
        raise HTTPException(400, f"Unknown meter {reading.meter_id}")
    if reading.event_id in store.processed_event_ids:
        return {"accepted": False, "duplicate": True, "queued": False}
    store.processed_event_ids.add(reading.event_id)
    store.readings[reading.meter_id].append(reading)
    store.audit.append(AuditEvent(
        timestamp=reading.timestamp,
        event_type="MeterReadingReceived",
        detail=f"{reading.meter_id} = {reading.cumulative_m3:.3f} m³",
        correlation_id=reading.event_id,
        payload={"meter_id": reading.meter_id, "event_id": reading.event_id, "source": reading.source},
    ))
    balances = engine.reconcile_all(store)
    incident_service.evaluate(store, balances)
    audit_balances(store, balances, reading.event_id)
    return {"accepted": True, "duplicate": False, "queued": False}


def persist_aws_store(s: LocalStore) -> None:
    assert aws_runtime is not None
    aws_runtime.repository.save_store(s, SITE_ID)


@contextmanager
def aws_write_lock():
    """Serialize API mutations with the reconciliation worker on the AWS runtime."""
    if MODE != "aws" or aws_runtime is None:
        yield
        return
    try:
        with site_write_lock(aws_runtime, SITE_ID, attempts=20, wait_seconds=0.25):
            yield
    except TimeoutError as exc:
        raise HTTPException(503, "Site reconciliation is busy; retry shortly.") from exc


@app.get("/health")
def health():
    return {"ok": True, "service": "leakledger-api", "mode": MODE, "version": "1.0.0"}


@app.get("/sites")
def sites():
    return [{"id": SITE_ID, "name": SITE_NAME, "timezone": current_store().settings.site_timezone}]


@app.get("/sites/{site_id}")
def site(site_id: str):
    validate_site(site_id)
    return {"id": site_id, "name": SITE_NAME, "description": "Fictional seeded campus used for the deterministic demo.", "timezone": current_store().settings.site_timezone}


@app.get("/sites/{site_id}/topology")
def site_topology(site_id: str):
    validate_site(site_id)
    s = current_store()
    balances = latest_balance_map(s)
    nodes = []
    for n in s.nodes.values():
        b = balances.get(n.id)
        nodes.append({
            **to_dict(n),
            "state": b.state.value if b else ("UNMETERED" if n.kind == NodeKind.UNMETERED else "UNKNOWN"),
            "balance": to_dict(b) if b else None,
        })
    return {"tree": topology_tree(s.nodes), "nodes": nodes}


@app.get("/sites/{site_id}/overview")
def overview(site_id: str):
    validate_site(site_id)
    s = current_store()
    balances = latest_balance_map(s)
    root = balances.get("MAIN-CAMPUS")
    active = [i for i in s.incidents.values() if i.status.value not in {"RESOLVED", "REPAIR_FAILED"}]
    return {
        "site": SITE_NAME,
        "scenario": s.scenario,
        "step": s.scenario_step,
        "current_balance": to_dict(root) if root else None,
        "active_incident": to_dict(active[0]) if active else None,
        "meter_coverage": root.coverage if root else None,
        "data_completeness": root.completeness if root else None,
        "recent_audit": [to_dict(a) for a in s.audit[-12:]][::-1],
    }


@app.get("/sites/{site_id}/ledger")
def ledger(site_id: str, limit: int = 80):
    validate_site(site_id)
    s = current_store()
    return [to_dict(b) for b in s.balances[-max(1, min(limit, 500)):]][::-1]


@app.get("/sites/{site_id}/meters")
def meters(site_id: str):
    validate_site(site_id)
    s = current_store()
    newest_ts = None
    all_latest = [s.latest(n.id) for n in s.nodes.values() if s.latest(n.id)]
    if all_latest:
        newest_ts = max(datetime.fromisoformat(x.timestamp.replace("Z", "+00:00")) for x in all_latest)
    out = []
    for node in s.nodes.values():
        latest = s.latest(node.id)
        if node.kind == NodeKind.UNMETERED:
            health = "UNMETERED"
            age_seconds = None
        elif latest is None:
            health = "NO_DATA"
            age_seconds = None
        else:
            ts = datetime.fromisoformat(latest.timestamp.replace("Z", "+00:00"))
            age_seconds = max(0.0, (newest_ts - ts).total_seconds()) if newest_ts else 0.0
            health = "STALE" if age_seconds > max(s.settings.freshness_limit_seconds, node.expected_interval_minutes * 120) else "HEALTHY"
        out.append({
            **to_dict(node),
            "latest_reading": to_dict(latest) if latest else None,
            "reading_count": len(s.readings.get(node.id, [])),
            "health": health,
            "age_seconds": age_seconds,
        })
    return out


@app.get("/sites/{site_id}/readings")
def readings(site_id: str, meter_id: str | None = None, limit: int = 200):
    validate_site(site_id)
    s = current_store()
    limit = max(1, min(limit, 2000))
    if meter_id:
        return [to_dict(r) for r in s.readings.get(meter_id, [])[-limit:]]
    rows = [r for values in s.readings.values() for r in values]
    rows.sort(key=lambda r: (r.timestamp, r.event_id))
    return [to_dict(r) for r in rows[-limit:]]


@app.post("/sites/{site_id}/readings")
def post_reading(site_id: str, body: ReadingIn):
    validate_site(site_id)
    reading = reading_from(body, site_id)
    if MODE == "aws":
        assert aws_runtime is not None
        return aws_runtime.ingest_async(reading)
    return ingest_one_local(reading)


@app.post("/sites/{site_id}/readings/batch")
def post_batch(site_id: str, rows: list[ReadingIn]):
    validate_site(site_id)
    results = []
    for body in rows:
        reading = reading_from(body, site_id)
        if MODE == "aws":
            assert aws_runtime is not None
            results.append(aws_runtime.ingest_async(reading))
        else:
            results.append(ingest_one_local(reading))
    return {"results": results}


@app.get("/sites/{site_id}/import/sample")
def sample_csv(site_id: str):
    validate_site(site_id)
    sample = "timestamp,meter_id,cumulative_m3,unit\n2026-10-08T09:00:00+00:00,MAIN-CAMPUS,100.000,m3\n2026-10-08T09:15:00+00:00,MAIN-CAMPUS,108950,L\n"
    return Response(content=sample, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=leakledger-sample.csv"})


@app.post("/sites/{site_id}/import")
async def import_csv(site_id: str, file: UploadFile = File(...)):
    validate_site(site_id)
    try:
        raw = (await file.read()).decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "CSV must be UTF-8 encoded") from exc
    reader = csv.DictReader(io.StringIO(raw))
    required = {"timestamp", "meter_id", "cumulative_m3"}
    if not required.issubset(set(reader.fieldnames or [])):
        raise HTTPException(400, "CSV requires timestamp,meter_id,cumulative_m3 columns")
    accepted = 0
    duplicates = 0
    rejected: list[dict[str, Any]] = []
    for index, row in enumerate(reader, start=2):
        try:
            event = ReadingIn(
                event_id=(row.get("event_id") or f"csv-{index}-{row['meter_id']}-{row['timestamp']}").strip(),
                meter_id=row["meter_id"].strip(),
                timestamp=row["timestamp"].strip(),
                cumulative_m3=float(row["cumulative_m3"]),
                unit=(row.get("unit") or "m3").strip(),
                source="csv",
            )
            reading = reading_from(event, site_id)
            result = aws_runtime.ingest_async(reading) if MODE == "aws" and aws_runtime else ingest_one_local(reading)
            accepted += int(result.get("accepted", False))
            duplicates += int(result.get("duplicate", False))
        except Exception as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            rejected.append({"row": index, "reason": detail})
    return {"accepted": accepted, "duplicates": duplicates, "rejected": rejected, "total_rows": max(0, index - 1) if 'index' in locals() else 0}


def incident_view(s: LocalStore, item) -> dict[str, Any]:
    balances = latest_balance_map(s)
    data = to_dict(item)
    balance = balances.get(item.node_id)
    data["current_balance"] = to_dict(balance) if balance else None
    return data


@app.get("/sites/{site_id}/incidents")
def incidents(site_id: str):
    validate_site(site_id)
    s = current_store()
    return [incident_view(s, i) for i in sorted(s.incidents.values(), key=lambda x: x.opened_at, reverse=True)]


@app.get("/incidents/{incident_id}")
def incident(incident_id: str):
    s = current_store()
    if incident_id not in s.incidents:
        raise HTTPException(404, "Incident not found")
    return incident_view(s, s.incidents[incident_id])


def _transition(incident_id: str, action: str, actor: str):
    with aws_write_lock():
        s = current_store()
        if incident_id not in s.incidents:
            raise HTTPException(404, "Incident not found")
        service = service_for(s)
        try:
            result = service.transition(s, incident_id, action, actor)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        if MODE == "aws":
            persist_aws_store(s)
            assert aws_runtime is not None
            aws_runtime.events.publish_domain_event("IncidentStateChanged", SITE_ID, {"incident_id": incident_id, "status": result.status.value, "actor": actor})
    return to_dict(result)


@app.post("/incidents/{incident_id}/acknowledge")
def acknowledge(incident_id: str, body: ActorIn):
    return _transition(incident_id, "acknowledge", body.actor)


@app.post("/incidents/{incident_id}/investigate")
def investigate(incident_id: str, body: ActorIn):
    return _transition(incident_id, "investigate", body.actor)


@app.post("/incidents/{incident_id}/repair")
def repair(incident_id: str, body: RepairIn):
    with aws_write_lock():
        s = current_store()
        if incident_id not in s.incidents:
            raise HTTPException(404, "Incident not found")
        service = service_for(s)
        try:
            action = RepairAction(
                timestamp=datetime.now(timezone.utc).isoformat(), actor=body.actor, repair_type=body.repair_type,
                location=body.location, notes=body.notes, cost=body.cost, cause=body.cause,
            )
            result = service.record_repair(s, incident_id, action)
            result.verification_required_intervals = s.settings.verification_required_intervals
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        if MODE == "aws":
            persist_aws_store(s)
            assert aws_runtime is not None
            aws_runtime.events.publish_domain_event("RepairReported", SITE_ID, {"incident_id": incident_id, "actor": body.actor})
    return to_dict(result)


@app.get("/incidents/{incident_id}/events")
def incident_events(incident_id: str):
    s = current_store()
    if incident_id not in s.incidents:
        raise HTTPException(404, "Incident not found")
    return [to_dict(e) for e in s.incidents[incident_id].events]


@app.get("/sites/{site_id}/audit")
def audit(site_id: str, limit: int = 250):
    validate_site(site_id)
    s = current_store()
    return [to_dict(a) for a in s.audit[-max(1, min(limit, 2000)):]][::-1]


@app.put("/sites/{site_id}/topology/{node_id}")
def update_node_config(site_id: str, node_id: str, body: NodeConfigIn):
    validate_site(site_id)
    with aws_write_lock():
        s = current_store()
        if node_id not in s.nodes:
            raise HTTPException(404, "Topology node not found")
        node = s.nodes[node_id]
        node.expected_interval_minutes = body.expected_interval_minutes
        node.known_unmetered_m3_per_interval = body.known_unmetered_m3_per_interval
        node.buffered = body.buffered
        node.storage_capacity_m3 = body.storage_capacity_m3
        node.storage_change_m3_per_interval = body.storage_change_m3_per_interval
        node.active = body.active
        if MODE == "aws":
            persist_aws_store(s)
    return to_dict(node)


@app.get("/sites/{site_id}/settings")
def get_settings(site_id: str):
    validate_site(site_id)
    return to_dict(current_store().settings)


@app.put("/sites/{site_id}/settings")
def put_settings(site_id: str, body: SettingsIn):
    validate_site(site_id)
    settings = SiteSettings(**body.model_dump())
    if MODE == "aws":
        assert aws_runtime is not None
        with aws_write_lock():
            aws_runtime.repository.save_settings(site_id, settings)
            s = aws_runtime.repository.load_store(site_id)
            s.settings = settings
            for item in s.incidents.values():
                item.verification_required_intervals = settings.verification_required_intervals
            aws_runtime.repository.save_store(s, site_id)
    else:
        store.settings = settings
        for item in store.incidents.values():
            item.verification_required_intervals = settings.verification_required_intervals
        configure_local_engine()
    return to_dict(settings)


@app.post("/demo/reset")
def demo_reset(body: ScenarioIn):
    if MODE == "aws":
        assert aws_runtime is not None
        aws_runtime.reset_demo(body.scenario, SITE_ID)
    else:
        simulator.reset(body.scenario)
    return demo_state()


@app.post("/demo/replay")
def demo_replay(body: ScenarioIn):
    if MODE == "aws":
        assert aws_runtime is not None
        state = aws_runtime.reset_demo(body.scenario, SITE_ID)
        state["running"] = True
        aws_runtime.repository.save_demo_state(state, SITE_ID)
    else:
        simulator.reset(body.scenario)
        store.scenario_running = True
    return demo_state()


@app.post("/demo/step")
def demo_step():
    if MODE == "aws":
        assert aws_runtime is not None
        state = aws_runtime.step_demo(SITE_ID)
        return {"step": state["step"], "queued": True, "scenario": state["scenario"]}
    return serialize(simulator.step())


@app.post("/demo/pause")
def demo_pause():
    if MODE == "aws":
        assert aws_runtime is not None
        state = aws_runtime.repository.get_demo_state(SITE_ID) or {"scenario": "normal", "step": 0, "counters": {}, "running": False}
        state["running"] = False
        aws_runtime.repository.save_demo_state(state, SITE_ID)
    else:
        store.scenario_running = False
    return demo_state()


@app.post("/demo/resume")
def demo_resume():
    if MODE == "aws":
        assert aws_runtime is not None
        state = aws_runtime.repository.get_demo_state(SITE_ID) or {"scenario": "normal", "step": 0, "counters": {}, "running": True}
        state["running"] = True
        aws_runtime.repository.save_demo_state(state, SITE_ID)
    else:
        store.scenario_running = True
    return demo_state()


@app.get("/demo/state")
def demo_state():
    s = current_store()
    balances = latest_balance_map(s)
    latest_root = balances.get("MAIN-CAMPUS")
    active = next((i for i in s.incidents.values() if i.status.value not in {"RESOLVED", "REPAIR_FAILED"}), None)
    focus = balances.get(active.node_id) if active else latest_root
    demo = aws_runtime.repository.get_demo_state(SITE_ID) if MODE == "aws" and aws_runtime else None
    return {
        "scenario": demo.get("scenario", s.scenario) if demo else s.scenario,
        "step": int(demo.get("step", s.scenario_step)) if demo else s.scenario_step,
        "running": bool(demo.get("running", s.scenario_running)) if demo else s.scenario_running,
        "latest_balance": to_dict(focus) if focus else None,
        "root_balance": to_dict(latest_root) if latest_root else None,
        "incidents": [to_dict(i) for i in s.incidents.values()],
    }


def _validation_system(scenario: str):
    s = LocalStore(nodes=seed_nodes())
    e = engine_for(s.settings)
    svc = IncidentService(e)
    sim = DemoSimulator(s, e, svc)
    sim.reset(scenario)
    return s, e, svc, sim


@app.get("/demo/validation")
def demo_validation():
    results: list[dict[str, Any]] = []

    s, _, _, sim = _validation_system("normal")
    for _ in range(8): sim.step()
    results.append({"name": "Normal site", "passed": len(s.incidents) == 0, "detail": f"{len(s.incidents)} false incidents across 8 replay intervals."})

    s, _, _, sim = _validation_system("hidden-leak")
    for _ in range(6): sim.step()
    incident = next(iter(s.incidents.values()), None)
    results.append({"name": "Hidden Hostel B loss", "passed": bool(incident and incident.node_id == "HOSTEL-B-MAIN"), "detail": f"Localised to {incident.node_id if incident else 'none'}; expected HOSTEL-B-MAIN."})

    s, _, _, sim = _validation_system("missing-reading")
    for _ in range(7): sim.step()
    latest = latest_balance_map(s).get("HOSTEL-B-MAIN")
    incident = next(iter(s.incidents.values()), None)
    passed_missing = bool(latest and latest.state.value in {"INSUFFICIENT_DATA", "DATA_QUALITY_FAILURE", "STALE"} and incident and incident.status.value == "EVIDENCE_INSUFFICIENT")
    results.append({"name": "Missing meter fails closed", "passed": passed_missing, "detail": f"Balance became {latest.state.value if latest else 'none'} and incident became {incident.status.value if incident else 'none'} instead of asserting a stronger leak claim."})

    s, _, _, sim = _validation_system("counter-reset")
    for _ in range(5): sim.step()
    latest = latest_balance_map(s).get("HOSTEL-B-MAIN")
    results.append({"name": "Counter reset", "passed": bool(latest and latest.state.value in {"INSUFFICIENT_DATA", "DATA_QUALITY_FAILURE"}), "detail": f"Reset produced {latest.state.value if latest else 'none'}; no negative leak conclusion."})

    s, _, _, sim = _validation_system("normal")
    sim.step(); reading = next(iter(s.readings.values()))[-1]; count = len(s.readings[reading.meter_id]); sim._ingest(reading)
    results.append({"name": "Duplicate event", "passed": len(s.readings[reading.meter_id]) == count, "detail": "Duplicate event id did not change meter accounting."})

    s, _, svc, sim = _validation_system("repair")
    for _ in range(6): sim.step()
    incident = next(iter(s.incidents.values()))
    svc.record_repair(s, incident.id, RepairAction(timestamp=datetime.now(timezone.utc).isoformat(), actor="Neha Sharma", repair_type="Pipe repair", location="Hostel B", notes="Validation repair"))
    for _ in range(3): sim.step()
    results.append({"name": "Repair verification", "passed": incident.status.value == "RESOLVED", "detail": f"Final state {incident.status.value} after {incident.verification_valid_intervals}/{incident.verification_required_intervals} healthy intervals."})

    s, _, svc, sim = _validation_system("failed-repair")
    for _ in range(6): sim.step()
    incident = next(iter(s.incidents.values()))
    svc.record_repair(s, incident.id, RepairAction(timestamp=datetime.now(timezone.utc).isoformat(), actor="Neha Sharma", repair_type="Partial repair", location="Hostel B", notes="Validation partial repair"))
    for _ in range(3): sim.step()
    results.append({"name": "Failed repair", "passed": incident.status.value == "REPAIR_FAILED", "detail": f"Final state {incident.status.value}; incident was not falsely closed."})

    return {"passed": all(x["passed"] for x in results), "results": results, "note": "Controlled deterministic simulations; not real-world detection accuracy."}


# When CloudFront is unavailable (for example on AWS accounts pending CloudFront
# verification), the same static export is served by this Lambda through API Gateway.
if SERVE_FRONTEND and FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
