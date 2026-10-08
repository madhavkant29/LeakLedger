from app.domain.models import MeterNode, NodeKind


def seed_nodes() -> dict[str, MeterNode]:
    nodes = [
        MeterNode("MAIN-CAMPUS", "Campus Main", None),
        MeterNode("HOSTEL-A-MAIN", "Hostel A Main", "MAIN-CAMPUS"),
        MeterNode("HOSTEL-A-F1", "Hostel A Floor 1", "HOSTEL-A-MAIN"),
        MeterNode("HOSTEL-A-F2", "Hostel A Floor 2", "HOSTEL-A-MAIN"),
        MeterNode("HOSTEL-B-MAIN", "Hostel B Main", "MAIN-CAMPUS"),
        MeterNode("HOSTEL-B-F1", "Hostel B Floor 1", "HOSTEL-B-MAIN"),
        MeterNode("HOSTEL-B-F2", "Hostel B Floor 2", "HOSTEL-B-MAIN"),
        MeterNode("HOSTEL-B-COMMON", "Hostel B Common Branch", "HOSTEL-B-MAIN", kind=NodeKind.UNMETERED, known_unmetered_m3_per_interval=0.10),
        MeterNode("MESS-MAIN", "Mess / Kitchen", "MAIN-CAMPUS"),
        MeterNode("SPORTS-BLOCK", "Sports Block Tank / Consumption", "MAIN-CAMPUS", buffered=True, storage_capacity_m3=12.0),
    ]
    return {n.id: n for n in nodes}
