import shutil, subprocess, time
import pytest
import smoke
from granbridge_broker.turn import make_turn_credentials

pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="docker not available")

SECRET = "smoke-test-secret"
REALM = "smoke.test"
NAME = "granbridge-smoke-coturn-test"


@pytest.fixture
def coturn():
    subprocess.run(["docker", "rm", "-f", NAME], capture_output=True)
    proc = subprocess.run(
        ["docker", "run", "-d", "--name", NAME, "-p", "3478:3478/udp",
         "coturn/coturn:4.6.2", "turnserver", "-n", "--no-tls", "--no-dtls",
         "--use-auth-secret", "--static-auth-secret", SECRET, "--realm", REALM,
         "--listening-port=3478", "--listening-ip=0.0.0.0",
         "--min-port=49152", "--max-port=49200"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    for _ in range(30):
        ok, _ = smoke.check_stun("127.0.0.1", 3478, timeout=0.5)
        if ok:
            break
        time.sleep(0.5)
    else:
        subprocess.run(["docker", "rm", "-f", NAME], capture_output=True)
        pytest.fail("coturn did not become reachable on UDP 3478")
    yield
    subprocess.run(["docker", "rm", "-f", NAME], capture_output=True)


def test_real_coturn_accepts_minted_creds(coturn):
    creds = make_turn_credentials(SECRET, REALM, ttl=300, now=time.time())
    ok, detail = smoke.check_turn_relay("127.0.0.1", 3478, creds["username"], creds["credential"])
    assert ok, detail
    assert "relay allocated" in detail or "succeeded" in detail


def test_real_coturn_rejects_bad_creds(coturn):
    ok, detail = smoke.check_turn_relay("127.0.0.1", 3478, "12345", "totally-wrong-credential")
    assert ok is False, detail
    assert "rejected" in detail, detail
