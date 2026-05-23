# server/tests/test_http.py
import json
from granbridge_broker.http import json_response, origin_allowed
from granbridge_broker.broker import BrokerServer


def test_json_response_shape():
    resp = json_response(200, {"ok": True})
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "application/json"
    assert resp.headers["Access-Control-Allow-Origin"] == "*"
    assert json.loads(resp.body)["ok"] is True


def test_origin_allowed_permissive_when_unset():
    assert origin_allowed(None, None) is True
    assert origin_allowed("https://evil.test", None) is True


def test_origin_allowed_enforced_when_set():
    allowed = ("https://app.example.com",)
    assert origin_allowed("https://app.example.com", allowed) is True
    assert origin_allowed("https://evil.test", allowed) is False
    assert origin_allowed(None, allowed) is False


def test_broker_http_route_healthz_and_turn():
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="play.example.com")
    health = s._http_route("/healthz")
    assert health.status_code == 200
    body = json.loads(health.body)
    assert body["status"] == "ok" and body["rooms"] == 0 and body["peers"] == 0

    turn = s._http_route("/turn")
    assert turn.status_code == 200
    tbody = json.loads(turn.body)
    assert tbody["username"] and tbody["credential"]
    assert tbody["uris"][0] == "turn:play.example.com:3478?transport=udp"

    assert s._http_route("/anything-else") is None
