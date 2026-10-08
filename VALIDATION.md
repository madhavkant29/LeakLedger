# Validation performed before packaging

This file records what was actually verified in the build environment. It intentionally separates verified source/runtime behavior from deployment steps that require external credentials/network access.

## Backend domain + API + AWS runtime contracts

Executed:

```text
cd backend
pytest -q
```

Result at packaging time:

```text
22 passed
```

The suite covers:

- balanced/normal operation
- hidden Hostel B loss and correct localisation
- missing-reading fail-closed behavior after an incident exists
- cumulative counter reset handling
- duplicate event idempotency
- litre -> m³ normalization
- unsupported unit rejection
- child/accounted flow contradicting parent -> data-quality failure
- stale/incomplete evidence handling
- editable deterministic settings
- topology accounting configuration
- controlled `/demo/validation` endpoint
- successful repair verification
- failed repair rejection
- same physical interval cannot advance anomaly persistence twice
- same interval cannot advance repair verification twice
- S3 raw archive contract
- EventBridge publishing contract
- CloudWatch metric contract
- SQS parsing/grouping/partial-failure contract
- in-memory AWS-runtime batch integration proving: distinct anomalous intervals -> one incident -> repair -> three distinct healthy intervals -> `RESOLVED`

## Python source compilation

Python application source is included as ordinary importable modules and is exercised by the test suite. The backend test run imports the API, deterministic engine, DynamoDB repository contract, AWS services/runtime and SQS worker.


## Live FastAPI workflow smoke check

A `TestClient` workflow was executed against the assembled FastAPI application after the final domain changes:

```text
hidden loss -> HOSTEL-B-MAIN / OPEN / 0.350 m³ / HIGH evidence
missing meter after incident -> EVIDENCE_INSUFFICIENT / DATA_QUALITY_FAILURE
repair report -> VERIFYING
three distinct healthy intervals -> RESOLVED / 3 of 3
```

This verifies that the judge-facing story is produced by actual API/domain state transitions rather than frontend-only animation.

## Frontend TypeScript source validation

The packaging environment cannot reach the npm registry, so project dependencies cannot be freshly installed here and a dependency-backed `next build` cannot honestly be claimed.

A strict TypeScript source check was run with the globally installed TypeScript compiler using temporary declarations for unavailable external packages. The check included all application/component/library `.ts` and `.tsx` sources and passed with no TypeScript source errors.

The temporary validation declarations are not part of the packaged project.

For full dependency-backed validation on a networked machine:

```text
cd frontend
npm install
npm run typecheck
npm run build
```

`next.config.mjs` uses static export mode so the production frontend output is written to `frontend/out` and copied to `dist/frontend` by the build script.

## Infrastructure source validation

The CDK stack source is included and was source/syntax-audited in the packaging environment. It defines the complete intended pre-deployment resource graph:

- HTTP API + API Lambda
- worker Lambda
- DynamoDB
- S3 raw archive
- EventBridge custom bus/rule
- SQS + DLQ
- CloudWatch dashboard + DLQ alarm
- frontend S3 + CloudFront deployment

A dependency-backed `npm run build` / `cdk synth` could not be executed here for the same npm-registry network reason. Run on a networked machine before the actual AWS deployment:

```text
make build-artifacts
cd infrastructure
npm install
npm run build
npm run synth
```

## Deployment status

**Not deployed.** No AWS resources were created or modified from this packaging environment. That is the intentionally remaining step requested by the user.
