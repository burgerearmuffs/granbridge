/**
 * Multiplayer Zustand store.
 *
 * State:
 *   mpStatus  — idle | connecting | in_room | error
 *   room      — current room ID
 *   selfId    — our broker peer_id (assigned by server after join)
 *   peers     — list of connected peers
 *   mic       — microphone enabled
 *   cam       — camera enabled
 *   error     — last error message (if any)
 *
 * Persisted to localStorage:
 *   brokerUrl — wss://darts.aventador.io/ by default (override via VITE_BROKER_URL or the UI)
 *   mic, cam  — user preferences
 */

import { create } from "zustand";
import type { PeerInfo } from "./brokerClient";

export type MpStatus = "idle" | "connecting" | "in_room" | "error";
export type ConnectionHealth = "connected" | "reconnecting" | "lost";

export interface ChatMsg {
  self: boolean;
  name: string;
  text: string;
  ts: number;
}

/** Keep at most this many chat lines in memory. */
const CHAT_HISTORY_CAP = 200;

function readTurnClockPref(): number {
  const v = Number(readString(LS_TURN_CLOCK) ?? "0");
  return Number.isFinite(v) && v >= 0 && v <= 600 ? v : 0;
}

const LS_BROKER_URL = "granbridge.mp.brokerUrl";
const LS_MIC = "granbridge.mp.mic";
const LS_CAM = "granbridge.mp.cam";
const LS_CAM_DEVICE = "granbridge.mp.camDeviceId";
const LS_MIC_DEVICE = "granbridge.mp.micDeviceId";
const LS_TURN_CLOCK = "granbridge.mp.turnClockSecs";

export const DEFAULT_BROKER_URL = "wss://darts.aventador.io/";

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readBrokerUrl(): string {
  // In a Vite browser build import.meta.env is statically injected; in vitest
  // vi.stubEnv sets process.env (accessed via globalThis to avoid @types/node).
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const fallback = metaEnv["VITE_BROKER_URL"] ?? nodeEnv["VITE_BROKER_URL"] ?? DEFAULT_BROKER_URL;
  try {
    return localStorage.getItem(LS_BROKER_URL) ?? fallback;
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}

interface MpState {
  mpStatus: MpStatus;
  room: string;
  selfId: string;
  peers: PeerInfo[];
  mic: boolean;
  cam: boolean;
  /** Preferred capture devices (set in Settings); null = browser default. Persisted. */
  camDeviceId: string | null;
  micDeviceId: string | null;
  error: string | undefined;
  /** User-visible note when joining without camera/mic (permission denied etc.). */
  mediaNotice: string | undefined;
  brokerUrl: string;
  remoteMatchId: string | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  connectionHealth: ConnectionHealth;
  opponentCard: { profile: import("./player").Profile; summary: import("./careerSummary").CareerSummary } | null;
  /** In-room text chat (capped at CHAT_HISTORY_CAP lines). */
  chatMessages: ChatMsg[];
  /** Lines received while the chat panel is closed. */
  chatUnread: number;
  /** Per-turn clock in seconds; 0 = off. Host preference (persisted), synced to the guest. */
  turnClockSecs: number;

  // Actions
  setMpStatus: (s: MpStatus) => void;
  setRoom: (r: string) => void;
  setSelfId: (id: string) => void;
  setPeers: (peers: PeerInfo[]) => void;
  setMic: (v: boolean) => void;
  setCam: (v: boolean) => void;
  setCamDeviceId: (id: string | null) => void;
  setMicDeviceId: (id: string | null) => void;
  setError: (msg: string | undefined) => void;
  setMediaNotice: (msg: string | undefined) => void;
  setBrokerUrl: (url: string) => void;
  setRemoteMatchId: (id: string | null) => void;
  setLocalStream: (s: MediaStream | null) => void;
  setRemoteStream: (peerId: string, s: MediaStream) => void;
  setConnectionHealth: (h: ConnectionHealth) => void;
  setOpponentCard: (c: MpState["opponentCard"]) => void;
  addChatMessage: (m: ChatMsg, opts?: { unread?: boolean }) => void;
  clearChatUnread: () => void;
  /** Host changes the preference (persisted); */
  setTurnClockPref: (seconds: number) => void;
  /** Guest applies the host's announced value (not persisted). */
  applyTurnClock: (seconds: number) => void;
  resetMp: () => void;
}

export const useMpStore = create<MpState>((set) => ({
  mpStatus: "idle",
  room: "",
  selfId: "",
  peers: [],
  mic: readBool(LS_MIC, true),
  cam: readBool(LS_CAM, true),
  camDeviceId: readString(LS_CAM_DEVICE),
  micDeviceId: readString(LS_MIC_DEVICE),
  error: undefined,
  mediaNotice: undefined,
  brokerUrl: readBrokerUrl(),
  remoteMatchId: null,
  localStream: null,
  remoteStreams: new Map(),
  connectionHealth: "connected",
  opponentCard: null,
  chatMessages: [],
  chatUnread: 0,
  turnClockSecs: readTurnClockPref(),

  setMpStatus: (s) => set({ mpStatus: s }),
  setRoom: (r) => set({ room: r }),
  setSelfId: (id) => set({ selfId: id }),
  setPeers: (peers) => set({ peers }),
  setMic: (v) => {
    try { localStorage.setItem(LS_MIC, String(v)); } catch { /* ignore */ }
    set({ mic: v });
  },
  setCam: (v) => {
    try { localStorage.setItem(LS_CAM, String(v)); } catch { /* ignore */ }
    set({ cam: v });
  },
  setCamDeviceId: (id) => {
    try {
      if (id) localStorage.setItem(LS_CAM_DEVICE, id);
      else localStorage.removeItem(LS_CAM_DEVICE);
    } catch { /* ignore */ }
    set({ camDeviceId: id });
  },
  setMicDeviceId: (id) => {
    try {
      if (id) localStorage.setItem(LS_MIC_DEVICE, id);
      else localStorage.removeItem(LS_MIC_DEVICE);
    } catch { /* ignore */ }
    set({ micDeviceId: id });
  },
  setError: (msg) => set({ error: msg }),
  setMediaNotice: (msg) => set({ mediaNotice: msg }),
  setBrokerUrl: (url) => {
    try { localStorage.setItem(LS_BROKER_URL, url); } catch { /* ignore */ }
    set({ brokerUrl: url });
  },
  setRemoteMatchId: (id) => set({ remoteMatchId: id }),
  setLocalStream: (s) => set({ localStream: s }),
  setRemoteStream: (peerId, s) => set((st) => ({ remoteStreams: new Map(st.remoteStreams).set(peerId, s) })),
  setConnectionHealth: (h) => set({ connectionHealth: h }),
  setOpponentCard: (c) => set({ opponentCard: c }),
  addChatMessage: (m, opts) =>
    set((st) => ({
      chatMessages: [...st.chatMessages, m].slice(-CHAT_HISTORY_CAP),
      chatUnread: opts?.unread ? st.chatUnread + 1 : st.chatUnread,
    })),
  clearChatUnread: () => set({ chatUnread: 0 }),
  setTurnClockPref: (seconds) => {
    try { localStorage.setItem(LS_TURN_CLOCK, String(seconds)); } catch { /* ignore */ }
    set({ turnClockSecs: seconds });
  },
  applyTurnClock: (seconds) => set({ turnClockSecs: seconds }),
  resetMp: () =>
    set({
      mpStatus: "idle",
      room: "",
      selfId: "",
      peers: [],
      error: undefined,
      mediaNotice: undefined,
      remoteMatchId: null,
      localStream: null,
      remoteStreams: new Map(),
      connectionHealth: "connected",
      opponentCard: null,
      chatMessages: [],
      chatUnread: 0,
      // Restore the local preference — a guest may have had the host's value applied.
      turnClockSecs: readTurnClockPref(),
    }),
}));
