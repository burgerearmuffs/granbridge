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
import uuid
from dataclasses import dataclass, field
from typing import Optional

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

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
    ) -> None:
        self._host = host
        self._port = port
        self._room_size_cap = room_size_cap
        # room_name -> _Room
        self._rooms: dict[str, _Room] = {}
        # peer_id -> _Member (with .ws for direct send)
        self._peers: dict[str, _Member] = {}
        # peer_id -> room_name (for cleanup)
        self._peer_room: dict[str, str] = {}
        self._server: Optional[Server] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        self._server = await serve(self._handle, self._host, self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

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
