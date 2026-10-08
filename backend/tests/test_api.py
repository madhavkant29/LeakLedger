import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    r = client.get('/health')
    assert r.status_code == 200
    assert r.json()['ok'] is True


def test_demo_reset_and_step():
    r = client.post('/demo/reset', json={'scenario': 'hidden-leak'})
    assert r.status_code == 200
    for _ in range(6):
        r = client.post('/demo/step')
        assert r.status_code == 200
    incidents = client.get('/sites/northbridge/incidents').json()
    assert incidents
    assert incidents[0]['node_id'] == 'HOSTEL-B-MAIN'
