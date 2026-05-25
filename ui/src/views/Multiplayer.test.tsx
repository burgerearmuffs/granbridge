/**
 * Multiplayer view — render + interaction tests.
 *
 * mpSession is mocked so no WebSocket / WebRTC touches jsdom (which has
 * neither). Tests verify:
 *  - join form fields render
 *  - Join button is present and initially disabled when fields are empty
 *  - filling room + password enables Join
 *  - clicking Join calls mpSession.join() with the correct room / password
 *  - in-room view: host/guest roles, game board, reconnect banner
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useMpStore } from "../multiplayer/store";
import { useStore } from "../store";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// vi.mock is hoisted to the top of the file, so the factory must be
// self-contained (no references to variables declared in the outer scope).
// We use vi.hoisted() to create the mock object before the hoist barrier.
const mockMpSession = vi.hoisted(() => ({
  join: vi.fn().mockResolvedValue(undefined),
  leave: vi.fn(),
  startMatch: vi.fn(),
  requestAction: vi.fn(),
}));

vi.mock("../multiplayer/session", () => ({
  mpSession: mockMpSession,
}));

// ── Import component AFTER mocks are in place ─────────────────────────────────

import { Multiplayer } from "./Multiplayer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fillAndJoin(room: string, password: string) {
  const roomInput = screen.getByRole("textbox", { name: /room id/i });
  const passInput = screen.getByLabelText(/password/i);
  fireEvent.change(roomInput, { target: { value: room } });
  fireEvent.change(passInput, { target: { value: password } });
  const joinBtn = screen.getByRole("button", { name: /join/i });
  fireEvent.click(joinBtn);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  useMpStore.getState().resetMp();
  useMpStore.setState({ brokerUrl: "ws://127.0.0.1:8788", mic: true, cam: true, mpStatus: "idle", error: undefined });
  useStore.setState({ gameState: null });
  vi.clearAllMocks();
  mockMpSession.join.mockResolvedValue(undefined);
});

describe("Multiplayer join form", () => {
  it("renders the display-name field", () => {
    render(<Multiplayer />);
    expect(screen.getByRole("textbox", { name: /display name/i })).toBeInTheDocument();
  });

  it("renders the Room ID field", () => {
    render(<Multiplayer />);
    expect(screen.getByRole("textbox", { name: /room id/i })).toBeInTheDocument();
  });

  it("renders the Password field", () => {
    render(<Multiplayer />);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders the Broker URL field prefilled with default", () => {
    render(<Multiplayer />);
    const brokerField = screen.getByRole("textbox", { name: /broker url/i });
    expect((brokerField as HTMLInputElement).value).toBe("ws://127.0.0.1:8788");
  });

  it("renders a Join button", () => {
    render(<Multiplayer />);
    expect(screen.getByRole("button", { name: /join/i })).toBeInTheDocument();
  });

  it("Join button is disabled when room + password are empty", () => {
    render(<Multiplayer />);
    expect(screen.getByRole("button", { name: /join/i })).toBeDisabled();
  });

  it("Join button is enabled when room + password are filled", () => {
    render(<Multiplayer />);
    const roomInput = screen.getByRole("textbox", { name: /room id/i });
    const passInput = screen.getByLabelText(/password/i);
    fireEvent.change(roomInput, { target: { value: "r1" } });
    fireEvent.change(passInput, { target: { value: "pw" } });
    expect(screen.getByRole("button", { name: /join/i })).not.toBeDisabled();
  });

  it("clicking Join calls mpSession.join() with the entered room + password", async () => {
    render(<Multiplayer />);
    await act(async () => { fillAndJoin("my-room", "secret"); });
    expect(mockMpSession.join).toHaveBeenCalledWith(
      expect.objectContaining({ room: "my-room", password: "secret" }),
    );
  });

  it("clicking Join calls mpSession.join() with the entered room + password (arena case)", async () => {
    render(<Multiplayer />);
    await act(async () => { fillAndJoin("arena-42", "p@ssw0rd"); });
    expect(mockMpSession.join).toHaveBeenCalledWith(
      expect.objectContaining({ room: "arena-42", password: "p@ssw0rd" }),
    );
  });

  it("displays an error alert when store has an error", () => {
    useMpStore.setState({ error: "wrong_password: Bad password" });
    render(<Multiplayer />);
    expect(screen.getByRole("alert")).toHaveTextContent("wrong_password: Bad password");
  });
});

describe("Multiplayer in-room match panel", () => {
  function enterRoomAs(selfId: string, peerId: string) {
    useMpStore.setState({
      mpStatus: "in_room",
      room: "r1",
      selfId,
      peers: [{ peer_id: peerId, player: { id: "px", name: "Opponent" } }],
    });
  }

  it("host (smaller peer id) sees the Start match button", () => {
    enterRoomAs("aaa", "zzz");
    render(<Multiplayer />);
    expect(screen.getByRole("button", { name: /start match/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /match mode/i })).toBeInTheDocument();
  });

  it("guest (larger peer id) sees a waiting message, no Start button", () => {
    enterRoomAs("zzz", "aaa");
    render(<Multiplayer />);
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start match/i })).toBeNull();
  });

  it("renders the synced board when a game is in progress", () => {
    enterRoomAs("aaa", "zzz");
    useStore.setState({
      gameState: {
        mode: "x01", status: "in_progress",
        players: [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
        active_index: 0, visit: [], legs: {}, sets: {}, winner: null,
        options: {}, mode_view: {}, stats: {},
      },
    });
    render(<Multiplayer />);
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);  // LiveGame header + scoreboard
    expect(screen.queryByRole("button", { name: /start match/i })).toBeNull();
  });

  it("shows reconnecting banner when connectionHealth is reconnecting", () => {
    enterRoomAs("aaa", "zzz");
    useMpStore.setState({ connectionHealth: "reconnecting" });
    render(<Multiplayer />);
    expect(screen.getByRole("status")).toHaveTextContent(/reconnecting/i);
  });

  it("shows lost banner when connectionHealth is lost", () => {
    enterRoomAs("aaa", "zzz");
    useMpStore.setState({ connectionHealth: "lost" });
    render(<Multiplayer />);
    expect(screen.getByRole("alert")).toHaveTextContent(/connection lost/i);
  });
});

import { OpponentCard } from "../components/OpponentCard";

describe("Multiplayer avatars", () => {
  it("renders an avatar for a peer with no stream", () => {
    useMpStore.setState({
      mpStatus: "in_room",
      room: "r1",
      selfId: "aaa",
      peers: [{ peer_id: "zzz", player: { id: "id-z", name: "Zoe", avatar: { color: "#10b981" } } }],
    });
    render(<Multiplayer />);
    expect(screen.getByRole("img", { name: /zoe avatar/i })).toBeInTheDocument();
  });
});

describe("OpponentCard wiring smoke", () => {
  it("OpponentCard renders given a profile + summary", () => {
    render(
      <OpponentCard
        profile={{ id: "x", name: "Eve", avatar: { color: "#ef4444" }, writeToken: "tok" }}
        summary={{ threeDartAvg: 1, wins: 0, gamesPlayed: 0 }}
      />,
    );
    expect(screen.getByText("Eve")).toBeInTheDocument();
  });
});

// ── Task 4.4: MpGameLayout wiring ─────────────────────────────────────────────
describe("Multiplayer in-game layout (MpGameLayout)", () => {
  function enterRoomInProgress(selfId: string, peerId: string) {
    useMpStore.setState({
      mpStatus: "in_room",
      room: "r1",
      selfId,
      peers: [{ peer_id: peerId, player: { id: "px", name: "Opponent" } }],
    });
    useStore.setState({
      gameState: {
        mode: "x01", status: "in_progress",
        players: [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
        active_index: 0, visit: [], legs: {}, sets: {}, winner: null,
        options: {}, mode_view: {}, stats: {},
      },
    });
  }

  it("uses data-mp-layout when a game is in_progress in the room", () => {
    enterRoomInProgress("aaa", "zzz");
    const { container } = render(<Multiplayer />);
    expect(container.querySelector("[data-mp-layout]")).not.toBeNull();
  });

  it("renders both video tiles inside the layout when in_progress", () => {
    enterRoomInProgress("aaa", "zzz");
    render(<Multiplayer />);
    // VideoTile renders aria-label "Video stream for ..."
    const videos = screen.getAllByLabelText(/video stream for/i);
    expect(videos.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the board (LiveGame) inside the layout", () => {
    enterRoomInProgress("aaa", "zzz");
    render(<Multiplayer />);
    // LiveGame renders player names Alice/Bob — already asserted by existing test
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("does NOT show the Start match button when in_progress", () => {
    enterRoomInProgress("aaa", "zzz");
    render(<Multiplayer />);
    expect(screen.queryByRole("button", { name: /start match/i })).toBeNull();
  });

  it("lobby (no in_progress game) keeps the existing video-grid and host Start button", () => {
    // Lobby = in_room but no in_progress game
    useMpStore.setState({
      mpStatus: "in_room",
      room: "r1",
      selfId: "aaa",
      peers: [{ peer_id: "zzz", player: { id: "px", name: "Opponent" } }],
    });
    useStore.setState({ gameState: null });
    const { container } = render(<Multiplayer />);
    // Should NOT use MpGameLayout
    expect(container.querySelector("[data-mp-layout]")).toBeNull();
    // Should show Start match for host
    expect(screen.getByRole("button", { name: /start match/i })).toBeInTheDocument();
  });
});

// append to ui/src/views/Multiplayer.test.tsx (it already renders <Multiplayer/> and mocks media/WebRTC).
// This test drives the onOpponentCard path indirectly is hard; instead unit-test the resolver helper.
import { resolveOpponentSummary } from "../stats/statsClient";
import { describe as d2, it as i2, expect as e2, vi as v2, afterEach as a2 } from "vitest";

a2(() => v2.restoreAllMocks());

d2("resolveOpponentSummary", () => {
  i2("prefers the server summary when the fetch succeeds", async () => {
    v2.stubGlobal("fetch", v2.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      three_dart_avg: 70, wins: 9, games_played: 12 }) }));
    const out = await resolveOpponentSummary("oppId", { threeDartAvg: 1, wins: 1, gamesPlayed: 1 });
    e2(out).toEqual({ threeDartAvg: 70, wins: 9, gamesPlayed: 12 });
    v2.unstubAllGlobals();
  });
  i2("falls back to the data-channel summary on fetch error", async () => {
    v2.stubGlobal("fetch", v2.fn().mockResolvedValue({ ok: false, status: 500 }));
    const fallback = { threeDartAvg: 1, wins: 1, gamesPlayed: 1 };
    const out = await resolveOpponentSummary("oppId", fallback);
    e2(out).toBe(fallback);
    v2.unstubAllGlobals();
  });
});
