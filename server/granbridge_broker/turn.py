"""Pure TURN REST-API credential minting for coturn --use-auth-secret.

coturn's time-limited credential contract:
  username   = "<unix-expiry-timestamp>"
  credential = base64( HMAC-SHA1( static_auth_secret, username ) )
The static secret never leaves the server; clients receive only short-lived creds.
"""
from __future__ import annotations

import base64
import hashlib
import hmac


def make_turn_credentials(secret: str, domain: str, ttl: int, now: float) -> dict:
    username = str(int(now) + ttl)
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    credential = base64.b64encode(digest).decode()
    uris = [
        f"turn:{domain}:3478?transport=udp",
        f"turn:{domain}:3478?transport=tcp",
        f"turns:{domain}:5349?transport=tcp",
    ]
    return {"username": username, "credential": credential, "ttl": ttl, "uris": uris}
