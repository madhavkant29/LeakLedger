# Reconciliation engine

For a measured node `z` over interval `t`:

```text
Rz(t) = inflow
      - measured_children
      - known_unmetered
      - storage_change
```

`Rz(t)` is unexplained water. It is evidence, not automatically a leak verdict.

## Evidence gates

Before an interval can advance anomaly persistence, the engine validates:

- required observations exist
- readings are fresh enough
- timestamps align within tolerance
- cumulative counters are continuous
- child/accounted volume does not contradict parent volume
- downstream meter coverage meets the configured minimum
- storage/buffer configuration is explicit where required

If these gates fail, the interval becomes `INSUFFICIENT_DATA` or `DATA_QUALITY_FAILURE`. A missing observation never counts as another anomalous interval.

## Default anomaly rule

A high-evidence interval is anomaly-eligible when:

```text
residual >= 0.05 m³
AND residual / inflow >= 8%
AND evidence_quality == HIGH
```

The defaults are configurable from the Settings screen/API.

## Persistence

Opening an incident requires three **distinct valid anomalous reconciliation intervals** by default.

The engine records the most recent interval that affected persistence so repeated reconciliation of the same physical interval cannot increment the streak. This is important for asynchronous/event-driven AWS delivery where sibling meter readings may arrive independently.

## Recursive localisation

After persistence, localisation begins at a trustworthy anomalous branch and descends only when the evidence justifies the next step.

If exactly one measured child is itself a high-evidence anomaly, the algorithm can descend into that child. It stops when:

- no child remains anomalous
- multiple children are anomalous and no unique narrower branch is justified
- child evidence is incomplete
- an explicitly unmetered branch prevents a narrower claim
- a buffered/storage boundary reduces certainty

The returned result includes:

- deepest trustworthy node
- inspection boundary explanation
- coverage/completeness
- arithmetic behind the current balance
- reason traversal stopped

It intentionally does **not** claim the exact damaged pipe.

## Counter reset

Meters provide cumulative values. If a cumulative counter decreases, LeakLedger treats it as a counter epoch/reset rather than negative consumption. The affected interval fails data-quality validation and cannot create a false leak conclusion.

## Unit normalization

The API accepts cubic metres and litres and normalizes to m³ before domain processing. Unsupported units are rejected explicitly.

## Known unmetered use

A branch can be marked explicitly unmetered with a configured expected amount per interval. This amount is subtracted from the balance and the remaining coverage is surfaced. Unknown consumption is not silently labelled leakage.

## Storage/buffered nodes

Tank/storage behavior can make parent and child flow differ temporarily. A node may be marked `buffered` and supplied with configured storage change for the interval. If the required storage treatment is absent, the system exposes reduced certainty rather than forcing the imbalance into residual leakage.

## Repair verification

A maintenance action moves an incident to `VERIFYING`; it does not close it.

A successful repair requires the configured number of **distinct valid balanced intervals**. Reprocessing the same interval cannot advance the verification counter.

If unexplained loss remains above threshold across the required post-repair evidence sequence, the incident becomes `REPAIR_FAILED`.

Invalid evidence pauses verification rather than counting as either success or failure.
