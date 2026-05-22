from granbridge.config import Settings

def test_defaults_present():
    s = Settings()
    assert s.ws_host == "127.0.0.1" and s.ws_port == 8787
    assert s.board_name_prefix == "GRAN"
    assert s.vendor_service_uuid == "442f1570-8a00-9a28-cbe1-e1d4212d53eb"

def test_env_override(monkeypatch):
    monkeypatch.setenv("GRANBRIDGE_WS_PORT", "9999")
    assert Settings().ws_port == 9999
