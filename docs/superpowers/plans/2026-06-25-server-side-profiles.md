# Richer Server-side Profiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a match-history timeline, head-to-head records, and a first-class profile (bio + propagating update path) on top of the now-live `/stats` backend.

**Architecture:** Approach A — extend existing patterns additively. Reads are HTTP GET, writes go over a transient WebSocket message, auth is trust-on-first-use (TOFU) write-tokens. Server changes land in `stats.py` (store) and `broker.py` (routes + WS arm); client changes in `stats/` (data) and `views/components` (UI). Nothing existing is restructured.

**Tech Stack:** Python 3 + `websockets` + SQLite (server, pytest); TypeScript + React + Vite (client, vitest).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-25-server-side-profiles-design.md`.
- New profile field this version: **`bio` only** (no country/favorite-double).
- Match history is shown in **`Profile` only**; the opponent card gets **H2H only**.
- `bio` ≤ **160 chars** after strip; over-length is **rejected** (never truncated); empty → `NULL`.
- All changes **backward-compatible**: new column nullable, new routes/WS message ignored by old peers, new response fields optional.
- Reads = HTTP GET, writes = transient-WS message, auth = TOFU write-token. Match the existing `submit_match` / `_handle_stats_get` conventions exactly.
- **Server test command** (from the worktree root): `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/<file> -q`
- **Client test command** (from `ui/`): `npx vitest run src/<path>` (or `npm test` for the full suite).
- Conventional-commit style messages (`feat(...)`, `test(...)`). Commit after each task.

---

## File map

| File | Responsibility | Tasks |
|------|----------------|-------|
| `server/granbridge_broker/stats.py` | `bio` migration, `update_profile`, `recent_matches`, `head_to_head`, `bio` in `player_summary` | 1,2,3 |
| `server/granbridge_broker/broker.py` | new GET routes + `profile_update` WS arm | 4,5 |
| `server/tests/test_stats_store.py` | store unit tests | 1,2,3 |
| `server/tests/test_stats_api.py` | route + WS integration tests | 4,5 |
| `ui/src/stats/types.ts` | `MatchHistoryRow`, `HeadToHead`, `bio` on `PlayerSummary` | 6 |
| `ui/src/stats/statsClient.ts` | `fetchPlayerMatches`, `fetchHeadToHead`, `updateProfile` | 6,7 |
| `ui/src/stats/statsClient.reads.test.ts` / `statsClient.profile.test.ts` | client data tests | 6,7 |
| `ui/src/multiplayer/player.ts` | `bio` field + `setPlayerBio` + migration | 8 |
| `ui/src/multiplayer/player.test.ts` | profile model tests | 8 |
| `ui/src/views/Profile.tsx` | bio editor + recent-games list | 9,10 |
| `ui/src/views/Profile.test.tsx` | Profile UI tests | 9,10 |
| `ui/src/components/OpponentCard.tsx` | optional H2H line | 11 |
| `ui/src/components/OpponentCard.test.tsx` | H2H render test | 11 |
| `ui/src/views/Multiplayer.tsx` | fetch H2H, pass to OpponentCard | 11 |

---

## Task 1: `bio` column + `update_profile` store method

**Files:**
- Modify: `server/granbridge_broker/stats.py`
- Test: `server/tests/test_stats_store.py`

**Interfaces:**
- Produces: `StatsStore.update_profile(player_id: str, write_token: str, display_name="", avatar_color="", bio="") -> dict` returning `{"id","display_name","avatar_color","bio"}`; module const `MAX_BIO = 160`; `player_summary(...)` gains a `"bio"` key.

- [ ] **Step 1: Write the failing tests** — append to `server/tests/test_stats_store.py`:

```python
def test_update_profile_creates_player_without_a_match(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    out = s.update_profile("P9", "tok-9", display_name="Zoe", avatar_color="#0f0", bio="  love the bull  ")
    assert out["bio"] == "love the bull"  # stripped
    summary = s.player_summary("P9")
    assert summary["games_played"] == 0
    assert summary["display_name"] == "Zoe"
    assert summary["bio"] == "love the bull"


def test_update_profile_wrong_token_rejected(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("P1", "tok-1", bio="first")
    with pytest.raises(PermissionError):
        s.update_profile("P1", "WRONG", bio="hijack")


def test_update_profile_rejects_overlong_bio(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    with pytest.raises(ValidationError):
        s.update_profile("P1", "tok-1", bio="x" * 161)


def test_empty_bio_stores_null(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("P1", "tok-1", display_name="Al", bio="   ")
    assert s.player_summary("P1")["bio"] is None


def test_bio_persists_across_match_submit(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("P1", "tok-1", bio="checkout king")
    s.submit_match("P1", "tok-1", _match())  # submit must not wipe bio
    assert s.player_summary("P1")["bio"] == "checkout king"
```

- [ ] **Step 2: Run them and verify they fail**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_store.py -q -k "update_profile or bio"`
Expected: FAIL (`AttributeError: 'StatsStore' object has no attribute 'update_profile'`, and `KeyError: 'bio'`).

- [ ] **Step 3: Add the migration** — in `StatsStore._init_tables`, immediately before `conn.commit()`:

```python
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(players)").fetchall()}
            if "bio" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN bio TEXT")
```

- [ ] **Step 4: Add the module constant** — near the other limits at the top of `stats.py`:

```python
MAX_BIO = 160
```

- [ ] **Step 5: Add `update_profile`** — new method on `StatsStore` (place after `submit_match`):

```python
    def update_profile(self, player_id: str, write_token: str,
                       display_name: str = "", avatar_color: str = "", bio: str = "") -> dict:
        """Create-or-update a player's profile fields. TOFU-authorized like submit_match.

        Registers the identity if new (so a profile can exist before any match).
        Raises PermissionError on token mismatch, ValidationError on a too-long bio.
        """
        display_name = (display_name or "")[:64]
        avatar_color = (avatar_color or "")[:32]
        bio = "".join(ch for ch in (bio or "") if ch >= " " or ch == "\n").strip()
        if len(bio) > MAX_BIO:
            raise ValidationError("bio too long")
        bio_val = bio or None
        token_hash = _sha256(write_token)
        now = _utc_now()
        with _connect(self.db_path) as conn:
            row = conn.execute("SELECT token_hash FROM players WHERE id = ?", (player_id,)).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO players (id, token_hash, display_name, avatar_color, bio, first_seen, last_seen)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (player_id, token_hash, display_name, avatar_color, bio_val, now, now),
                )
            else:
                if not hmac.compare_digest(row["token_hash"], token_hash):
                    raise PermissionError("token_mismatch")
                conn.execute(
                    "UPDATE players SET display_name = ?, avatar_color = ?, bio = ?, last_seen = ? WHERE id = ?",
                    (display_name, avatar_color, bio_val, now, player_id),
                )
            conn.commit()
        return {"id": player_id, "display_name": display_name,
                "avatar_color": avatar_color, "bio": bio_val}
```

- [ ] **Step 6: Surface `bio` in `player_summary`** — change the player SELECT and the return dict:

```python
            prow = conn.execute(
                "SELECT display_name, avatar_color, bio FROM players WHERE id = ?", (player_id,)
            ).fetchone()
```

and add to the returned dict (next to `avatar_color`):

```python
            "bio": prow["bio"] if prow else None,
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_store.py -q`
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 8: Commit**

```bash
git add server/granbridge_broker/stats.py server/tests/test_stats_store.py
git commit -m "feat(stats): first-class profile bio + update_profile (TOFU, migration)"
```

---

## Task 2: `recent_matches` store method

**Files:**
- Modify: `server/granbridge_broker/stats.py`
- Test: `server/tests/test_stats_store.py`

**Interfaces:**
- Produces: `StatsStore.recent_matches(player_id: str, limit: int = 20, offset: int = 0) -> list[dict]`; each row `{match_id, mode, opponent_id, opponent_name, is_remote, won, verified, three_dart_avg, started_at, ended_at}`, newest-first.

- [ ] **Step 1: Write the failing tests** — append to `test_stats_store.py`:

```python
def _match_at(match_id, started, opponent="P2", winner="P1", darts=9, total=180):
    m = _match(match_id=match_id, opponent=opponent, winner=winner, darts=darts, total=total)
    m["started_at"] = started
    return m


def test_recent_matches_newest_first_with_opponent_name(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("OPP", "topp", display_name="Opie")          # give the opponent a name
    s.submit_match("P1", "t1", _match_at("a", "2026-05-24T10:00:00.000Z", opponent="OPP", winner="P1"))
    s.submit_match("P1", "t1", _match_at("b", "2026-05-25T10:00:00.000Z", opponent="OPP", winner="OPP"))
    rows = s.recent_matches("P1")
    assert [r["match_id"] for r in rows] == ["b", "a"]            # newest first
    assert rows[0]["won"] is False and rows[1]["won"] is True
    assert rows[0]["opponent_name"] == "Opie"
    assert rows[1]["three_dart_avg"] == 60.0                       # 180/9*3


def test_recent_matches_limit_and_offset(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    for i in range(5):
        s.submit_match("P1", "t1", _match_at(f"m{i}", f"2026-05-2{i}T10:00:00.000Z"))
    page1 = s.recent_matches("P1", limit=2, offset=0)
    page2 = s.recent_matches("P1", limit=2, offset=2)
    assert [r["match_id"] for r in page1] == ["m4", "m3"]
    assert [r["match_id"] for r in page2] == ["m2", "m1"]


def test_recent_matches_empty_for_unknown(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    assert s.recent_matches("nobody") == []
```

- [ ] **Step 2: Run and verify they fail**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_store.py -q -k recent_matches`
Expected: FAIL (`AttributeError: ... 'recent_matches'`).

- [ ] **Step 3: Implement** — add to `StatsStore` (after `player_summary`):

```python
    def recent_matches(self, player_id: str, limit: int = 20, offset: int = 0) -> list[dict]:
        limit = max(1, min(int(limit), 100))
        offset = max(0, int(offset))
        with _connect(self.db_path) as conn:
            rows = conn.execute("""
                SELECT m.match_id, m.mode, m.opponent_id, m.is_remote, m.winner_id,
                       m.darts, m.total_scored, m.verified, m.started_at, m.ended_at,
                       p.display_name AS opponent_name
                FROM matches m
                LEFT JOIN players p ON p.id = m.opponent_id
                WHERE m.reporter_id = ?
                ORDER BY m.started_at DESC
                LIMIT ? OFFSET ?
            """, (player_id, limit, offset)).fetchall()
        out = []
        for r in rows:
            darts = r["darts"] or 0
            total = r["total_scored"] or 0
            out.append({
                "match_id": r["match_id"], "mode": r["mode"],
                "opponent_id": r["opponent_id"], "opponent_name": r["opponent_name"],
                "is_remote": bool(r["is_remote"]),
                "won": r["winner_id"] == player_id,
                "verified": bool(r["verified"]),
                "three_dart_avg": round(total / darts * 3, 2) if darts else 0.0,
                "started_at": r["started_at"], "ended_at": r["ended_at"],
            })
        return out
```

- [ ] **Step 4: Run and verify they pass**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_store.py -q -k recent_matches`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/stats.py server/tests/test_stats_store.py
git commit -m "feat(stats): recent_matches history query"
```

---

## Task 3: `head_to_head` store method

**Files:**
- Modify: `server/granbridge_broker/stats.py`
- Test: `server/tests/test_stats_store.py`

**Interfaces:**
- Produces: `StatsStore.head_to_head(a: str, b: str) -> dict` → `{a, b, games, a_wins, b_wins, last_played, pending}`. `games/a_wins/b_wins` count verified-only; `pending` = unverified reported rows; `a == b` and unknown ids → all-zero.

- [ ] **Step 1: Write the failing tests** — append to `test_stats_store.py`:

```python
def test_head_to_head_counts_verified_wins_and_pending(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    # Two co-signed (verified) A-vs-B matches: A wins g1, B wins g2.
    s.submit_match("A", "ta", _match(match_id="g1", winner="A", opponent="B"))
    s.submit_match("B", "tb", _match(match_id="g1", winner="A", opponent="A"))  # verifies g1 (A won)
    s.submit_match("A", "ta", _match(match_id="g2", winner="B", opponent="B"))
    s.submit_match("B", "tb", _match(match_id="g2", winner="B", opponent="A"))  # verifies g2 (B won)
    s.submit_match("A", "ta", _match(match_id="g3", winner="A", opponent="B"))  # pending (B never co-signs)
    h = s.head_to_head("A", "B")
    assert h["games"] == 2 and h["a_wins"] == 1 and h["b_wins"] == 1
    assert h["pending"] == 1
    assert h["last_played"] is not None


def test_head_to_head_self_and_unknown_are_zero(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.submit_match("A", "ta", _match(match_id="g1", winner="A", opponent="B"))
    assert s.head_to_head("A", "A") == {"a": "A", "b": "A", "games": 0, "a_wins": 0,
                                        "b_wins": 0, "last_played": None, "pending": 0}
    z = s.head_to_head("X", "Y")
    assert z["games"] == 0 and z["pending"] == 0 and z["last_played"] is None
```

- [ ] **Step 2: Run and verify they fail**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_store.py -q -k head_to_head`
Expected: FAIL (`AttributeError: ... 'head_to_head'`).

- [ ] **Step 3: Implement** — add to `StatsStore`:

```python
    def head_to_head(self, a: str, b: str) -> dict:
        result = {"a": a, "b": b, "games": 0, "a_wins": 0, "b_wins": 0,
                  "last_played": None, "pending": 0}
        if a == b:
            return result
        with _connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT winner_id, verified, started_at FROM matches"
                " WHERE reporter_id = ? AND opponent_id = ?", (a, b),
            ).fetchall()
        last = None
        for r in rows:
            started = r["started_at"] or ""
            if last is None or started > last:
                last = started
            if r["verified"]:
                result["games"] += 1
                if r["winner_id"] == a:
                    result["a_wins"] += 1
                elif r["winner_id"] == b:
                    result["b_wins"] += 1
            else:
                result["pending"] += 1
        result["last_played"] = last
        return result
```

- [ ] **Step 4: Run and verify they pass**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_store.py -q`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/stats.py server/tests/test_stats_store.py
git commit -m "feat(stats): head_to_head rivalry query"
```

---

## Task 4: HTTP GET routes — `/matches` and `/h2h`

**Files:**
- Modify: `server/granbridge_broker/broker.py` (`_handle_stats_get`, ~lines 204-225)
- Test: `server/tests/test_stats_api.py`

**Interfaces:**
- Consumes: `recent_matches`, `head_to_head` (Tasks 2,3).
- Produces routes: `GET /stats/player/<id>/matches?limit=&offset=` → `{player_id, matches}`; `GET /stats/h2h/<a>/<b>` → head_to_head dict.

- [ ] **Step 1: Write the failing tests** — append to `test_stats_api.py`:

```python
@pytest.mark.asyncio
async def test_player_matches_route_not_swallowed_by_bare_route(tmp_path):
    s, store, port = await _start(tmp_path)
    try:
        await asyncio.to_thread(store.submit_match, "P1", "t1", {
            "match_id": "m1", "mode": "x01", "opponent_id": "P2", "winner_id": "P1",
            "is_remote": True, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": None, "throws": None,
        })
        status, body = await _get(port, "/stats/player/P1/matches")
        assert status == 200
        assert "matches" in body and "games_played" not in body   # NOT a player_summary
        assert body["player_id"] == "P1"
        assert body["matches"][0]["match_id"] == "m1"
        assert body["matches"][0]["won"] is True
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_h2h_route_returns_tally(tmp_path):
    s, store, port = await _start(tmp_path)
    try:
        await asyncio.to_thread(store.submit_match, "A", "ta", {
            "match_id": "g1", "mode": "x01", "opponent_id": "B", "winner_id": "A",
            "is_remote": True, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": None, "throws": None})
        await asyncio.to_thread(store.submit_match, "B", "tb", {
            "match_id": "g1", "mode": "x01", "opponent_id": "A", "winner_id": "A",
            "is_remote": True, "darts": 9, "total_scored": 100,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": None, "throws": None})
        status, body = await _get(port, "/stats/h2h/A/B")
        assert status == 200
        assert body["games"] == 1 and body["a_wins"] == 1 and body["b_wins"] == 0
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_h2h_missing_second_id_is_400_or_404(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        import urllib.error
        try:
            await _get(port, "/stats/h2h/A")
            assert False, "expected an HTTP error"
        except urllib.error.HTTPError as e:
            assert e.code in (400, 404)
    finally:
        await s.stop()
```

- [ ] **Step 2: Run and verify they fail**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_api.py -q -k "matches_route or h2h"`
Expected: FAIL (matches route returns a 200 player_summary that *has* `games_played`, or 404 for h2h).

- [ ] **Step 3: Implement** — in `_handle_stats_get`, insert the two new branches. The `/matches` branch MUST come **before** the bare `/stats/player/` branch:

```python
    async def _handle_stats_get(self, path_only: str, full_path: str):
        try:
            if path_only.startswith("/stats/player/") and path_only.endswith("/matches"):
                pid = path_only[len("/stats/player/"):-len("/matches")]
                if not pid or len(pid) > 128:
                    return json_response(400, {"error": "bad player id"}, reason="Bad Request")
                qs = parse_qs(urlparse(full_path).query)
                try:
                    limit = int((qs.get("limit") or ["20"])[0])
                except ValueError:
                    limit = 20
                try:
                    offset = int((qs.get("offset") or ["0"])[0])
                except ValueError:
                    offset = 0
                matches = await asyncio.to_thread(self._stats.recent_matches, pid, limit, offset)
                return json_response(200, {"player_id": pid, "matches": matches})
            if path_only.startswith("/stats/player/"):
                pid = path_only[len("/stats/player/"):]
                if not pid or len(pid) > 128:
                    return json_response(400, {"error": "bad player id"}, reason="Bad Request")
                summary = await asyncio.to_thread(self._stats.player_summary, pid)
                return json_response(200, summary)
            if path_only.startswith("/stats/h2h/"):
                parts = path_only[len("/stats/h2h/"):].split("/")
                if len(parts) != 2 or not parts[0] or not parts[1] \
                        or len(parts[0]) > 128 or len(parts[1]) > 128:
                    return json_response(400, {"error": "bad h2h ids"}, reason="Bad Request")
                h2h = await asyncio.to_thread(self._stats.head_to_head, parts[0], parts[1])
                return json_response(200, h2h)
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
```

> The bare-player and leaderboard branches are unchanged from the current code — they are repeated here only because the new branches interleave with them. Replace the whole method body.

- [ ] **Step 4: Run and verify they pass**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_api.py -q`
Expected: PASS (whole file, including pre-existing route tests).

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/broker.py server/tests/test_stats_api.py
git commit -m "feat(broker): /stats/player/<id>/matches and /stats/h2h/<a>/<b> routes"
```

---

## Task 5: `profile_update` WebSocket message

**Files:**
- Modify: `server/granbridge_broker/broker.py` (add a new `elif mtype == "profile_update"` arm next to `stats_submit`, ~line 366-398)
- Test: `server/tests/test_stats_api.py`

**Interfaces:**
- Consumes: `update_profile` (Task 1).
- Produces: WS `profile_update` → `profile_ack` `{type, id, bio}`; errors reuse `unsupported`/`rate_limited`/`bad_request`/`token_mismatch`/`implausible`/`server_error`.

- [ ] **Step 1: Write the failing tests** — append to `test_stats_api.py`:

```python
def _profile_msg(player_id="P1", token="t1", name="Ann", bio="hi there"):
    return {
        "type": "profile_update", "id": player_id, "writeToken": token,
        "player": {"id": player_id, "name": name, "avatar": {"color": "#f00"}, "bio": bio},
    }


@pytest.mark.asyncio
async def test_profile_update_over_ws_then_read_back(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg(bio="bullseye fan")))
            ack = json.loads(await ws.recv())
        assert ack["type"] == "profile_ack" and ack["id"] == "P1" and ack["bio"] == "bullseye fan"
        _, body = await _get(port, "/stats/player/P1")
        assert body["bio"] == "bullseye fan" and body["games_played"] == 0
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_profile_update_wrong_token_rejected(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg()))
            await ws.recv()  # registers token
            await ws.send(json.dumps(_profile_msg(token="WRONG", bio="x")))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "token_mismatch"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_profile_update_overlong_bio_is_implausible(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg(bio="x" * 161)))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "implausible"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_profile_update_when_disabled_unsupported(tmp_path):
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="x.test")  # no stats_store
    await s.start()
    port = s._server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg()))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "unsupported"
    finally:
        await s.stop()
```

- [ ] **Step 2: Run and verify they fail**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_api.py -q -k profile_update`
Expected: FAIL (`bad_request` "unknown message type" — there's no `profile_update` arm yet).

- [ ] **Step 3: Implement** — add this arm immediately after the `stats_submit` arm (before `elif mtype == "leave":`). `ValidationError` is already imported at the top of `broker.py`:

```python
                # ---- profile_update -----------------------------------
                elif mtype == "profile_update":
                    if self._stats is None:
                        await _error(ws, "unsupported", "stats not enabled")
                        continue
                    if not self._stats_limiter.allow(peer_id, self._clock()):
                        await _error(ws, "rate_limited", "too many submissions")
                        continue
                    pid = msg.get("id")
                    token = msg.get("writeToken")
                    if not isinstance(pid, str) or not pid or not isinstance(token, str) or not token:
                        await _error(ws, "bad_request", "profile_update missing id/writeToken")
                        continue
                    player = msg.get("player") if isinstance(msg.get("player"), dict) else {}
                    name = player.get("name", "") if isinstance(player.get("name"), str) else ""
                    avatar = player.get("avatar") if isinstance(player.get("avatar"), dict) else {}
                    color = avatar.get("color", "") if isinstance(avatar.get("color"), str) else ""
                    bio = player.get("bio", "") if isinstance(player.get("bio"), str) else ""
                    try:
                        result = await asyncio.to_thread(
                            self._stats.update_profile, pid, token, name, color, bio)
                    except ValidationError:
                        await _error(ws, "implausible", "profile failed validation")
                        continue
                    except PermissionError:
                        await _error(ws, "token_mismatch", "write token does not match")
                        continue
                    except Exception:
                        self._log.exception("profile_update failed unexpectedly")
                        await _error(ws, "server_error", "internal error processing profile")
                        continue
                    await _send(ws, {"type": "profile_ack", "id": pid, "bio": result.get("bio")})
```

- [ ] **Step 4: Run and verify they pass**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests/test_stats_api.py -q`
Expected: PASS (whole file).

- [ ] **Step 5: Full server suite + commit**

Run: `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests -q`
Expected: PASS.

```bash
git add server/granbridge_broker/broker.py server/tests/test_stats_api.py
git commit -m "feat(broker): profile_update WS message (TOFU bio/name/color)"
```

---

## Task 6: Client types + read fns (`fetchPlayerMatches`, `fetchHeadToHead`)

**Files:**
- Modify: `ui/src/stats/types.ts`, `ui/src/stats/statsClient.ts`
- Test: `ui/src/stats/statsClient.reads.test.ts`

**Interfaces:**
- Produces: `MatchHistoryRow`, `HeadToHead` types; `bio?: string | null` on `PlayerSummary`; `fetchPlayerMatches(id, limit?, offset?, base?) -> {player_id, matches}`; `fetchHeadToHead(a, b, base?) -> HeadToHead`.

- [ ] **Step 1: Write the failing tests** — append to `statsClient.reads.test.ts`:

```typescript
import { fetchPlayerMatches, fetchHeadToHead } from "./statsClient";

describe("history + h2h reads", () => {
  it("fetchPlayerMatches hits the /matches subpath with limit+offset", async () => {
    const body = { player_id: "P1", matches: [{ match_id: "m1", won: true }] };
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal("fetch", f);
    const out = await fetchPlayerMatches("P1", 10, 5, "https://h");
    expect(f).toHaveBeenCalledWith("https://h/stats/player/P1/matches?limit=10&offset=5");
    expect(out.matches[0].match_id).toBe("m1");
  });

  it("fetchHeadToHead hits /stats/h2h/{a}/{b}", async () => {
    const body = { a: "P1", b: "P2", games: 3, a_wins: 2, b_wins: 1, last_played: null, pending: 0 };
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal("fetch", f);
    const out = await fetchHeadToHead("P1", "P2", "https://h");
    expect(f).toHaveBeenCalledWith("https://h/stats/h2h/P1/P2");
    expect(out.a_wins).toBe(2);
  });

  it("fetchPlayerMatches throws on non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchPlayerMatches("P1", 20, 0, "https://h")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run (from `ui/`): `npx vitest run src/stats/statsClient.reads.test.ts`
Expected: FAIL (`fetchPlayerMatches` is not exported).

- [ ] **Step 3: Add the types** — append to `ui/src/stats/types.ts`, and add `bio` to `PlayerSummary`:

```typescript
export interface MatchHistoryRow {
  match_id: string;
  mode: string;
  opponent_id: string | null;
  opponent_name: string | null;
  is_remote: boolean;
  won: boolean;
  verified: boolean;
  three_dart_avg: number;
  started_at: string;
  ended_at: string | null;
}

export interface HeadToHead {
  a: string;
  b: string;
  games: number;
  a_wins: number;
  b_wins: number;
  last_played: string | null;
  pending: number;
}
```

In `PlayerSummary`, add after `avatar_color`:

```typescript
  bio?: string | null;
```

- [ ] **Step 4: Implement the fetchers** — in `ui/src/stats/statsClient.ts`, update the type import and add two functions after `fetchLeaderboard`:

```typescript
// extend the existing import line:
import type { PlayerSummary, LeaderRow, MatchRecord, Identity, MatchHistoryRow, HeadToHead } from "./types";
```

```typescript
export async function fetchPlayerMatches(
  id: string, limit = 20, offset = 0, base: string = brokerHttpBase(),
): Promise<{ player_id: string; matches: MatchHistoryRow[] }> {
  const res = await fetch(`${base}/stats/player/${encodeURIComponent(id)}/matches?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`stats/player/matches ${res.status}`);
  return (await res.json()) as { player_id: string; matches: MatchHistoryRow[] };
}

export async function fetchHeadToHead(
  a: string, b: string, base: string = brokerHttpBase(),
): Promise<HeadToHead> {
  const res = await fetch(`${base}/stats/h2h/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
  if (!res.ok) throw new Error(`stats/h2h ${res.status}`);
  return (await res.json()) as HeadToHead;
}
```

- [ ] **Step 5: Run and verify they pass**

Run (from `ui/`): `npx vitest run src/stats/statsClient.reads.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/stats/types.ts ui/src/stats/statsClient.ts ui/src/stats/statsClient.reads.test.ts
git commit -m "feat(ui): fetchPlayerMatches + fetchHeadToHead clients"
```

---

## Task 7: Client `updateProfile` (transient WS write)

**Files:**
- Modify: `ui/src/stats/statsClient.ts`
- Create: `ui/src/stats/statsClient.profile.test.ts`

**Interfaces:**
- Produces: `updateProfile(identity: Identity, fields: {name?: string; color?: string; bio?: string}, wsUrl?: string, timeoutMs?: number) -> Promise<{id: string; bio: string | null}>`.

- [ ] **Step 1: Write the failing test** — create `ui/src/stats/statsClient.profile.test.ts`:

```typescript
// ui/src/stats/statsClient.profile.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { updateProfile } from "./statsClient";
import type { Identity } from "./types";

class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  reply(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const IDY: Identity = { id: "P1", writeToken: "tok", name: "Ann", avatarColor: "#f00" };

beforeEach(() => vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket));
afterEach(() => vi.restoreAllMocks());

describe("updateProfile", () => {
  it("sends a profile_update envelope and resolves on profile_ack", async () => {
    const p = updateProfile(IDY, { bio: "love the bull" }, "ws://h");
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(FakeWS.last!.sent[0]);
    expect(sent.type).toBe("profile_update");
    expect(sent.id).toBe("P1");
    expect(sent.writeToken).toBe("tok");
    expect(sent.player.bio).toBe("love the bull");
    expect(sent.player.name).toBe("Ann");        // falls back to identity
    expect(sent.player.avatar.color).toBe("#f00");
    FakeWS.last!.reply({ type: "profile_ack", id: "P1", bio: "love the bull" });
    await expect(p).resolves.toEqual({ id: "P1", bio: "love the bull" });
  });

  it("rejects with the error code on a server error", async () => {
    const p = updateProfile(IDY, { bio: "x" }, "ws://h");
    await new Promise((r) => setTimeout(r, 0));
    FakeWS.last!.reply({ type: "error", code: "token_mismatch", message: "no" });
    await expect(p).rejects.toThrow("token_mismatch");
  });

  it("rejects with timeout when no reply arrives", async () => {
    const p = updateProfile(IDY, { bio: "x" }, "ws://h", 20);
    await expect(p).rejects.toThrow("timeout");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run (from `ui/`): `npx vitest run src/stats/statsClient.profile.test.ts`
Expected: FAIL (`updateProfile` not exported).

- [ ] **Step 3: Implement** — add to `ui/src/stats/statsClient.ts` (after `submitMatch`):

```typescript
/** Update server-side profile fields over a transient WebSocket; resolves on profile_ack. */
export function updateProfile(
  identity: Identity, fields: { name?: string; color?: string; bio?: string },
  wsUrl: string = readBrokerUrl(), timeoutMs = 8000,
): Promise<{ id: string; bio: string | null }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("ws_construct"));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("timeout"))), timeoutMs);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "profile_update",
        id: identity.id,
        writeToken: identity.writeToken,
        player: {
          id: identity.id,
          name: fields.name ?? identity.name,
          avatar: { color: fields.color ?? identity.avatarColor },
          bio: fields.bio ?? "",
        },
      }));
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: { type?: string; id?: string; bio?: string | null; code?: string };
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); }
      catch { return; }
      if (msg.type === "profile_ack") finish(() => resolve({ id: msg.id ?? identity.id, bio: msg.bio ?? null }));
      else if (msg.type === "error") finish(() => reject(new Error(msg.code || "error")));
    };
    ws.onerror = () => finish(() => reject(new Error("ws_error")));
    ws.onclose = () => finish(() => reject(new Error("closed")));
  });
}
```

- [ ] **Step 4: Run and verify it passes**

Run (from `ui/`): `npx vitest run src/stats/statsClient.profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/stats/statsClient.ts ui/src/stats/statsClient.profile.test.ts
git commit -m "feat(ui): updateProfile WS client"
```

---

## Task 8: `bio` in the local profile model

**Files:**
- Modify: `ui/src/multiplayer/player.ts`
- Test: `ui/src/multiplayer/player.test.ts`

**Interfaces:**
- Produces: `bio?: string` on `Profile`; `setPlayerBio(bio: string) -> Profile`; legacy records without `bio` load cleanly.

- [ ] **Step 1: Write the failing tests** — append to `ui/src/multiplayer/player.test.ts`:

```typescript
import { setPlayerBio } from "./player";

describe("bio", () => {
  beforeEach(() => localStorage.clear());

  it("setPlayerBio persists and round-trips", () => {
    const p = setPlayerBio("checkout king");
    expect(p.bio).toBe("checkout king");
    expect(getOrCreatePlayer().bio).toBe("checkout king");
  });

  it("a legacy record without bio loads with bio undefined", () => {
    localStorage.setItem("granbridge.player", JSON.stringify({
      id: "abc", name: "Old", avatar: { color: "#123456" }, writeToken: "t",
    }));
    const p = getOrCreatePlayer();
    expect(p.bio).toBeUndefined();
    expect(p.name).toBe("Old");
  });
});
```

> If `getOrCreatePlayer` is not already imported at the top of `player.test.ts`, add it to the existing import.

- [ ] **Step 2: Run and verify they fail**

Run (from `ui/`): `npx vitest run src/multiplayer/player.test.ts`
Expected: FAIL (`setPlayerBio` not exported).

- [ ] **Step 3: Implement** — in `ui/src/multiplayer/player.ts`:

Add `bio?: string;` to the `Profile` interface (after `writeToken`). In `getOrCreatePlayer`, when reconstructing from `parsed`, carry an existing `bio`. Update the parsed-shape type and the profile build:

```typescript
      const parsed = JSON.parse(raw) as {
        id?: string; name?: string; avatar?: { color?: unknown }; writeToken?: unknown; bio?: unknown;
      };
```

and in the `profile` object literal, add:

```typescript
          ...(typeof parsed.bio === "string" ? { bio: parsed.bio } : {}),
```

Add the setter (after `setPlayerColor`):

```typescript
/** Update the stored bio; returns the updated profile. */
export function setPlayerBio(bio: string): Profile {
  const updated: Profile = { ...getOrCreatePlayer(), bio };
  _persist(updated);
  return updated;
}
```

- [ ] **Step 4: Run and verify they pass**

Run (from `ui/`): `npx vitest run src/multiplayer/player.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/player.ts ui/src/multiplayer/player.test.ts
git commit -m "feat(ui): bio field on the local profile model"
```

---

## Task 9: Profile bio editor (debounced propagation)

**Files:**
- Modify: `ui/src/views/Profile.tsx`
- Test: `ui/src/views/Profile.test.tsx`

**Interfaces:**
- Consumes: `setPlayerBio` (Task 8), `updateProfile` (Task 7), `getUploadEnabled`.
- Produces: a bio `<textarea aria-label="Bio">` (maxLength 160) that updates local state and fires a debounced `updateProfile` when upload is enabled.

- [ ] **Step 1: Write the failing test** — append to `ui/src/views/Profile.test.tsx`. Mock `statsClient` and `uploadPref`:

```typescript
import { vi } from "vitest";
vi.mock("../stats/statsClient", async (orig) => ({
  ...(await orig<typeof import("../stats/statsClient")>()),
  updateProfile: vi.fn().mockResolvedValue({ id: "x", bio: "yo" }),
  fetchPlayerMatches: vi.fn().mockResolvedValue({ player_id: "x", matches: [] }),
}));
vi.mock("../stats/uploadPref", () => ({ getUploadEnabled: () => true, setUploadEnabled: vi.fn() }));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Profile } from "./Profile";
import { updateProfile } from "../stats/statsClient";

it("edits bio and fires a debounced updateProfile", async () => {
  render(<Profile />);
  const bio = screen.getByLabelText("Bio") as HTMLTextAreaElement;
  fireEvent.change(bio, { target: { value: "love the bull" } });
  expect(bio.value).toBe("love the bull");
  await waitFor(() => expect(updateProfile).toHaveBeenCalled(), { timeout: 1500 });
});
```

> If `Profile.test.tsx` already mocks `statsClient`, merge these mocks into the existing `vi.mock` block instead of adding a second one (vitest hoists and dedups by path — a duplicate factory for the same path will error).

- [ ] **Step 2: Run and verify it fails**

Run (from `ui/`): `npx vitest run src/views/Profile.test.tsx`
Expected: FAIL (`Unable to find a label "Bio"`).

- [ ] **Step 3: Implement** — in `ui/src/views/Profile.tsx`:

Add imports:

```typescript
import { setPlayerBio } from "../multiplayer/player";
import { updateProfile } from "../stats/statsClient";
```

Add a debounced-propagation effect inside the component (after the existing `useEffect`). It watches name/color/bio and pushes them to the server, gated by the upload toggle:

```typescript
  // Propagate profile edits to the server (debounced), so name/avatar/bio sync
  // even without playing a match. Best-effort: ignore failures (offline, etc.).
  useEffect(() => {
    if (!getUploadEnabled()) return;
    const t = setTimeout(() => {
      void updateProfile(
        { id: profile.id, writeToken: profile.writeToken, name: profile.name, avatarColor: profile.avatar.color },
        { name: profile.name, color: profile.avatar.color, bio: profile.bio ?? "" },
      ).catch(() => { /* best-effort */ });
    }, 600);
    return () => clearTimeout(t);
  }, [profile.id, profile.writeToken, profile.name, profile.avatar.color, profile.bio]);
```

Add the bio textarea in the JSX, right after the Display name `<label>` block:

```tsx
      <label className="block">
        <span className="text-sm text-neutral-300">Bio</span>
        <textarea
          value={profile.bio ?? ""}
          onChange={(e) => setProfile(setPlayerBio(e.target.value))}
          aria-label="Bio"
          maxLength={160}
          rows={2}
          placeholder="Say something about your game (optional)"
          className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <span className="text-[11px] text-neutral-500">{(profile.bio ?? "").length}/160</span>
      </label>
```

- [ ] **Step 4: Run and verify it passes**

Run (from `ui/`): `npx vitest run src/views/Profile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Profile.tsx ui/src/views/Profile.test.tsx
git commit -m "feat(ui): profile bio editor with debounced server sync"
```

---

## Task 10: Profile recent-games list

**Files:**
- Modify: `ui/src/views/Profile.tsx`
- Test: `ui/src/views/Profile.test.tsx`

**Interfaces:**
- Consumes: `fetchPlayerMatches` (Task 6) — already mocked in Task 9's test setup.
- Produces: a "Recent games" section rendering `MatchHistoryRow`s, with an empty state.

- [ ] **Step 1: Write the failing test** — extend the `fetchPlayerMatches` mock (from Task 9) to return rows for this case, and add:

```typescript
import { fetchPlayerMatches } from "../stats/statsClient";

it("renders recent games from the server", async () => {
  (fetchPlayerMatches as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    player_id: "x",
    matches: [
      { match_id: "m1", mode: "x01", opponent_id: "O", opponent_name: "Opie",
        is_remote: true, won: true, verified: true, three_dart_avg: 60.2,
        started_at: "2026-05-24T10:00:00.000Z", ended_at: null },
    ],
  });
  render(<Profile />);
  expect(await screen.findByText(/Opie/)).toBeInTheDocument();
  expect(screen.getByText(/60.2/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails**

Run (from `ui/`): `npx vitest run src/views/Profile.test.tsx`
Expected: FAIL (no "Opie" text).

- [ ] **Step 3: Implement** — in `ui/src/views/Profile.tsx`:

Add imports + state:

```typescript
import { fetchPlayerMatches } from "../stats/statsClient";
import type { MatchHistoryRow } from "../stats/types";
```

```typescript
  const [history, setHistory] = useState<MatchHistoryRow[] | null>(null);
```

Add a fetch effect:

```typescript
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { matches } = await fetchPlayerMatches(profile.id, 10);
        if (!cancelled) setHistory(matches);
      } catch {
        if (!cancelled) setHistory([]);   // server unreachable -> empty (local fallback already covers summary)
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id]);
```

Render a section near the bottom of the returned JSX (after the Career stats block):

```tsx
      <div className="border-t border-neutral-800 pt-4">
        <h3 className="text-sm text-neutral-300 mb-2">Recent games</h3>
        {history === null ? (
          <p className="text-neutral-600 text-xs">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-neutral-600 text-xs">No games on the server yet.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((m) => (
              <li key={m.match_id} className="flex items-center justify-between text-sm bg-neutral-800 rounded px-3 py-1.5">
                <span className="text-neutral-300 truncate">
                  vs {m.opponent_name ?? (m.opponent_id ? m.opponent_id.slice(0, 6) : "—")}
                </span>
                <span className="text-neutral-500 text-xs">{m.mode}</span>
                <span className={m.won ? "text-emerald-400 font-semibold" : "text-neutral-500"}>
                  {m.won ? "W" : "L"}
                </span>
                <span className="text-amber-300 tabular-nums">{m.three_dart_avg.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 4: Run and verify it passes**

Run (from `ui/`): `npx vitest run src/views/Profile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Profile.tsx ui/src/views/Profile.test.tsx
git commit -m "feat(ui): recent-games list on the Profile view"
```

---

## Task 11: Head-to-head on the opponent card

**Files:**
- Modify: `ui/src/components/OpponentCard.tsx`, `ui/src/views/Multiplayer.tsx`
- Test: `ui/src/components/OpponentCard.test.tsx`

**Interfaces:**
- Consumes: `fetchHeadToHead` (Task 6); `HeadToHead` type.
- Produces: optional `headToHead?: HeadToHead` prop on `OpponentCard` rendering a "vs you: A–B" line when `games > 0`; `Multiplayer.tsx` fetches it for the current opponent.

- [ ] **Step 1: Write the failing test** — append to `ui/src/components/OpponentCard.test.tsx`:

```typescript
  it("renders the head-to-head line when games > 0", () => {
    render(
      <OpponentCard
        profile={{ id: "id2", name: "Bob", avatar: { color: "#3b82f6" }, writeToken: "tok" }}
        summary={{ threeDartAvg: 48.6, wins: 4, gamesPlayed: 9 }}
        headToHead={{ a: "me", b: "id2", games: 6, a_wins: 4, b_wins: 2, last_played: null, pending: 0 }}
      />,
    );
    expect(screen.getByText(/vs you:\s*4.?2/i)).toBeInTheDocument();
  });

  it("omits the head-to-head line when there are no games", () => {
    render(
      <OpponentCard
        profile={{ id: "id2", name: "Bob", avatar: { color: "#3b82f6" }, writeToken: "tok" }}
        summary={{ threeDartAvg: 48.6, wins: 4, gamesPlayed: 9 }}
        headToHead={{ a: "me", b: "id2", games: 0, a_wins: 0, b_wins: 0, last_played: null, pending: 0 }}
      />,
    );
    expect(screen.queryByText(/vs you:/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and verify it fails**

Run (from `ui/`): `npx vitest run src/components/OpponentCard.test.tsx`
Expected: FAIL (no "vs you" text).

- [ ] **Step 3: Implement the component** — update `ui/src/components/OpponentCard.tsx`:

```tsx
/** OpponentCard — opponent's avatar, name, career summary, and optional head-to-head. */
import { Avatar } from "./Avatar";
import type { Profile } from "../multiplayer/player";
import type { CareerSummary } from "../multiplayer/careerSummary";
import type { HeadToHead } from "../stats/types";

interface OpponentCardProps {
  profile: Profile;
  summary: CareerSummary;
  headToHead?: HeadToHead;
}

export function OpponentCard({ profile, summary, headToHead }: OpponentCardProps) {
  const h2h = headToHead && headToHead.games > 0 ? headToHead : null;
  return (
    <div className="flex items-center gap-4 bg-neutral-900 rounded-lg px-4 py-3">
      <Avatar name={profile.name} color={profile.avatar.color} size={48} />
      <div className="flex-1">
        <div className="font-semibold">{profile.name}</div>
        {h2h ? (
          <div className="text-xs text-amber-300">vs you: {h2h.a_wins}–{h2h.b_wins}</div>
        ) : (
          <div className="text-xs text-neutral-400">opponent</div>
        )}
      </div>
      <div className="flex gap-4 text-center">
        <Stat label="Avg" value={summary.threeDartAvg.toFixed(1)} />
        <Stat label="Wins" value={String(summary.wins)} />
        <Stat label="Games" value={String(summary.gamesPlayed)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold text-amber-300 tabular-nums">{value}</div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the component test and verify it passes**

Run (from `ui/`): `npx vitest run src/components/OpponentCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the fetch in `Multiplayer.tsx`** — `OpponentCard` is rendered at two sites from `opponentCard` store state. Compute H2H once and pass it to both.

Add imports near the top of `ui/src/views/Multiplayer.tsx`:

```typescript
import { fetchHeadToHead } from "../stats/statsClient";
import { getOrCreatePlayer } from "../multiplayer/player";
import type { HeadToHead } from "../stats/types";
```

Inside the component, near where `opponentCard` is read from the store, add:

```typescript
  const [h2h, setH2h] = useState<HeadToHead | undefined>(undefined);
  useEffect(() => {
    const oppId = opponentCard?.profile.id;
    if (!oppId) { setH2h(undefined); return; }
    let cancelled = false;
    fetchHeadToHead(getOrCreatePlayer().id, oppId)
      .then((r) => { if (!cancelled) setH2h(r); })
      .catch(() => { if (!cancelled) setH2h(undefined); });
    return () => { cancelled = true; };
  }, [opponentCard?.profile.id]);
```

Pass `headToHead={h2h}` to **both** `<OpponentCard … />` usages (the `oppCard={...}` prop around line 335 and the direct render around line 395):

```tsx
<OpponentCard profile={opponentCard.profile} summary={opponentCard.summary} headToHead={h2h} />
```

> Ensure `useState`/`useEffect` are imported from `react` in `Multiplayer.tsx` (add to the existing React import if missing).

- [ ] **Step 6: Run the focused tests + full client suite**

Run (from `ui/`):
```
npx vitest run src/components/OpponentCard.test.tsx src/views/Multiplayer.test.tsx
npm test
```
Expected: PASS. If `npm test` surfaces a TS error in `Multiplayer.tsx` (unused import / missing hook import), fix and re-run.

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/OpponentCard.tsx ui/src/components/OpponentCard.test.tsx ui/src/views/Multiplayer.tsx
git commit -m "feat(ui): head-to-head line on the opponent card"
```

---

## Final verification

- [ ] **Server:** `C:/Users/willa/granbridge/.venv/Scripts/python.exe -m pytest server/tests -q` → all pass.
- [ ] **Client:** from `ui/`, `npm test` → all pass; `npx tsc -b --noEmit` (or `npm run build`) → no type errors.
- [ ] **Smoke the live-shaped contract (optional):** start the broker locally with `STATS_DB_PATH` set and curl `/stats/player/<id>/matches` and `/stats/h2h/<a>/<b>`.
- [ ] Push `feat/server-profiles` and open a PR; in the PR body call out the **server-v0.4.0** rollout note (the `bio` migration runs on broker boot) and that the client (**v0.1.8**) degrades gracefully against an un-upgraded broker.

## Notes for the release (post-merge, not part of this plan)

- Bump `server/` version → **server-v0.4.0**, update `server/CHANGELOG.md`, redeploy to TOWER (`docker compose up -d --build`); the migration is automatic and back-compatible.
- Bump client → **v0.1.8** (full release, **never** `--prerelease` — breaks the auto-updater), ship `QUICKSTART.md` as a release asset per the release runbook.
