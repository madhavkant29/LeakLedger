# ADR-001 — Event-driven meter ingestion

Meter observations are immutable events. In AWS mode the implemented path is:

```text
API Gateway -> API Lambda -> S3 archive + EventBridge -> SQS -> reconciliation worker -> DynamoDB
```

This enables replay, idempotency, failure isolation and an auditable evidence chain while keeping the deterministic reconciliation engine independent of AWS transport code.
