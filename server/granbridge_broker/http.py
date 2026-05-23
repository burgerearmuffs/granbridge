# server/granbridge_broker/http.py
"""Plain-HTTP helpers served on the same port as the WebSocket broker.

websockets lets one server answer HTTP via process_request: return a Response to
short-circuit (HTTP), or None to let the connection upgrade to WebSocket.
"""
from __future__ import annotations

import json
from typing import Optional

from websockets.datastructures import Headers
from websockets.http11 import Response


def json_response(status_code: int, payload: dict, reason: str = "OK") -> Response:
    body = (json.dumps(payload) + "\n").encode()
    headers = Headers()
    headers["Content-Type"] = "application/json"
    headers["Content-Length"] = str(len(body))
    headers["Access-Control-Allow-Origin"] = "*"  # public, non-credentialed endpoints
    return Response(status_code, reason, headers, body)


def origin_allowed(origin: Optional[str], allowed: Optional[tuple[str, ...]]) -> bool:
    """Permissive when no allowlist is configured (native apps send a null origin)."""
    if not allowed:
        return True
    return origin in allowed
