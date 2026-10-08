# LeakLedger AWS deployment report

Date: 2026-10-08
Status: **SUCCESS (CloudFront path blocked by an account-level AWS gate; equivalent public HTTPS URL delivered via API Gateway)**

## Deployment

| Item | Value |
|---|---|
| AWS account | `4736xxxxxxxx` (principal `(deployer IAM user)`) |
| Region | `ap-south-1` |
| Stack | `LeakLedgerStack` |
| CDK bootstrap | `CDKToolkit` re-created with qualifier `leakledger` in `ap-south-1` |
| Toolchain | Python 3.12.3, Node 25.8.2, npm 11.11.1, AWS CLI 2.36.48, aws-cdk-lib/CLI 2.173.4 |

## Public URLs

| Purpose | URL |
|---|---|
| Public LeakLedger application | `https://8k133q1yyd.execute-api.ap-south-1.amazonaws.com` |
| API (same origin) | `https://8k133q1yyd.execute-api.ap-south-1.amazonaws.com/api/...` (also works without `/api`) |
| CloudWatch dashboard | `LeakLedgerStack-operations` in `ap-south-1` |
| DLQ alarm | `LeakLedgerStack-DLQAlarm77626DBA-tSGlS9A5DQ4J` |

## Deployed resources

- **Lambdas**: `ApiFunction` (`app.aws_handlers.api_handler`), `ReconciliationWorker` (`app.worker.lambda_handler`), Python 3.12, X-Ray active.
- **API**: API Gateway HTTP API with `/{proxy+}` + `/` routes (and `/api/*` prefix stripping in-app).
- **DynamoDB**: `LeakLedgerStack-StateTable9728C7E5-1B6VEDHPTPZJ9` (on-demand, PITR).
- **S3**: `leakledgerstack-rawmeterarchive1e3ee27b-vxtb33ebjmho` (private raw event archive; frontend bucket only exists when CloudFront is enabled).
- **EventBridge**: custom bus `LeakLedgerStackMeterEventBusB0B46993` + `MeterReadingReceived` rule.
- **SQS**: reconciliation queue + DLQ (`LeakLedgerStack-ReconciliationQueueD78F7A45-...`, `...-ReconciliationDLQ03234700-...`), event source `maxConcurrency: 2`.
- **Frontend serving**: API Lambda serves the bundled static Next.js export (`LEAKLEDGER_SERVE_FRONTEND=1`) because the account cannot create CloudFront distributions yet.
- **Observability**: CloudWatch dashboard, DLQ alarm, custom metrics namespace `LeakLedger`, structured logs, X-Ray.
- **Cost posture**: no NAT gateway, ECS/EKS, RDS, OpenSearch, Bedrock or SageMaker. Fully pay-per-use serverless.

## Verification results (production URL)

| Check | Result | Evidence |
|---|---|---|
| Backend tests | PASS | 22/22 |
| Next.js build + static export | PASS | 14 routes exported |
| Lambda packaging (manylinux wheels) | PASS | imports + compileall OK |
| CDK build / synth / diff review | PASS | additions limited to `LeakLedgerStack` |
| Public landing page + all routes direct refresh | PASS | `/`, `/signin`, `/overview`, `/ledger`, `/topology`, `/incidents`, `/replay`, `/meters`, `/audit`, `/settings`, `/validation` |
| `/api/health` on the public URL | PASS | `{"ok":true,"service":"leakledger-api","mode":"aws","version":"1.0.0"}` |
| Demo persona selector (no auth) | PASS | all three personas present, no localhost calls |
| Northbridge seeding | PASS | 10 topology nodes + settings in DynamoDB |
| Hidden leak | PASS | incident at `HOSTEL-B-MAIN`, 0.350 m³, HIGH evidence, OPEN |
| Missing reading fails closed | PASS | `DATA_QUALITY_FAILURE` balance, incident `EVIDENCE_INSUFFICIENT` |
| Repair flow | PASS | `VERIFYING` → 1/3 → 2/3 → 3/3 → `RESOLVED` |
| Failed repair | PASS | `REPAIR_FAILED` |
| Idempotency | PASS | duplicate `event_id` counted once; `DuplicateEventsIgnored` emitted |
| DynamoDB persistence | PASS | nodes, settings, readings, balances, incidents, audit, idempotency, demo state |
| S3 raw archive | PASS | meter-event objects with reading payloads; bucket private |
| EventBridge | PASS | custom bus + `MeterReadingReceived` rule |
| SQS worker | PASS | queue drains to zero; no errors |
| DLQ | PASS | empty during healthy operation |
| CloudWatch | PASS | dashboard widgets + all custom metrics present |
| X-Ray / logging | PASS | traces present; no ImportError/AccessDenied/timeout exceptions |
| Controlled validation endpoint | PASS | 7/7 deterministic checks |

## Changes made for deployment

Runtime correctness (AWS mode only; local semantics and tests unchanged):

1. `backend/app/repositories/dynamodb.py` — consistent reads for store loads; per-site DynamoDB write lock; crash-safe event claims with stale re-claim; reset now preserves topology, settings and idempotency records.
2. `backend/app/aws/runtime.py` — serialized load-modify-save via the write lock; settle window that reconciles only once a physical interval has all sibling meters (bounded deadline so genuine missing readings still fail closed); demo generation nonce; superseded-generation message rejection; out-of-order reading insertion.
3. `backend/app/services/reconciliation.py` — optional `require_reading_pairs` so partial SQS batches never persist wall-clock placeholder balances.
4. `backend/app/services/incidents.py` + `backend/app/domain/models.py` — evidence restoration returns an incident to its pre-gap status instead of silently `INVESTIGATING`.
5. `backend/app/simulator/generator.py` — generation-tagged demo event ids.
6. `backend/app/main.py` — `/api` prefix middleware; API mutations share the site write lock; static frontend serving when CloudFront is disabled.

Build/deployment:

7. `scripts/package_lambda.sh` — always packages manylinux2014 x86_64 wheels so the artifact runs on the Lambda Python 3.12 runtime regardless of build host OS.
8. `scripts/build_artifacts.sh` / `scripts/build_artifacts.ps1` — build order plus bundling the static export for the API-Gateway fallback.
9. `backend/requirements-dev.txt` — declares `pytest` + `httpx` needed by the test suite.
10. `infrastructure/lib/leakledger-stack.ts` — `leakledger:cloudfront` context flag (CloudFront vs API-Gateway frontend), SQS `maxConcurrency: 2`.
11. `infrastructure/cdk.json` — bootstrap qualifier `leakledger`; CloudFront disabled for this account.

## Remaining issue

CloudFront cannot be created in this account until AWS Support verifies it:
`Access denied ... Your account must be verified before you can add new CloudFront resources.`

The frontend is therefore served through the API Gateway HTTPS URL (same static export, all routes verified). Once the account is verified, set `"leakledger:cloudfront": "true"` in `infrastructure/cdk.json` and run `npx cdk deploy LeakLedgerStack` to switch to the designed S3+CloudFront edge without any application changes.
