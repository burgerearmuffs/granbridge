/**
 * Settings view — device pickers, broker URL validation, clear-history flow.
 * media helpers are mocked (jsdom has no mediaDevices); fetch is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useMpStore, DEFAULT_BROKER_URL } from "../multiplayer/store";

const mockMedia = vi.hoisted(() => ({
  listVideoInputs: vi.fn(async () => [
    { deviceId: "cam-1", kind: "videoinput", label: "Front Cam", groupId: "" },
  ]),
  listAudioInputs: vi.fn(async () => [
    { deviceId: "mic-1", kind: "audioinput", label: "Desk Mic", groupId: "" },
  ]),
  acquireLocalMedia: vi.fn(async () => ({ stream: null, failure: "failed" as const })),
  buildConstraints: vi.fn((cam: boolean, mic: boolean, c: string | null, m: string | null) => ({
    video: cam ? (c ? { deviceId: { ideal: c } } : true) : false,
    audio: mic ? (m ? { deviceId: { ideal: m } } : true) : false,
  })),
}));
vi.mock("../multiplayer/media", () => mockMedia);

import { Settings, isValidBrokerUrl } from "./Settings";

beforeEach(() => {
  localStorage.clear();
  useMpStore.setState({ brokerUrl: DEFAULT_BROKER_URL, camDeviceId: null, micDeviceId: null });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isValidBrokerUrl", () => {
  it("accepts ws:// and wss:// only", () => {
    expect(isValidBrokerUrl("wss://darts.example/")).toBe(true);
    expect(isValidBrokerUrl("ws://127.0.0.1:8788")).toBe(true);
    expect(isValidBrokerUrl("https://darts.example/")).toBe(false);
    expect(isValidBrokerUrl("darts.example")).toBe(false);
  });
});

describe("Settings devices", () => {
  it("lists devices and persists the chosen camera/mic", async () => {
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("Front Cam")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox", { name: /camera device/i }), {
      target: { value: "cam-1" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /microphone device/i }), {
      target: { value: "mic-1" },
    });
    expect(useMpStore.getState().camDeviceId).toBe("cam-1");
    expect(useMpStore.getState().micDeviceId).toBe("mic-1");
    expect(localStorage.getItem("granbridge.mp.camDeviceId")).toBe("cam-1");
    expect(localStorage.getItem("granbridge.mp.micDeviceId")).toBe("mic-1");
  });

  it("shows an error when the camera test fails", async () => {
    render(<Settings />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /test camera/i }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't start the camera/i);
  });
});

describe("Settings broker URL", () => {
  it("rejects a non-websocket URL and disables Save", async () => {
    render(<Settings />);
    const input = screen.getByRole("textbox", { name: /broker url/i });
    fireEvent.change(input, { target: { value: "https://nope" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/ws:\/\/ or wss:\/\//i);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("saves a valid URL into the store", async () => {
    render(<Settings />);
    const input = screen.getByRole("textbox", { name: /broker url/i });
    fireEvent.change(input, { target: { value: "wss://my.broker/" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(useMpStore.getState().brokerUrl).toBe("wss://my.broker/");
    expect(screen.getByRole("status")).toHaveTextContent(/saved/i);
  });

  it("reset restores the default broker", async () => {
    useMpStore.setState({ brokerUrl: "wss://other/" });
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));
    expect(useMpStore.getState().brokerUrl).toBe(DEFAULT_BROKER_URL);
  });
});

describe("Settings clear history", () => {
  it("requires confirmation, then POSTs to the bridge", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ cleared_games: 3, cleared_throws: 42 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: /clear match history/i }));
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/history/clear"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/cleared 3 games/i);
  });

  it("cancel backs out without calling the bridge", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: /clear match history/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /clear match history/i })).toBeInTheDocument();
  });

  it("shows an error when the bridge is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("conn refused"); }));
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: /clear match history/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't reach the bridge/i);
  });
});

describe("Settings updates", () => {
  it("explains update checks need the installed app outside Tauri", async () => {
    render(<Settings />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/installed app/i);
  });
});
