import shutil, subprocess, time
import ssl, socket
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


TLS_NAME = "granbridge-smoke-coturn-tls-test"


def _selfsigned(cert_dir):
    """Generate a throwaway self-signed cert/key for coturn TLS (host openssl)."""
    crt, key = f"{cert_dir}/cert.pem", f"{cert_dir}/key.pem"
    proc = subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
         "-keyout", key, "-out", crt, "-days", "1", "-subj", "/CN=127.0.0.1"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    return crt, key


@pytest.fixture
def coturn_tls(tmp_path):
    if shutil.which("openssl") is None:
        pytest.skip("openssl not available to mint a test cert")
    crt, key = _selfsigned(str(tmp_path))
    subprocess.run(["docker", "rm", "-f", TLS_NAME], capture_output=True)
    proc = subprocess.run(
        ["docker", "run", "-d", "--name", TLS_NAME,
         "-p", "5349:5349", "-v", f"{tmp_path}:/certs:ro",
         "coturn/coturn:4.6.2", "turnserver", "-n", "--no-udp", "--no-dtls",
         "--use-auth-secret", "--static-auth-secret", SECRET, "--realm", REALM,
         "--tls-listening-port=5349", "--listening-ip=0.0.0.0",
         "--cert=/certs/cert.pem", "--pkey=/certs/key.pem",
         "--min-port=49152", "--max-port=49200"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    # Wait for the TLS port to accept connections.
    for _ in range(40):
        try:
            with socket.create_connection(("127.0.0.1", 5349), timeout=0.5):
                break
        except OSError:
            time.sleep(0.5)
    else:
        subprocess.run(["docker", "rm", "-f", TLS_NAME], capture_output=True)
        pytest.fail("coturn TLS did not become reachable on 5349")
    yield
    subprocess.run(["docker", "rm", "-f", TLS_NAME], capture_output=True)


def _unverified_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def test_real_coturn_tls_accepts_minted_creds(coturn_tls):
    creds = make_turn_credentials(SECRET, REALM, ttl=300, now=time.time())
    ok, detail = smoke.check_turns_tcp_relay(
        "127.0.0.1", 5349, creds["username"], creds["credential"],
        ssl_context=_unverified_ctx(),
    )
    assert ok, detail
    assert "relay allocated" in detail or "accepted creds" in detail


def test_real_coturn_tls_rejects_bad_creds(coturn_tls):
    ok, detail = smoke.check_turns_tcp_relay(
        "127.0.0.1", 5349, "12345", "totally-wrong-credential",
        ssl_context=_unverified_ctx(),
    )
    assert ok is False, detail
    assert "rejected" in detail, detail
