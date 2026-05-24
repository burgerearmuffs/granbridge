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
 *   brokerUrl — ws://127.0.0.1:8788 by default
 *   mic, cam  — user preferences
 */

import { create } from "zustand";
import type { PeerInfo } from "./brokerClient";

export type MpStatus = "idle" | "connecting" | "in_room" | "error";

const LS_BROKER_URL = "granbridge.mp.brokerUrl";
const LS_MIC = "granbridge.mp.mic";
const LS_CAM = "granbridge.mp.cam";

export function readBrokerUrl(): string {
  // In a Vite browser build import.meta.env is statically injected; in vitest
  // vi.stubEnv sets process.env (accessed via globalThis to avoid @types/node).
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const fallback = metaEnv["VITE_BROKER_URL"] ?? nodeEnv["VITE_BROKER_URL"] ?? "ws://127.0.0.1:8788";
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
  error: string | undefined;
  brokerUrl: string;
  remoteMatchId: string | null;

  // Actions
  setMpStatus: (s: MpStatus) => void;
  setRoom: (r: string) => void;
  setSelfId: (id: string) => void;
  setPeers: (peers: PeerInfo[]) => void;
  setMic: (v: boolean) => void;
  setCam: (v: boolean) => void;
  setError: (msg: string | undefined) => void;
  setBrokerUrl: (url: string) => void;
  setRemoteMatchId: (id: string | null) => void;
  resetMp: () => void;
}

export const useMpStore = create<MpState>((set) => ({
  mpStatus: "idle",
  room: "",
  selfId: "",
  peers: [],
  mic: readBool(LS_MIC, true),
  cam: readBool(LS_CAM, true),
  error: undefined,
  brokerUrl: readBrokerUrl(),
  remoteMatchId: null,

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
  setError: (msg) => set({ error: msg }),
  setBrokerUrl: (url) => {
    try { localStorage.setItem(LS_BROKER_URL, url); } catch { /* ignore */ }
    set({ brokerUrl: url });
  },
  setRemoteMatchId: (id) => set({ remoteMatchId: id }),
  resetMp: () =>
    set({
      mpStatus: "idle",
      room: "",
      selfId: "",
      peers: [],
      error: undefined,
      remoteMatchId: null,
    }),
}));
