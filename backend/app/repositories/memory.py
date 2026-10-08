from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Optional

from app.domain.models import MeterNode, MeterReading, BalanceResult, Incident, AuditEvent, SiteSettings


@dataclass
class LocalStore:
    nodes: dict[str, MeterNode] = field(default_factory=dict)
    readings: dict[str, list[MeterReading]] = field(default_factory=lambda: defaultdict(list))
    balances: list[BalanceResult] = field(default_factory=list)
    incidents: dict[str, Incident] = field(default_factory=dict)
    audit: list[AuditEvent] = field(default_factory=list)
    processed_event_ids: set[str] = field(default_factory=set)
    persistence: dict[str, int] = field(default_factory=dict)
    persistence_last_interval: dict[str, str] = field(default_factory=dict)
    scenario: str = "normal"
    scenario_step: int = 0
    scenario_running: bool = False
    demo_user: str = "Aarav Mehta"
    settings: SiteSettings = field(default_factory=SiteSettings)

    def reset(self) -> None:
        self.readings = defaultdict(list)
        self.balances = []
        self.incidents = {}
        self.audit = []
        self.processed_event_ids = set()
        self.persistence = {}
        self.persistence_last_interval = {}
        self.scenario_step = 0
        self.scenario_running = False

    def latest_two(self, meter_id: str) -> list[MeterReading]:
        return self.readings.get(meter_id, [])[-2:]

    def latest(self, meter_id: str) -> Optional[MeterReading]:
        rows = self.readings.get(meter_id, [])
        return rows[-1] if rows else None

    def clone(self) -> "LocalStore":
        return deepcopy(self)
