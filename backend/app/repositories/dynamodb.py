from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import asdict
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.domain.models import (
    AuditEvent,
    BalanceResult,
    BalanceState,
    EvidenceQuality,
    Incident,
    IncidentEvent,
    IncidentStatus,
    MeterNode,
    MeterReading,
    NodeKind,
    RepairAction,
    SiteSettings,
    to_dict,
)
from app.repositories.memory import LocalStore
from app.simulator.seed import seed_nodes


def _json_default(value: Any):
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(type(value).__name__)


def _payload(value: Any) -> str:
    return json.dumps(to_dict(value), separators=(",", ":"), sort_keys=True, default=_json_default)


def _load_payload(item: dict[str, Any]) -> dict[str, Any]:
    return json.loads(item.get("payload", "{}"))


def _node(d: dict[str, Any]) -> MeterNode:
    return MeterNode(
        id=d["id"], label=d["label"], parent_id=d.get("parent_id"),
        kind=NodeKind(d.get("kind", "METER")), unit=d.get("unit", "m3"),
        active=bool(d.get("active", True)), expected_interval_minutes=int(d.get("expected_interval_minutes", 15)),
        known_unmetered_m3_per_interval=float(d.get("known_unmetered_m3_per_interval", 0.0)),
        storage_capacity_m3=d.get("storage_capacity_m3"), storage_change_m3_per_interval=d.get("storage_change_m3_per_interval"), buffered=bool(d.get("buffered", False)),
    )


def _reading(d: dict[str, Any]) -> MeterReading:
    return MeterReading(**d)


def _balance(d: dict[str, Any]) -> BalanceResult:
    return BalanceResult(
        node_id=d["node_id"], interval_start=d["interval_start"], interval_end=d["interval_end"],
        inflow_m3=float(d["inflow_m3"]), measured_children_m3=float(d["measured_children_m3"]),
        known_unmetered_m3=float(d["known_unmetered_m3"]), storage_change_m3=float(d["storage_change_m3"]),
        residual_m3=float(d["residual_m3"]), residual_ratio=float(d["residual_ratio"]),
        coverage=float(d["coverage"]), completeness=float(d["completeness"]), freshness_seconds=float(d["freshness_seconds"]),
        alignment_valid=bool(d["alignment_valid"]), state=BalanceState(d["state"]), evidence_quality=EvidenceQuality(d["evidence_quality"]),
        explanation=d["explanation"], stop_reason=d.get("stop_reason"),
    )


def _incident_event(d: dict[str, Any]) -> IncidentEvent:
    return IncidentEvent(**d)


def _repair(d: dict[str, Any] | None) -> RepairAction | None:
    return RepairAction(**d) if d else None


def _incident(d: dict[str, Any]) -> Incident:
    return Incident(
        id=d["id"], site_id=d["site_id"], node_id=d["node_id"], status=IncidentStatus(d["status"]),
        opened_at=d["opened_at"], residual_m3=float(d["residual_m3"]), residual_ratio=float(d["residual_ratio"]),
        persistence_count=int(d["persistence_count"]), evidence_quality=EvidenceQuality(d["evidence_quality"]),
        deepest_trustworthy_node_id=d["deepest_trustworthy_node_id"], boundary_explanation=d["boundary_explanation"],
        events=[_incident_event(x) for x in d.get("events", [])], repair=_repair(d.get("repair")),
        verification_valid_intervals=int(d.get("verification_valid_intervals", 0)),
        verification_required_intervals=int(d.get("verification_required_intervals", 3)),
        pre_repair_residual_rate=d.get("pre_repair_residual_rate"),
        post_repair_residuals=[float(x) for x in d.get("post_repair_residuals", [])],
        verification_last_interval_end=d.get("verification_last_interval_end"),
    )


def _audit(d: dict[str, Any]) -> AuditEvent:
    return AuditEvent(**d)


def _settings(d: dict[str, Any] | None) -> SiteSettings:
    if not d:
        return SiteSettings()
    allowed = SiteSettings.__dataclass_fields__.keys()
    return SiteSettings(**{k: d[k] for k in allowed if k in d})


class DynamoDbStateRepository:
    """Small-site DynamoDB persistence adapter used by the AWS runtime.

    A single site partition keeps the hackathon implementation simple and auditable.
    The domain engine remains cloud-agnostic: this adapter materializes a LocalStore,
    then persists the resulting readings, balances, incidents and audit events.
    """

    def __init__(self, table_name: str, region_name: str | None = None, table=None):
        self.table = table or boto3.resource("dynamodb", region_name=region_name).Table(table_name)

    @staticmethod
    def pk(site_id: str) -> str:
        return f"SITE#{site_id}"

    def ensure_seed(self, site_id: str = "northbridge") -> None:
        # Seed only missing topology/config records. Never overwrite site edits on a warm invocation.
        for node in seed_nodes().values():
            try:
                self.table.put_item(
                    Item={"pk": self.pk(site_id), "sk": f"NODE#{node.id}", "entity": "NODE", "payload": _payload(node)},
                    ConditionExpression="attribute_not_exists(sk)",
                )
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                    raise
        try:
            self.table.put_item(
                Item={"pk": self.pk(site_id), "sk": "CONFIG#SETTINGS", "entity": "CONFIG", "payload": _payload(SiteSettings())},
                ConditionExpression="attribute_not_exists(sk)",
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise

    def _all_items(self, site_id: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        kwargs: dict[str, Any] = {"KeyConditionExpression": "pk = :pk", "ExpressionAttributeValues": {":pk": self.pk(site_id)}}
        while True:
            response = self.table.query(**kwargs)
            items.extend(response.get("Items", []))
            if "LastEvaluatedKey" not in response:
                break
            kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
        return items

    def load_store(self, site_id: str = "northbridge") -> LocalStore:
        items = self._all_items(site_id)
        nodes: dict[str, MeterNode] = {}
        readings: dict[str, list[MeterReading]] = defaultdict(list)
        balances: list[BalanceResult] = []
        incidents: dict[str, Incident] = {}
        audit: list[AuditEvent] = []
        processed: set[str] = set()
        persistence: dict[str, int] = {}
        persistence_last_interval: dict[str, str] = {}
        settings = SiteSettings()
        scenario = "normal"
        scenario_step = 0
        scenario_running = False

        for item in items:
            sk = item.get("sk", "")
            data = _load_payload(item)
            if sk.startswith("NODE#"):
                n = _node(data); nodes[n.id] = n
            elif sk.startswith("READING#"):
                r = _reading(data); readings[r.meter_id].append(r)
            elif sk.startswith("BALANCE#"):
                balances.append(_balance(data))
            elif sk.startswith("INCIDENT#"):
                i = _incident(data); incidents[i.id] = i
            elif sk.startswith("AUDIT#"):
                audit.append(_audit(data))
            elif sk.startswith("IDEMPOTENCY#") and item.get("status") == "DONE":
                processed.add(sk.split("#", 1)[1])
            elif sk == "STATE#PERSISTENCE":
                persistence = {k: int(v) for k, v in data.get("counts", data).items() if k != "last_interval"}
                persistence_last_interval = {k: str(v) for k, v in data.get("last_interval", {}).items()}
            elif sk == "CONFIG#SETTINGS":
                settings = _settings(data)
            elif sk == "STATE#DEMO":
                scenario = data.get("scenario", "normal")
                scenario_step = int(data.get("step", 0))
                scenario_running = bool(data.get("running", False))

        if not nodes:
            nodes = seed_nodes()
        for values in readings.values():
            values.sort(key=lambda x: (x.timestamp, x.event_id))
        balances.sort(key=lambda x: (x.interval_end, x.node_id))
        audit.sort(key=lambda x: x.timestamp)
        return LocalStore(
            nodes=nodes,
            readings=readings,
            balances=balances,
            incidents=incidents,
            audit=audit,
            processed_event_ids=processed,
            persistence=persistence,
            persistence_last_interval=persistence_last_interval,
            scenario=scenario,
            scenario_step=scenario_step,
            scenario_running=scenario_running,
            settings=settings,
        )

    def save_store(self, store: LocalStore, site_id: str = "northbridge") -> None:
        pk = self.pk(site_id)
        with self.table.batch_writer(overwrite_by_pkeys=["pk", "sk"]) as batch:
            for node in store.nodes.values():
                batch.put_item(Item={"pk": pk, "sk": f"NODE#{node.id}", "entity": "NODE", "payload": _payload(node)})
            batch.put_item(Item={"pk": pk, "sk": "CONFIG#SETTINGS", "entity": "CONFIG", "payload": _payload(store.settings)})
            batch.put_item(Item={"pk": pk, "sk": "STATE#PERSISTENCE", "entity": "STATE", "payload": json.dumps({"counts": store.persistence, "last_interval": store.persistence_last_interval}, sort_keys=True)})
            for rows in store.readings.values():
                for reading in rows:
                    batch.put_item(Item={
                        "pk": pk,
                        "sk": f"READING#{reading.meter_id}#{reading.timestamp}#{reading.event_id}",
                        "entity": "READING",
                        "meter_id": reading.meter_id,
                        "timestamp": reading.timestamp,
                        "payload": _payload(reading),
                    })
            for balance in store.balances:
                batch.put_item(Item={
                    "pk": pk,
                    "sk": f"BALANCE#{balance.interval_end}#{balance.node_id}",
                    "entity": "BALANCE",
                    "timestamp": balance.interval_end,
                    "payload": _payload(balance),
                })
            for incident in store.incidents.values():
                batch.put_item(Item={
                    "pk": pk,
                    "sk": f"INCIDENT#{incident.id}",
                    "entity": "INCIDENT",
                    "status": incident.status.value,
                    "payload": _payload(incident),
                })
            for event in store.audit:
                digest = hashlib.sha1(_payload(event).encode()).hexdigest()[:12]
                batch.put_item(Item={
                    "pk": pk,
                    "sk": f"AUDIT#{event.timestamp}#{digest}",
                    "entity": "AUDIT",
                    "timestamp": event.timestamp,
                    "payload": _payload(event),
                })
            for event_id in store.processed_event_ids:
                batch.put_item(Item={
                    "pk": pk,
                    "sk": f"IDEMPOTENCY#{event_id}",
                    "entity": "IDEMPOTENCY",
                    "status": "DONE",
                    "payload": "{}",
                })

    def claim_event(self, site_id: str, event_id: str) -> bool:
        try:
            self.table.put_item(
                Item={"pk": self.pk(site_id), "sk": f"IDEMPOTENCY#{event_id}", "entity": "IDEMPOTENCY", "status": "PROCESSING", "payload": "{}"},
                ConditionExpression="attribute_not_exists(sk)",
            )
            return True
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return False
            raise

    def mark_event_done(self, site_id: str, event_id: str) -> None:
        self.table.update_item(
            Key={"pk": self.pk(site_id), "sk": f"IDEMPOTENCY#{event_id}"},
            UpdateExpression="SET #s=:done",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":done": "DONE"},
        )

    def release_event(self, site_id: str, event_id: str) -> None:
        self.table.delete_item(Key={"pk": self.pk(site_id), "sk": f"IDEMPOTENCY#{event_id}"})

    def is_processed(self, site_id: str, event_id: str) -> bool:
        response = self.table.get_item(Key={"pk": self.pk(site_id), "sk": f"IDEMPOTENCY#{event_id}"}, ConsistentRead=True)
        return response.get("Item", {}).get("status") == "DONE"

    def save_settings(self, site_id: str, settings: SiteSettings) -> None:
        self.table.put_item(Item={"pk": self.pk(site_id), "sk": "CONFIG#SETTINGS", "entity": "CONFIG", "payload": _payload(settings)})

    def get_demo_state(self, site_id: str = "northbridge") -> dict[str, Any] | None:
        response = self.table.get_item(Key={"pk": self.pk(site_id), "sk": "STATE#DEMO"}, ConsistentRead=True)
        item = response.get("Item")
        return _load_payload(item) if item else None

    def save_demo_state(self, state: dict[str, Any], site_id: str = "northbridge") -> None:
        self.table.put_item(Item={"pk": self.pk(site_id), "sk": "STATE#DEMO", "entity": "STATE", "payload": json.dumps(state, separators=(",", ":"), sort_keys=True)})

    def clear_operational_state(self, site_id: str = "northbridge") -> None:
        pk = self.pk(site_id)
        items = self._all_items(site_id)
        keep = ("NODE#", "CONFIG#")
        with self.table.batch_writer() as batch:
            for item in items:
                sk = item["sk"]
                if sk.startswith(keep):
                    continue
                batch.delete_item(Key={"pk": pk, "sk": sk})
