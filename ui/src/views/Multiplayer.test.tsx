/**
 * Multiplayer view — render + interaction tests.
 *
 * BrokerClient and getLocalStream are mocked so no WebSocket / WebRTC touches
 * jsdom, which has neither. Tests verify:
 *  - join form fields render
 *  - Join button is present and initially disabled when fields are empty
 *  - filling room + password enables Join
 *  - clicking Join calls BrokerClient#connect and BrokerClient#join with the
 *    correct room / password
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useMpStore } from "../multiplayer/store";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock BrokerClient so we never touch WebSocket in jsdom
const mockBrokerInstance = {
  onJoined: vi.fn().mockReturnThis(),
  onPeers: vi.fn().mockReturnThis(),
  onSignal: vi.fn().mockReturnThis(),
  onMsg: vi.fn().mockReturnThis(),
  onError: vi.fn().mockReturnThis(),
  onClose: vi.fn().mockReturnThis(),
  connect: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  close: vi.fn(),
  sendSignal: vi.fn(),
  sendMsg: vi.fn(),
};

vi.mock("../multiplayer/brokerClient", () => ({
  BrokerClient: vi.fn(() => mockBrokerInstance),
}));

// Mock getLocalStream — returns null (no media in jsdom)
vi.mock("../multiplayer/media", () => ({
  getLocalStream: vi.fn().mockResolvedValue(null),
}));

// Mock PeerManager — no-op
vi.mock("../multiplayer/peerManager", () => ({
  PeerManager: vi.fn(() => ({
    onRemoteStream: null,
    onPeerState: null,
    closeAll: vi.fn(),
    sendData: vi.fn(),
  })),
  DEFAULT_ICE_SERVERS: [],
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
  vi.clearAllMocks();
  // Reset mock to return itself for chaining
  mockBrokerInstance.onJoined.mockReturnThis();
  mockBrokerInstance.onPeers.mockReturnThis();
  mockBrokerInstance.onError.mockReturnThis();
  mockBrokerInstance.onClose.mockReturnThis();
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

  it("clicking Join calls BrokerClient.connect()", async () => {
    render(<Multiplayer />);
    await act(async () => { fillAndJoin("my-room", "secret"); });
    expect(mockBrokerInstance.connect).toHaveBeenCalled();
  });

  it("clicking Join calls BrokerClient.join() with entered room + password", async () => {
    render(<Multiplayer />);
    await act(async () => { fillAndJoin("arena-42", "p@ssw0rd"); });
    expect(mockBrokerInstance.join).toHaveBeenCalledWith(
      "arena-42",
      "p@ssw0rd",
      expect.objectContaining({ name: expect.any(String), id: expect.any(String) }),
    );
  });

  it("displays an error alert when store has an error", () => {
    useMpStore.setState({ error: "wrong_password: Bad password" });
    render(<Multiplayer />);
    expect(screen.getByRole("alert")).toHaveTextContent("wrong_password: Bad password");
  });
});
