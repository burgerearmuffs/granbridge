"""Environment parsing + TURN secret resolution for the broker.

Only DOMAIN is required at deploy time. TURN_SECRET is resolved from the env if
set, else read from SECRET_PATH (written once by the compose `init` one-shot).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

DEFAULT_PORT = 8788
DEFAULT_SECRET_PATH = "/secrets/turn_secret"


@dataclass(frozen=True)
class BrokerConfig:
    host: str
    port: int
    room_size_cap: int
    max_rooms: int
    max_size: int
    allowed_origins: Optional[tuple[str, ...]]
    turn_secret: str
    turn_domain: str
    turn_ttl: int


def resolve_secret(env_secret: Optional[str], secret_path: str) -> str:
    if env_secret:
        return env_secret
    with open(secret_path, "r", encoding="utf-8") as fh:
        return fh.read().strip()


def from_env(env=None) -> BrokerConfig:
    env = os.environ if env is None else env
    origins_raw = (env.get("ALLOWED_ORIGINS") or "").strip()
    allowed = tuple(o.strip() for o in origins_raw.split(",") if o.strip()) or None
    secret = resolve_secret(
        env.get("TURN_SECRET"), env.get("SECRET_PATH", DEFAULT_SECRET_PATH)
    )
    domain = env.get("DOMAIN") or env.get("TURN_REALM") or "granbridge.local"
    return BrokerConfig(
        host=env.get("BROKER_HOST", "0.0.0.0"),
        port=int(env.get("BROKER_PORT", str(DEFAULT_PORT))),
        room_size_cap=int(env.get("ROOM_SIZE_CAP", "4")),
        max_rooms=int(env.get("MAX_ROOMS", "200")),
        max_size=int(env.get("MAX_MSG_BYTES", "65536")),
        allowed_origins=allowed,
        turn_secret=secret,
        turn_domain=domain,
        turn_ttl=int(env.get("TURN_TTL", "86400")),
    )
