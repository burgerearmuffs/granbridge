"""Pure TURN REST-API credential minting for coturn --use-auth-secret.

coturn's time-limited credential contract:
  username   = "<unix-expiry-timestamp>"
  credential = base64( HMAC-SHA1( static_auth_secret, username ) )
The static secret never leaves the server; clients receive only short-lived creds.

The returned dict uses the key ``uris`` (matching the broker's wire format); the
WebRTC client maps this to the ``RTCIceServer.urls`` field on the receiving end.

URI shape: a single ``turns:HOST:PORT?transport=tcp`` — relay-only over TLS/TCP.
"""
from __future__ import annotations

import base64
import hashlib
import hmac


def make_turn_credentials(
    secret: str,
    domain: str,
    ttl: int,
    now: float,
    *,
    public_host: str | None = None,
    public_port: int = 443,
    transport: str = "tcp",
) -> dict:
    username = str(int(now) + ttl)
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    credential = base64.b64encode(digest).decode()
    host = public_host or domain
    uris = [f"turns:{host}:{public_port}?transport={transport}"]
    return {"username": username, "credential": credential, "ttl": ttl, "uris": uris}
