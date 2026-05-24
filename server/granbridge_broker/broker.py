"""granbridge_broker.broker — WebSocket broker for multiplayer rooms.

Protocol (JSON over WebSocket). Server assigns each connection a peer_id (uuid4 hex).

Client → {"type":"join","room":"R","password":"P","player":{"id":"...","name":"..."}}
Server → joiner: {"type":"joined","self":"<peer_id>","peers":[{"peer_id","player"}...]}
Server → room (on membership change): {"type":"peers","peers":[...]}
Client → {"type":"signal","to":"<peer_id>","data":{...}}
Server → target: {"type":"signal","from":"<peer_id>","data":{...}}
Client → {"type":"msg","payload":{...}}
Server → others: {"type":"msg","from":"<peer_id>","payload":{...}}
Server → {"type":"error","code":"...","message":"..."} (bad_password, room_full, bad_request)
Disconnect / {"type":"leave"} → remove member, broadcast peers, reap empty room.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse, parse_qs

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from granbridge_broker.http import json_response, origin_allowed
from granbridge_broker.ratelimit import RateLimiter, client_ip
from granbridge_broker.stats import StatsStore, ValidationError
from granbridge_broker.turn import make_turn_credentials

DEFAULT_ROOM_SIZE_CAP = 4


@dataclass
class _Member:
    peer_id: str
    ws: ServerConnection
    player: dict


@dataclass
class _Room:
    password_hash: str
    members: list[_Member] = field(default_factory=list)


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _members_payload(room: _Room) -> list[dict]:
    return [{"peer_id": m.peer_id, "player": m.player} for m in room.members]


async def _send(ws: ServerConnection, msg: dict) -> None:
    """Send a JSON message; silently drop if connection is already closed."""
    try:
        await ws.send(json.dumps(msg))
    except ConnectionClosed:
        pass


async def _error(ws: ServerConnection, code: str, message: str) -> None:
    await _send(ws, {"type": "error", "code": code, "message": message})


class BrokerServer:
    """Thin WebSocket broker: rooms + password + presence + WebRTC signaling relay."""

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8788,
        room_size_cap: int = DEFAULT_ROOM_SIZE_CAP,
        *,
        max_rooms: int = 200,
        max_size: int = 65536,
        allowed_origins: Optional[tuple[str, ...]] = None,
        turn_secret: str = "",
        turn_domain: str = "granbridge.local",
        turn_ttl: int = 86400,
        turn_rate_per_min: int = 0,
        conn_rate_per_min: int = 0,
        msg_rate_per_sec: int = 0,
        stats_store: "StatsStore | None" = None,
        stats_rate_per_min: int = 0,
        clock=time.time,
    ) -> None:
        self._host = host
        self._port = port
        self._room_size_cap = room_size_cap
        self._max_rooms = max_rooms
        self._max_size = max_size
        self._allowed_origins = allowed_origins
        self._turn_secret = turn_secret
        self._turn_domain = turn_domain
        self._turn_ttl = turn_ttl
        self._log = logging.getLogger("granbridge.broker")
        # room_name -> _Room
        self._rooms: dict[str, _Room] = {}
        # peer_id -> _Member (with .ws for direct send)
        self._peers: dict[str, _Member] = {}
        # peer_id -> room_name (for cleanup)
        self._peer_room: dict[str, str] = {}
        self._server: Optional[Server] = None
        self._clock = clock
        self._turn_limiter = RateLimiter(turn_rate_per_min, 60.0)
        self._conn_limiter = RateLimiter(conn_rate_per_min, 60.0)
        self._msg_limiter = RateLimiter(msg_rate_per_sec, 1.0)
        self._stats = stats_store
        self._stats_limiter = RateLimiter(stats_rate_per_min, 60.0)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        self._server = await serve(
            self._handle,
            self._host,
            self._port,
            process_request=self._process_request,
            max_size=self._max_size,
        )

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    # ------------------------------------------------------------------
    # HTTP (same port as the WebSocket) — health + TURN credentials
    # ------------------------------------------------------------------

    def _healthz_base(self) -> dict:
        return {"status": "ok", "rooms": len(self._rooms), "peers": len(self._peers)}

    def _http_route(self, path: str, ip: str = "-"):
        if path == "/healthz":
            return json_response(200, self._healthz_base())
        if path == "/turn":
            if not self._turn_limiter.allow(ip, self._clock()):
                return json_response(429, {"error": "rate_limited"}, reason="Too Many Requests")
            return json_response(
                200,
                make_turn_credentials(
                    self._turn_secret, self._turn_domain, self._turn_ttl, self._clock()
                ),
            )
        return None

    async def _process_request(self, connection, request):
        ip = client_ip(request.headers, connection.remote_address)
        path_only = request.path.split("?", 1)[0]
        if self._stats is not None and path_only.startswith("/stats/"):
            if not self._stats_limiter.allow(ip, self._clock()):
                return json_response(429, {"error": "rate_limited"}, reason="Too Many Requests")
            return await self._handle_stats_get(path_only, request.path)
        if self._stats is not None and path_only == "/healthz":
            base = self._healthz_base()
            base.update(await asyncio.to_thread(self._stats.counts))
            return json_response(200, base)
        resp = self._http_route(path_only, ip)
        if resp is not None:
            return resp
        if not self._conn_limiter.allow(ip, self._clock()):
            self._log.warning("rate-limited WS upgrade ip=%s", ip)
            return json_response(429, {"error": "rate_limited"}, reason="Too Many Requests")
        if self._allowed_origins is not None:
            origin = request.headers.get("Origin")
            if not origin_allowed(origin, self._allowed_origins):
                self._log.warning("rejected WS upgrade: forbidden origin %r", origin)
                return json_response(403, {"error": "forbidden_origin"}, reason="Forbidden")
        return None

    async def _handle_stats_get(self, path_only: str, full_path: str):
        try:
            if path_only.startswith("/stats/player/"):
                pid = path_only[len("/stats/player/"):]
                if not pid or len(pid) > 128:
                    return json_response(400, {"error": "bad player id"}, reason="Bad Request")
                summary = await asyncio.to_thread(self._stats.player_summary, pid)
                return json_response(200, summary)
            if path_only == "/stats/leaderboard":
                qs = parse_qs(urlparse(full_path).query)
                metric = (qs.get("metric") or ["avg"])[0]
                if metric not in ("avg", "wins"):
                    metric = "avg"
                try:
                    limit = int((qs.get("limit") or ["20"])[0])
                except ValueError:
                    limit = 20
                board = await asyncio.to_thread(self._stats.leaderboard, metric, limit)
                return json_response(200, {"metric": metric, "players": board})
            return json_response(404, {"error": "not_found"}, reason="Not Found")
        except Exception:
            return json_response(500, {"error": "internal_error"}, reason="Internal Server Error")

    # ------------------------------------------------------------------
    # Connection handler
    # ------------------------------------------------------------------

    async def _handle(self, ws: ServerConnection) -> None:
        peer_id = uuid.uuid4().hex
        member: Optional[_Member] = None

        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    if not isinstance(msg, dict) or "type" not in msg:
                        raise ValueError("not a dict or missing type")
                except (json.JSONDecodeError, ValueError):
                    await _error(ws, "bad_request", "malformed message")
                    continue

                mtype = msg.get("type")

                # ---- join ------------------------------------------------
                if mtype == "join":
                    if member is not None:
                        # already joined; ignore (could allow re-join later)
                        await _error(ws, "bad_request", "already joined a room")
                        continue

                    room_name = msg.get("room")
                    password = msg.get("password", "")
                    player = msg.get("player")

                    if not isinstance(room_name, str) or not room_name:
                        await _error(ws, "bad_request", "missing room name")
                        continue
                    if not isinstance(player, dict):
                        await _error(ws, "bad_request", "missing player info")
                        continue

                    pw_hash = _sha256(str(password))

                    if room_name not in self._rooms and len(self._rooms) >= self._max_rooms:
                        await _error(ws, "server_full", "too many rooms")
                        continue

                    if room_name in self._rooms:
                        room = self._rooms[room_name]
                        # Check password
                        if room.password_hash != pw_hash:
                            await _error(ws, "bad_password", "incorrect password")
                            continue
                        # Check capacity
                        if len(room.members) >= self._room_size_cap:
                            await _error(ws, "room_full", "room is full")
                            continue
                    else:
                        # First joiner creates the room and sets password
                        room = _Room(password_hash=pw_hash)
                        self._rooms[room_name] = room
                        self._log.info("room created name=%r (rooms=%d)", room_name, len(self._rooms))

                    # Build member
                    member = _Member(peer_id=peer_id, ws=ws, player=player)
                    self._peers[peer_id] = member
                    self._peer_room[peer_id] = room_name

                    # Snapshot existing peers for the joiner's "joined" response
                    existing_peers = _members_payload(room)

                    # Add to room
                    room.members.append(member)

                    # Send "joined" to the new peer
                    await _send(ws, {
                        "type": "joined",
                        "self": peer_id,
                        "peers": existing_peers,
                    })

                    # Broadcast updated "peers" to everyone else
                    await self._broadcast_peers(room, exclude_peer_id=peer_id)

                # ---- signal ----------------------------------------------
                elif mtype == "signal":
                    if member is None:
                        await _error(ws, "bad_request", "must join before signaling")
                        continue
                    if not self._msg_limiter.allow(peer_id, self._clock()):
                        self._log.warning("dropped signal flood peer=%s", peer_id)
                        continue
                    target_id = msg.get("to")
                    data = msg.get("data")
                    if not isinstance(target_id, str) or data is None:
                        await _error(ws, "bad_request", "signal missing to/data")
                        continue
                    target = self._peers.get(target_id)
                    if target is None:
                        await _error(ws, "bad_request", "unknown target peer_id")
                        continue
                    await _send(target.ws, {
                        "type": "signal",
                        "from": peer_id,
                        "data": data,
                    })

                # ---- msg -------------------------------------------------
                elif mtype == "msg":
                    if member is None:
                        await _error(ws, "bad_request", "must join before messaging")
                        continue
                    if not self._msg_limiter.allow(peer_id, self._clock()):
                        self._log.warning("dropped msg flood peer=%s", peer_id)
                        continue
                    payload = msg.get("payload")
                    if payload is None:
                        await _error(ws, "bad_request", "msg missing payload")
                        continue
                    room_name = self._peer_room.get(peer_id)
                    if room_name and room_name in self._rooms:
                        room = self._rooms[room_name]
                        for m in list(room.members):
                            if m.peer_id != peer_id:
                                await _send(m.ws, {
                                    "type": "msg",
                                    "from": peer_id,
                                    "payload": payload,
                                })

                # ---- stats_submit -------------------------------------
                elif mtype == "stats_submit":
                    if self._stats is None:
                        await _error(ws, "unsupported", "stats not enabled")
                        continue
                    if not self._stats_limiter.allow(peer_id, self._clock()):
                        await _error(ws, "rate_limited", "too many submissions")
                        continue
                    pid = msg.get("id")
                    token = msg.get("writeToken")
                    match = msg.get("match")
                    if not isinstance(pid, str) or not pid or not isinstance(token, str) or not token:
                        await _error(ws, "bad_request", "stats_submit missing id/writeToken")
                        continue
                    player = msg.get("player") if isinstance(msg.get("player"), dict) else {}
                    name = player.get("name", "") if isinstance(player.get("name"), str) else ""
                    avatar = player.get("avatar") if isinstance(player.get("avatar"), dict) else {}
                    color = avatar.get("color", "") if isinstance(avatar.get("color"), str) else ""
                    try:
                        result = await asyncio.to_thread(
                            self._stats.submit_match, pid, token, match, name, color)
                    except (ValidationError):
                        await _error(ws, "implausible", "match failed validation")
                        continue
                    except PermissionError:
                        await _error(ws, "token_mismatch", "write token does not match")
                        continue
                    except Exception:
                        self._log.exception("stats_submit failed unexpectedly")
                        await _error(ws, "server_error", "internal error processing stats")
                        continue
                    await _send(ws, {"type": "stats_ack",
                                     "match_id": result["match_id"], "verified": result["verified"]})

                # ---- leave -----------------------------------------------
                elif mtype == "leave":
                    break  # triggers finally cleanup below

                # ---- unknown ---------------------------------------------
                else:
                    await _error(ws, "bad_request", f"unknown message type: {mtype!r}")

        except ConnectionClosed:
            pass
        except Exception:
            # Defensive: never let a bug kill the server process
            pass
        finally:
            # Cleanup: remove from room, broadcast peers, reap empty room
            await self._remove_peer(peer_id)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _remove_peer(self, peer_id: str) -> None:
        room_name = self._peer_room.pop(peer_id, None)
        self._peers.pop(peer_id, None)

        if room_name is None or room_name not in self._rooms:
            return

        room = self._rooms[room_name]
        room.members = [m for m in room.members if m.peer_id != peer_id]

        if not room.members:
            # Reap empty room
            del self._rooms[room_name]
            self._log.info("room reaped name=%r (rooms=%d)", room_name, len(self._rooms))
        else:
            # Notify remaining members
            await self._broadcast_peers(room, exclude_peer_id=None)

    async def _broadcast_peers(
        self, room: _Room, *, exclude_peer_id: Optional[str]
    ) -> None:
        payload = _members_payload(room)
        for m in list(room.members):
            if m.peer_id != exclude_peer_id:
                await _send(m.ws, {"type": "peers", "peers": payload})
