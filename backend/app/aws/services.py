from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import boto3

from app.domain.models import MeterReading, to_dict

logger = logging.getLogger(__name__)


class S3RawEventArchive:
    def __init__(self, bucket: str, s3_client=None):
        self.bucket = bucket
        self.s3 = s3_client or boto3.client("s3")

    def archive(self, reading: MeterReading) -> str:
        ts = datetime.fromisoformat(reading.timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
        key = f"meter-events/site={reading.site_id}/year={ts:%Y}/month={ts:%m}/day={ts:%d}/{reading.event_id}.json"
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=json.dumps(to_dict(reading), separators=(",", ":"), sort_keys=True).encode("utf-8"),
            ContentType="application/json",
            Metadata={"event-id": reading.event_id, "meter-id": reading.meter_id, "schema-version": str(reading.schema_version)},
        )
        return key


class EventBridgePublisher:
    def __init__(self, event_bus_name: str, client=None):
        self.event_bus_name = event_bus_name
        self.client = client or boto3.client("events")

    def publish_meter_reading(self, reading: MeterReading) -> str:
        response = self.client.put_events(Entries=[{
            "Source": "leakledger.meters",
            "DetailType": "MeterReadingReceived",
            "Detail": json.dumps(to_dict(reading), separators=(",", ":"), sort_keys=True),
            "EventBusName": self.event_bus_name,
        }])
        if response.get("FailedEntryCount", 0):
            raise RuntimeError(f"EventBridge rejected meter event: {response.get('Entries')}")
        return response.get("Entries", [{}])[0].get("EventId", "")

    def publish_domain_event(self, event_type: str, site_id: str, detail: dict[str, Any]) -> str:
        payload = {"site_id": site_id, **detail}
        response = self.client.put_events(Entries=[{
            "Source": "leakledger.domain",
            "DetailType": event_type,
            "Detail": json.dumps(payload, separators=(",", ":"), sort_keys=True),
            "EventBusName": self.event_bus_name,
        }])
        if response.get("FailedEntryCount", 0):
            raise RuntimeError(f"EventBridge rejected domain event: {response.get('Entries')}")
        return response.get("Entries", [{}])[0].get("EventId", "")


class CloudWatchMetrics:
    NAMESPACE = "LeakLedger"

    def __init__(self, client=None):
        self.client = client or boto3.client("cloudwatch")

    def increment(self, metric_name: str, value: float = 1.0, site_id: str = "northbridge") -> None:
        self.client.put_metric_data(
            Namespace=self.NAMESPACE,
            MetricData=[{
                "MetricName": metric_name,
                "Dimensions": [{"Name": "SiteId", "Value": site_id}],
                "Value": value,
                "Unit": "Count",
            }],
        )

    def timing(self, metric_name: str, milliseconds: float, site_id: str = "northbridge") -> None:
        self.client.put_metric_data(
            Namespace=self.NAMESPACE,
            MetricData=[{
                "MetricName": metric_name,
                "Dimensions": [{"Name": "SiteId", "Value": site_id}],
                "Value": milliseconds,
                "Unit": "Milliseconds",
            }],
        )
