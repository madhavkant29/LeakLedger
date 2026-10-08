# Domain model

## MeterNode
Represents a metered, unmetered or storage node in the directed water topology.

## MeterReading
Cumulative reading with immutable event id, meter id, timestamp, source and schema version.

## BalanceResult
The deterministic output for one node/interval: inflow, downstream volume, known unmetered consumption, storage adjustment, residual, coverage, completeness, evidence quality and state.

## Incident
A persisted operational case opened only after a trustworthy anomaly satisfies persistence thresholds.

## RepairAction
A human maintenance claim. It never directly resolves an incident.

## VerificationResult
Represented by consecutive valid post-repair balances inside the incident state machine.

## AuditEvent
Chronological explanation of meter ingestion, reconciliation, state transitions and verification.
