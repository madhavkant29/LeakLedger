# Architecture

LeakLedger deliberately keeps transport/persistence concerns outside the deterministic water-accounting domain. The same reconciliation and incident services run in local mode and AWS mode.

## Local mode

```text
Next.js UI
   |
FastAPI
   |
LocalStore
   |
ReconciliationEngine
   |
IncidentService
   |
Audit trail + deterministic replay simulator
```

The simulator emits cumulative meter observations into the same backend ingestion/reconciliation path used by manual and CSV input. The frontend never creates an anomaly or incident directly.

## AWS mode implemented in source

```text
Meter / BMS / CSV / Demo API
             |
       API Gateway HTTP API
             |
          API Lambda
          /        \
         /          \
S3 raw archive    EventBridge
                    |
               MeterReadingRule
                    |
               SQS + DLQ
                    |
         Reconciliation Worker Lambda
                    |
                DynamoDB
                    |
         domain events -> EventBridge
                    |
             CloudWatch metrics
```

The static Next.js export is served from a private S3 bucket through CloudFront. Production builds set `NEXT_PUBLIC_API_URL=/api`; CloudFront routes `api/*` to the HTTP API and strips the `/api` prefix at viewer request time. A separate CloudFront Function rewrites extensionless static application routes to `<route>/index.html` so direct/deep-link refreshes resolve correctly.

## API Lambda responsibilities

For an incoming reading in AWS mode:

1. validate meter ID, timestamp and unit
2. normalize to m³
3. check already-completed idempotency key
4. archive the immutable raw event in S3
5. publish `MeterReadingReceived` to the custom EventBridge bus
6. return queue acceptance metadata

The API Lambda does not run the full reconciliation synchronously.

## Worker responsibilities

EventBridge routes meter events into SQS. The worker:

1. parses the EventBridge envelope
2. groups records by `(site_id, meter timestamp)`
3. conditionally claims each event ID in DynamoDB
4. loads persistent site state
5. appends accepted readings
6. executes the deterministic reconciliation engine
7. evaluates incident/persistence/repair state
8. persists balances, incidents and audit events
9. marks claimed events complete
10. emits custom CloudWatch metrics
11. publishes incident outcome domain events

SQS partial-batch responses identify failed messages for retry instead of replaying the entire successful batch.

## Why records are grouped by physical interval

A site interval may contain many sibling meter readings. If each SQS message independently advanced anomaly persistence, transport order could fabricate “three consecutive anomalous intervals” from one physical interval.

LeakLedger prevents that in two layers:

- the worker groups sibling records by site + meter timestamp when they appear in the same batch
- the domain tracks the last interval that changed persistence/verification state and refuses to count that interval twice

This remains safe if messages are split across SQS batches.

## Persistence model

DynamoDB stores site-scoped entities using a partition key such as `SITE#northbridge` and typed sort keys for:

- nodes/topology
- settings
- meter readings
- reconciled balances
- incidents
- audit events
- idempotency records
- demo replay state

`ensure_seed()` uses conditional writes for seed/config records so an application restart does not overwrite operator-edited topology/settings.

## Raw-event archive

Every AWS-ingested reading is written to S3 before EventBridge publication using a date-partitioned key:

```text
meter-events/site=<site>/year=YYYY/month=MM/day=DD/<event-id>.json
```

Object metadata includes event ID, meter ID and schema version.

## Idempotency

Every reading carries an `event_id`.

In AWS mode, the worker uses a DynamoDB conditional put to claim:

```text
IDEMPOTENCY#<event_id>
```

States transition from `PROCESSING` to `DONE`. A failed worker releases its claims before rethrowing so SQS retry can process the event. Completed duplicates are ignored and recorded in `DuplicateEventsIgnored`.

## Observability

The AWS runtime emits structured Lambda logs plus CloudWatch metrics:

- ReadingsProcessed
- ReconciliationsCompleted
- BalanceViolations
- DataQualityFailures
- IncidentsOpened
- RepairsVerified
- RepairsFailed
- DuplicateEventsIgnored
- ProcessingLatency

The CDK stack creates an operations dashboard and an alarm for any message entering the DLQ.

## Fail-closed boundary

Transport failure and evidence uncertainty are separate concepts.

- SQS retry/DLQ is a delivery concern.
- missing, stale, contradictory or uncovered meter data is a domain-evidence concern.

The domain engine never turns a transport or evidence gap into a confident leak location.
