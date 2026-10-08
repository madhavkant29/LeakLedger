from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.domain.models import MeterReading

BASE_INTERVAL_M3 = {
    "HOSTEL-A-F1": 1.45,
    "HOSTEL-A-F2": 1.35,
    "HOSTEL-B-F1": 1.75,
    "HOSTEL-B-F2": 1.65,
    "MESS-MAIN": 1.10,
    "SPORTS-BLOCK": 0.55,
}

START = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)


def demo_timestamp(step: int) -> str:
    return (START + timedelta(minutes=15 * step)).isoformat()


def initial_counters(meter_ids: list[str]) -> dict[str, float]:
    return {meter_id: 100.0 + i * 20 for i, meter_id in enumerate(sorted(meter_ids))}


@dataclass
class Snapshot:
    readings: list[MeterReading]
    counters: dict[str, float]
    hidden_loss_m3: float


def generate_snapshot(
    *,
    scenario: str,
    step: int,
    counters: dict[str, float],
    repair_reported: bool = False,
    site_id: str = "northbridge",
    generation: str = "",
) -> Snapshot:
    counters = dict(counters)
    leaf = dict(BASE_INTERVAL_M3)
    hidden_loss = 0.0

    if scenario in {"hidden-leak", "missing-reading", "repair", "failed-repair", "counter-reset"} and step >= 3:
        hidden_loss = 0.35
    if scenario == "repair" and repair_reported:
        hidden_loss = 0.0
    if scenario == "failed-repair" and repair_reported:
        hidden_loss = 0.32

    hostel_a = leaf["HOSTEL-A-F1"] + leaf["HOSTEL-A-F2"]
    hostel_b = leaf["HOSTEL-B-F1"] + leaf["HOSTEL-B-F2"] + 0.10 + hidden_loss
    campus = hostel_a + hostel_b + leaf["MESS-MAIN"] + leaf["SPORTS-BLOCK"]
    flows = {
        **leaf,
        "HOSTEL-A-MAIN": hostel_a,
        "HOSTEL-B-MAIN": hostel_b,
        "MAIN-CAMPUS": campus,
    }

    readings: list[MeterReading] = []
    for meter_id, flow in flows.items():
        if scenario == "missing-reading" and step in {7, 8} and meter_id == "HOSTEL-B-F2":
            continue
        if scenario == "counter-reset" and meter_id == "HOSTEL-B-F1" and step == 5:
            counters[meter_id] = 1.0
        else:
            counters[meter_id] = counters.get(meter_id, 100.0) + flow
        readings.append(MeterReading(
            event_id=f"demo-{generation + '-' if generation else ''}{scenario}-{step}-{meter_id}",
            meter_id=meter_id,
            timestamp=demo_timestamp(step),
            cumulative_m3=round(counters[meter_id], 6),
            site_id=site_id,
            source="simulator",
            schema_version=1,
        ))
    return Snapshot(readings=readings, counters=counters, hidden_loss_m3=hidden_loss)
