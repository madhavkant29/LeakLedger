"""SQS reconciliation worker for the deployed AWS runtime.

EventBridge wraps MeterReadingReceived events before delivering them to SQS. Records
are grouped by site + meter timestamp so one physical interval is reconciled once per
SQS batch rather than once for each sibling meter event.
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict

from app.aws.runtime import AwsRuntime
from app.domain.models import MeterReading

logger = logging.getLogger()
logger.setLevel(logging.INFO)
_runtime: AwsRuntime | None = None


def runtime() -> AwsRuntime:
    global _runtime
    if _runtime is None:
        _runtime = AwsRuntime()
    return _runtime


def lambda_handler(event, context):
    failures: list[dict[str, str]] = []
    groups: dict[tuple[str, str], list[tuple[str, MeterReading]]] = defaultdict(list)

    for record in event.get("Records", []):
        message_id = record.get("messageId", "unknown")
        try:
            body = json.loads(record["body"])
            detail = body.get("detail", body)
            reading = MeterReading(**detail)
            groups[(reading.site_id, reading.timestamp)].append((message_id, reading))
        except Exception:
            logger.exception("Failed to parse reconciliation message")
            failures.append({"itemIdentifier": message_id})

    for (site_id, timestamp), entries in groups.items():
        try:
            logger.info(json.dumps({
                "eventType": "ReconciliationBatchReceived",
                "siteId": site_id,
                "timestamp": timestamp,
                "messageCount": len(entries),
                "eventIds": [r.event_id for _, r in entries],
            }))
            result = runtime().process_readings([r for _, r in entries])
            logger.info(json.dumps({
                "eventType": "ReconciliationBatchProcessed",
                "siteId": site_id,
                "timestamp": timestamp,
                "result": result,
            }, default=str))
        except Exception:
            logger.exception("Failed to process reconciliation batch")
            failures.extend({"itemIdentifier": message_id} for message_id, _ in entries)

    return {"batchItemFailures": failures}
