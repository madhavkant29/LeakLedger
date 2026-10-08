# Three-minute demo script

## 0:00–0:15 — Landing

“Facilities can know how much water entered and still have no idea where thousands of litres disappeared. LeakLedger turns existing meters into an auditable water ledger and refuses to call something a leak unless the evidence supports it.”

Open **Live Demo**.

## 0:15–0:30 — Persona + balanced topology

Choose **User 1 — Aarav Mehta, Facility Manager**.

Open **Meter Topology** and show the balanced fictional campus. Point out that unmetered and buffered branches are represented explicitly rather than hidden.

## 0:30–0:55 — Hidden loss

Open **Replay Lab** -> **Hidden Hostel B loss** -> Reset -> Run.

Explain that the replay emits ordinary cumulative meter readings. It does not toggle an incident directly.

Wait until the required third anomalous interval opens the incident.

## 0:55–1:15 — Exact arithmetic and localisation

Open **Incidents**.

Show:

```text
Entered
- measured downstream
- known unmetered
- storage change
= unexplained water
```

Then show:

- evidence quality
- meter coverage
- completeness
- clock alignment
- `Deepest trustworthy anomaly: HOSTEL-B-MAIN`
- the explanation for why localisation stops at the common unmetered boundary

## 1:15–1:35 — Fail closed

Replay Lab -> **Missing meter — fail closed**.

Run until the Hostel B incident is established. The scenario then stops emitting the Floor 2 observation.

Show the existing incident change to **EVIDENCE_INSUFFICIENT** rather than becoming more confident from missing data.

Line to use:

“Missing observability removes confidence. It never becomes evidence for a leak.”

## 1:35–1:55 — Repair handoff

Replay Lab -> **Successful repair verification** and run until the incident opens.

Switch persona to **User 2 — Neha Sharma, Maintenance Engineer**.

Open the incident and **Record repair**.

Point out the explanatory text: submitting the repair moves the case to `VERIFYING`; it does not resolve it.

## 1:55–2:15 — Verify the repair

Continue replay.

Show:

```text
Verification 1/3
Verification 2/3
Verification 3/3
RESOLVED
```

The hidden loss stops only after the repair action exists, so the verification is causal rather than a pre-scripted timestamp change.

## 2:15–2:35 — Audit trail

Open **Audit Trail**.

Show the sequence:

```text
MeterReadingReceived
-> ReconciliationCompleted
-> IncidentOpened
-> repair transition
-> verification evidence
-> RepairVerified
```

Expand one row to show the event payload and correlation ID.

## 2:35–2:50 — AWS architecture

Show the architecture diagram/README and, after deployment, the live CloudWatch dashboard:

```text
API Gateway -> Lambda -> S3 + EventBridge -> SQS -> worker -> DynamoDB
```

Mention event idempotency and the guard that prevents one physical interval from advancing persistence more than once.

## 2:50–3:00 — Validation + close

Open **Validation** and show controlled scenario results.

Close with:

“LeakLedger doesn't guess where water went. It reconciles it.”
