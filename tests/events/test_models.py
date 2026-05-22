import json
from granbridge.events.models import DartHit, Ring, ConnectionState, ErrorEvent, SCHEMA_VERSION

def test_dart_hit_serializes_with_required_fields():
    hit = DartHit(raw="12.3@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60)
    data = json.loads(hit.model_dump_json())
    assert data["schema_version"] == SCHEMA_VERSION
    assert data["type"] == "dart_hit"
    assert data["ring"] == "T"
    assert data["segment"] == 20 and data["score"] == 60
    assert data["timestamp"].endswith("Z")

def test_connection_state_optional_fields_default_none():
    cs = ConnectionState(state="connected", device="GRAN_BOARD")
    data = json.loads(cs.model_dump_json())
    assert data["state"] == "connected" and data["rssi"] is None

def test_error_event_recoverable_defaults_true():
    err = ErrorEvent(category="decode", message="unknown frame")
    assert err.recoverable is True
