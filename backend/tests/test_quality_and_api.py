import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from app.main import app
from app.domain.models import BalanceState, MeterReading
from app.repositories.memory import LocalStore
from app.services.reconciliation import ReconciliationEngine, ReconciliationConfig
from app.simulator.seed import seed_nodes

client = TestClient(app)


def test_litre_input_is_normalized_to_cubic_metres():
    client.post('/demo/reset', json={'scenario': 'normal'})
    response = client.post('/sites/northbridge/readings', json={
        'event_id': 'unit-test-litres',
        'meter_id': 'MAIN-CAMPUS',
        'timestamp': '2026-10-08T10:00:00+00:00',
        'cumulative_m3': 123000,
        'unit': 'L',
        'source': 'test',
    })
    assert response.status_code == 200
    rows = client.get('/sites/northbridge/readings?meter_id=MAIN-CAMPUS&limit=1').json()
    assert rows[-1]['cumulative_m3'] == 123.0


def test_unsupported_unit_is_rejected():
    response = client.post('/sites/northbridge/readings', json={
        'event_id': 'unit-test-gallons',
        'meter_id': 'MAIN-CAMPUS',
        'timestamp': '2026-10-08T10:15:00+00:00',
        'cumulative_m3': 100,
        'unit': 'gallons',
    })
    assert response.status_code == 400
    assert 'Unsupported unit' in response.text


def test_children_greater_than_parent_is_data_quality_failure():
    store = LocalStore(nodes=seed_nodes())
    t0 = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)
    t1 = t0 + timedelta(minutes=15)
    deltas = {
        'MAIN-CAMPUS': 5.0,
        'HOSTEL-A-MAIN': 2.8,
        'HOSTEL-B-MAIN': 4.0,
        'MESS-MAIN': 1.1,
        'SPORTS-BLOCK': 0.55,
        'HOSTEL-A-F1': 1.45,
        'HOSTEL-A-F2': 1.35,
        'HOSTEL-B-F1': 1.75,
        'HOSTEL-B-F2': 1.65,
    }
    for meter_id, delta in deltas.items():
        store.readings[meter_id] = [
            MeterReading(event_id=f'{meter_id}-0', meter_id=meter_id, timestamp=t0.isoformat(), cumulative_m3=100.0),
            MeterReading(event_id=f'{meter_id}-1', meter_id=meter_id, timestamp=t1.isoformat(), cumulative_m3=100.0 + delta),
        ]
    engine = ReconciliationEngine(ReconciliationConfig())
    root = engine.reconcile_node(store, store.nodes['MAIN-CAMPUS'])
    assert root.state == BalanceState.DATA_QUALITY_FAILURE
    assert 'exceeds parent inflow' in root.explanation


def test_stale_meter_fails_closed():
    store = LocalStore(nodes=seed_nodes())
    base = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
    current = base + timedelta(hours=1)
    # Parent has a fresh pair; children have valid pairs ending 1h behind the site reference.
    for meter_id in ['MAIN-CAMPUS']:
        store.readings[meter_id] = [
            MeterReading(event_id=f'{meter_id}-0', meter_id=meter_id, timestamp=(current-timedelta(minutes=15)).isoformat(), cumulative_m3=100),
            MeterReading(event_id=f'{meter_id}-1', meter_id=meter_id, timestamp=current.isoformat(), cumulative_m3=108.95),
        ]
    for meter_id, delta in [('HOSTEL-A-MAIN',2.8),('HOSTEL-B-MAIN',3.5),('MESS-MAIN',1.1),('SPORTS-BLOCK',0.55)]:
        store.readings[meter_id] = [
            MeterReading(event_id=f'{meter_id}-0', meter_id=meter_id, timestamp=(base-timedelta(minutes=15)).isoformat(), cumulative_m3=100),
            MeterReading(event_id=f'{meter_id}-1', meter_id=meter_id, timestamp=base.isoformat(), cumulative_m3=100+delta),
        ]
    engine = ReconciliationEngine(ReconciliationConfig(freshness_limit_seconds=1800))
    result = engine.reconcile_node(store, store.nodes['MAIN-CAMPUS'])
    # The root itself is fresh, but child timestamp misalignment still prevents a leak conclusion.
    assert result.state in {BalanceState.DATA_QUALITY_FAILURE, BalanceState.INSUFFICIENT_DATA, BalanceState.STALE}
    assert result.evidence_quality.value == 'INSUFFICIENT'


def test_settings_and_topology_config_are_editable():
    settings = client.get('/sites/northbridge/settings').json()
    settings['persistence_intervals'] = 4
    response = client.put('/sites/northbridge/settings', json=settings)
    assert response.status_code == 200
    assert response.json()['persistence_intervals'] == 4
    # Restore default to avoid cross-test surprises.
    settings['persistence_intervals'] = 3
    client.put('/sites/northbridge/settings', json=settings)

    topology = client.get('/sites/northbridge/topology').json()['nodes']
    node = next(n for n in topology if n['id'] == 'HOSTEL-B-COMMON')
    response = client.put('/sites/northbridge/topology/HOSTEL-B-COMMON', json={
        'expected_interval_minutes': node['expected_interval_minutes'],
        'known_unmetered_m3_per_interval': 0.12,
        'buffered': node['buffered'],
        'storage_capacity_m3': node['storage_capacity_m3'],
        'storage_change_m3_per_interval': node.get('storage_change_m3_per_interval'),
        'active': node['active'],
    })
    assert response.status_code == 200
    assert response.json()['known_unmetered_m3_per_interval'] == 0.12
    # Restore seed value.
    body = response.json()
    body['known_unmetered_m3_per_interval'] = 0.10
    client.put('/sites/northbridge/topology/HOSTEL-B-COMMON', json={k: body[k] for k in ['expected_interval_minutes','known_unmetered_m3_per_interval','buffered','storage_capacity_m3','storage_change_m3_per_interval','active']})


def test_controlled_validation_endpoint_passes():
    response = client.get('/demo/validation')
    assert response.status_code == 200
    data = response.json()
    assert data['passed'] is True
    assert all(item['passed'] for item in data['results'])
