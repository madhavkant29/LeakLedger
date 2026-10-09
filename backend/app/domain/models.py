from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional, Any


class NodeKind(str, Enum):
    METER = "METER"
    UNMETERED = "UNMETERED"
    STORAGE = "STORAGE"


class BalanceState(str, Enum):
    BALANCED = "BALANCED"
    ANOMALOUS = "ANOMALOUS"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    DATA_QUALITY_FAILURE = "DATA_QUALITY_FAILURE"
    UNMETERED = "UNMETERED"
    BUFFERED = "BUFFERED"
    STALE = "STALE"


class EvidenceQuality(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    INSUFFICIENT = "INSUFFICIENT"


class IncidentStatus(str, Enum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    INVESTIGATING = "INVESTIGATING"
    REPAIR_REPORTED = "REPAIR_REPORTED"
    VERIFYING = "VERIFYING"
    RESOLVED = "RESOLVED"
    REPAIR_FAILED = "REPAIR_FAILED"
    EVIDENCE_INSUFFICIENT = "EVIDENCE_INSUFFICIENT"




@dataclass
class SiteSettings:
    minimum_residual_m3: float = 0.05
    minimum_residual_ratio: float = 0.08
    persistence_intervals: int = 3
    minimum_coverage: float = 0.85
    freshness_limit_seconds: int = 1800
    alignment_tolerance_seconds: int = 120
    verification_required_intervals: int = 3
    quiet_hours_start: str = "00:00"
    quiet_hours_end: str = "05:00"
    site_timezone: str = "Asia/Kolkata"

@dataclass
class MeterNode:
    id: str
    label: str
    parent_id: Optional[str]
    kind: NodeKind = NodeKind.METER
    unit: str = "m3"
    active: bool = True
    expected_interval_minutes: int = 15
    known_unmetered_m3_per_interval: float = 0.0
    storage_capacity_m3: Optional[float] = None
    storage_change_m3_per_interval: Optional[float] = None
    buffered: bool = False


@dataclass
class MeterReading:
    event_id: str
    meter_id: str
    timestamp: str
    cumulative_m3: float
    site_id: str = "northbridge"
    source: str = "simulator"
    schema_version: int = 1


@dataclass
class BalanceResult:
    node_id: str
    interval_start: str
    interval_end: str
    inflow_m3: float
    measured_children_m3: float
    known_unmetered_m3: float
    storage_change_m3: float
    residual_m3: float
    residual_ratio: float
    coverage: float
    completeness: float
    freshness_seconds: float
    alignment_valid: bool
    state: BalanceState
    evidence_quality: EvidenceQuality
    explanation: str
    stop_reason: Optional[str] = None


@dataclass
class IncidentEvent:
    timestamp: str
    event_type: str
    actor: str
    detail: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class RepairAction:
    timestamp: str
    actor: str
    repair_type: str
    location: str
    notes: str
    cost: Optional[float] = None
    cause: Optional[str] = None


@dataclass
class Incident:
    id: str
    site_id: str
    node_id: str
    status: IncidentStatus
    opened_at: str
    residual_m3: float
    residual_ratio: float
    persistence_count: int
    evidence_quality: EvidenceQuality
    deepest_trustworthy_node_id: str
    boundary_explanation: str
    events: list[IncidentEvent] = field(default_factory=list)
    repair: Optional[RepairAction] = None
    verification_valid_intervals: int = 0
    verification_required_intervals: int = 3
    pre_repair_residual_rate: Optional[float] = None
    post_repair_residuals: list[float] = field(default_factory=list)
    verification_last_interval_end: Optional[str] = None
    pre_evidence_status: Optional[str] = None
    verification_floor_interval_end: Optional[str] = None
    status_basis_interval_end: Optional[str] = None
    verification_evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class AuditEvent:
    timestamp: str
    event_type: str
    detail: str
    actor: str = "system"
    correlation_id: Optional[str] = None
    payload: dict[str, Any] = field(default_factory=dict)


def to_dict(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        result = asdict(value)
        return _normalize(result)
    return _normalize(value)


def _normalize(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    return value
