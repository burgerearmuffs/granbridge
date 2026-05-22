# GRANBRIDGE Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Subagents do NOT commit (controller squash-commits). Tasks 5a–5d (mode boards) and Task 6 components are PARALLEL-SAFE after the foundation (Tasks 1–4). All commands run from `ui/` unless noted. Use `npm`.

**Goal:** A React+TS+Tailwind+Zustand web app that connects to the GRANBRIDGE WebSocket, renders live game state, and drives games via the bidirectional command channel; Tauri-ready (native build flagged, no Rust here).

**Architecture:** One `useGranbridgeSocket` hook owns the WS and feeds a Zustand store; pure components select from it. Mode scoreboards are dispatched by `gameState.mode`.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind, Zustand, Vitest + React Testing Library + jsdom.

---

## Task 1: Scaffold `ui/`

**Files:** Create under `ui/`: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/setupTests.ts`, `src/smoke.test.ts`.

- [ ] **Step 1: `ui/package.json`**

```json
{
  "name": "granbridge-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.45",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.3",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: configs**

`ui/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020", "useDefineForClassFields": true, "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext", "skipLibCheck": true, "moduleResolution": "bundler",
    "resolveJsonModule": true, "isolatedModules": true, "noEmit": true, "jsx": "react-jsx",
    "strict": true, "noUnusedLocals": false, "noUnusedParameters": false, "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"], "references": [{ "path": "./tsconfig.node.json" }]
}
```
`ui/tsconfig.node.json`:
```json
{ "compilerOptions": { "composite": true, "skipLibCheck": true, "module": "ESNext", "moduleResolution": "bundler", "allowSyntheticDefaultImports": true }, "include": ["vite.config.ts"] }
```
`ui/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { globals: true, environment: "jsdom", setupFiles: "./src/setupTests.ts" },
});
```
`ui/tailwind.config.js`:
```js
export default { content: ["./index.html", "./src/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] };
```
`ui/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```
`ui/index.html`:
```html
<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>GRANBRIDGE</title></head><body class="bg-neutral-950"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

- [ ] **Step 3: entry + base**

`ui/src/index.css`:
```css
@tailwind base; @tailwind components; @tailwind utilities;
html,body,#root{height:100%} body{margin:0}
```
`ui/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```
`ui/src/App.tsx` (placeholder; finalized in Task 8):
```tsx
export default function App() {
  return <div className="text-white p-8 text-2xl">GRANBRIDGE</div>;
}
```
`ui/src/setupTests.ts`:
```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 4: smoke test** `ui/src/smoke.test.ts`
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => { it("math", () => expect(1 + 1).toBe(2)); });
```

- [ ] **Step 5: install + test**
Run (from `ui/`): `npm install` then `npm test`. Expected: install succeeds, smoke test passes. If a listed version is unavailable, install the nearest available and proceed.

---

## Task 2: Types (`ui/src/types.ts`)

- [ ] **Step 1: Implement** `ui/src/types.ts` (mirror of the bridge contracts)
```ts
export type Ring = "SO" | "SI" | "D" | "T" | "SBULL" | "DBULL" | "OUT";
export interface Player { id: string; name: string; }
export interface Dart { bed: string; ring: string; segment: number | null; multiplier: number; score: number; }
export interface PlayerStats { darts: number; total_scored: number; three_dart_avg: number; }
export interface GameState {
  mode: string; status: "waiting" | "in_progress" | "finished";
  players: Player[]; active_index: number; leg_starter_index?: number;
  visit: Dart[]; legs: Record<string, number>; sets: Record<string, number>;
  winner: string | null; options: Record<string, unknown>;
  mode_view: Record<string, any>; stats: Record<string, PlayerStats>;
}
export type Event =
  | { type: "connection_state"; state: string; device: string | null; rssi: number | null }
  | { type: "dart_hit"; bed: string; ring: string; segment: number | null; multiplier: number; score: number }
  | { type: "game_started"; mode: string; players: Player[]; options: Record<string, unknown> }
  | { type: "game_state"; state: GameState }
  | { type: "bust"; player: string; score_attempted: number; reason: string }
  | { type: "leg_won"; player: string; legs: number; sets: number }
  | { type: "game_won"; player: string }
  | { type: "error"; category: string; message: string };
export type Command =
  | { command: "start_game"; mode: string; players: string[]; options: Record<string, unknown> }
  | { command: "next_player" } | { command: "record_miss" } | { command: "undo" }
  | { command: "correct_last"; bed: string } | { command: "end_game" };
```
(No test; consumed by typed tests downstream.)

---

## Task 3: Store (`ui/src/store.ts`)

- [ ] **Step 1: Failing test** `ui/src/store.test.ts`
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

const sampleState = { mode: "x01", status: "in_progress", players: [{id:"p1",name:"A"}], active_index: 0,
  visit: [], legs: {p1:0}, sets: {p1:0}, winner: null, options: {}, mode_view: { scores: { p1: 441 } }, stats: {} } as any;

describe("store", () => {
  beforeEach(() => useStore.getState().reset());
  it("applies game_state", () => {
    useStore.getState().applyEvent({ type: "game_state", state: sampleState });
    expect(useStore.getState().gameState?.mode_view.scores.p1).toBe(441);
  });
  it("tracks connection", () => {
    useStore.getState().setConnection("connected");
    expect(useStore.getState().connection).toBe("connected");
  });
  it("rings banners and caps at 5", () => {
    for (let i=0;i<7;i++) useStore.getState().applyEvent({ type:"bust", player:"p1", score_attempted:1, reason:"x" });
    expect(useStore.getState().banners.length).toBe(5);
  });
});
```

- [ ] **Step 2: Implement** `ui/src/store.ts`
```ts
import { create } from "zustand";
import type { Event, GameState } from "./types";

interface Banner { kind: string; text: string; at: number; }
interface State {
  connection: string;
  gameState: GameState | null;
  banners: Banner[];
  setConnection: (s: string) => void;
  applyEvent: (e: Event) => void;
  reset: () => void;
}
const BANNER_CAP = 5;

export const useStore = create<State>((set) => ({
  connection: "disconnected",
  gameState: null,
  banners: [],
  setConnection: (s) => set({ connection: s }),
  reset: () => set({ connection: "disconnected", gameState: null, banners: [] }),
  applyEvent: (e) =>
    set((st) => {
      if (e.type === "game_state") return { gameState: e.state };
      if (e.type === "connection_state") return { connection: e.state };
      if (e.type === "bust") return push(st, "bust", `BUST — ${e.player}`);
      if (e.type === "leg_won") return push(st, "leg_won", `Leg to ${e.player}`);
      if (e.type === "game_won") return push(st, "game_won", `🏆 ${e.player} wins`);
      return {};
    }),
}));

function push(st: State, kind: string, text: string) {
  const banners = [...st.banners, { kind, text, at: Date.now() }].slice(-BANNER_CAP);
  return { banners };
}
```

- [ ] **Step 3: Run** `npm test -- store` → pass.

---

## Task 4: Socket hook (`ui/src/useGranbridgeSocket.ts`)

- [ ] **Step 1: Failing test** `ui/src/useGranbridgeSocket.test.ts`
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGranbridgeSocket } from "./useGranbridgeSocket";
import { useStore } from "./store";

class MockWS {
  static last: MockWS;
  onopen: any; onclose: any; onmessage: any; sent: string[] = []; readyState = 1;
  constructor(public url: string) { MockWS.last = this; }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
}

beforeEach(() => { (globalThis as any).WebSocket = MockWS as any; useStore.getState().reset(); });

describe("useGranbridgeSocket", () => {
  it("updates store on game_state message and sends commands", () => {
    const { result } = renderHook(() => useGranbridgeSocket("ws://x"));
    act(() => { MockWS.last.onopen?.(); });
    expect(useStore.getState().connection).toBe("connected");
    act(() => { MockWS.last.onmessage?.({ data: JSON.stringify({ type:"game_state", state:{ mode:"x01", mode_view:{} } }) }); });
    expect(useStore.getState().gameState?.mode).toBe("x01");
    act(() => { result.current.send({ command: "next_player" }); });
    expect(JSON.parse(MockWS.last.sent[0]).command).toBe("next_player");
  });
});
```

- [ ] **Step 2: Implement** `ui/src/useGranbridgeSocket.ts`
```ts
import { useEffect, useRef, useCallback } from "react";
import { useStore } from "./store";
import type { Command, Event } from "./types";

export function useGranbridgeSocket(url = `ws://127.0.0.1:8787`) {
  const ws = useRef<WebSocket | null>(null);
  const apply = useStore((s) => s.applyEvent);
  const setConnection = useStore((s) => s.setConnection);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => setConnection("connected");
      sock.onmessage = (m: MessageEvent) => {
        try { apply(JSON.parse(m.data) as Event); } catch { /* ignore malformed */ }
      };
      sock.onclose = () => {
        setConnection("disconnected");
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [url, apply, setConnection]);

  const send = useCallback((cmd: Command) => {
    if (ws.current && ws.current.readyState === 1) ws.current.send(JSON.stringify(cmd));
  }, []);

  return { send };
}
```

- [ ] **Step 3: Run** `npm test -- useGranbridgeSocket` → pass.

---

## Tasks 5a–5d: Mode boards (PARALLEL-SAFE)

Each board is a pure component: `props { state: GameState }`, reads `state.mode_view`. Build the four in parallel; each has its own file + test. Follow the X01 reference (5a) for structure/Tailwind.

### Task 5a: X01Board (reference)
**Files:** `ui/src/components/boards/X01Board.tsx`, `ui/src/components/boards/X01Board.test.tsx`.

- [ ] **Step 1: Failing test**
```tsx
import { render, screen } from "@testing-library/react";
import { X01Board } from "./X01Board";
const state: any = { players:[{id:"p1",name:"Ann"},{id:"p2",name:"Bo"}], active_index:0,
  mode_view:{ scores:{p1:441,p2:501}, checkout:["T20","D20"] } };
it("shows scores and checkout and active highlight", () => {
  render(<X01Board state={state} />);
  expect(screen.getByText("441")).toBeInTheDocument();
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText(/T20/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement** `ui/src/components/boards/X01Board.tsx`
```tsx
import type { GameState } from "../../types";
export function X01Board({ state }: { state: GameState }) {
  const scores = (state.mode_view?.scores ?? {}) as Record<string, number>;
  const checkout = state.mode_view?.checkout as string[] | null;
  return (
    <div>
      <div className="flex gap-6 justify-center flex-wrap">
        {state.players.map((p, i) => (
          <div key={p.id} className={`rounded-2xl px-8 py-6 bg-neutral-800/70 min-w-[180px] text-center ${i===state.active_index?"ring-4 ring-amber-400":""}`}>
            <div className="text-2xl text-neutral-300">{p.name}</div>
            <div className="text-7xl font-extrabold text-white tabular-nums">{scores[p.id]}</div>
          </div>
        ))}
      </div>
      {checkout && <div className="mt-6 text-center text-3xl text-amber-300">OUT: {checkout.join("  ")}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Run** `npm test -- X01Board` → pass.

### Task 5b: CricketBoard
**Files:** `ui/src/components/boards/CricketBoard.tsx` + test.
Renders a grid: rows = numbers `["20","19","18","17","16","15","B"]`, columns = players, cell = marks (0–3, render as `/ X ⊗` or `n marks`), plus a points row. Active player highlighted. Reads `state.mode_view.marks` and `state.mode_view.points`.
- [ ] Test asserts: a player's points value shows, and a closed number (3 marks) is visibly marked.
- [ ] Implement following the X01 pattern; run `npm test -- CricketBoard` → pass.

### Task 5c: AtcBoard
**Files:** `ui/src/components/boards/AtcBoard.tsx` + test.
Shows each player's current `state.mode_view.target` (1–20 then "BULL" for stage 21). Test asserts the target value renders. Implement; `npm test -- AtcBoard` → pass.

### Task 5d: FreePlayBoard
**Files:** `ui/src/components/boards/FreePlayBoard.tsx` + test.
Shows each player's `state.mode_view.total` and top hit beds from `state.mode_view.hits`. Test asserts total renders. Implement; `npm test -- FreePlayBoard` → pass.

---

## Task 6: Controls, Banners, ConnectionBadge (PARALLEL-SAFE with Task 5)

**Files:** `ui/src/components/Controls.tsx` (+test), `ui/src/components/Banners.tsx`, `ui/src/components/ConnectionBadge.tsx`.

- [ ] **Controls** — props `{ send: (c: Command) => void }`; buttons: Next, Miss, Undo, End, and a "Correct last" input (bed text → `correct_last`). Test: clicking "Next" calls `send({command:"next_player"})`; entering "T20" + Correct calls `send({command:"correct_last",bed:"T20"})`.
```tsx
import { useState } from "react";
import type { Command } from "../types";
export function Controls({ send }: { send: (c: Command) => void }) {
  const [bed, setBed] = useState("");
  const btn = "rounded-xl px-5 py-3 text-lg font-semibold bg-neutral-700 hover:bg-neutral-600 text-white";
  return (
    <div className="flex gap-3 items-center flex-wrap justify-center">
      <button className={btn} onClick={() => send({ command: "next_player" })}>Next</button>
      <button className={btn} onClick={() => send({ command: "record_miss" })}>Miss</button>
      <button className={btn} onClick={() => send({ command: "undo" })}>Undo</button>
      <button className={btn} onClick={() => send({ command: "end_game" })}>End</button>
      <input aria-label="bed" className="rounded-xl px-3 py-3 text-black w-24" value={bed} onChange={(e)=>setBed(e.target.value)} placeholder="T20" />
      <button className={btn} onClick={() => { if (bed) send({ command: "correct_last", bed: bed.toUpperCase() }); }}>Correct</button>
    </div>
  );
}
```
- [ ] **Banners** — props `{ banners: {kind:string;text:string;at:number}[] }`; render the latest banner large/centered (CSS only). No test required (pure render); a trivial render test is fine.
- [ ] **ConnectionBadge** — props `{ connection: string }`; colored dot + label. Trivial render test.
- [ ] Run `npm test -- Controls` → pass.

---

## Task 7: Setup view (`ui/src/views/Setup.tsx`)

**Files:** `ui/src/views/Setup.tsx` + `Setup.test.tsx`.

- [ ] **Step 1: Failing test**
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Setup } from "./Setup";
it("submits a start_game command", () => {
  const send = vi.fn();
  render(<Setup send={send} />);
  fireEvent.change(screen.getByLabelText("players"), { target: { value: "Ann, Bo" } });
  fireEvent.click(screen.getByText("Start Game"));
  const cmd = send.mock.calls[0][0];
  expect(cmd.command).toBe("start_game");
  expect(cmd.players).toEqual(["Ann", "Bo"]);
  expect(cmd.mode).toBe("x01");
});
```

- [ ] **Step 2: Implement** `ui/src/views/Setup.tsx` — a form: mode `<select>` (x01/cricket/around_the_clock/free_play), players text input (comma-separated), X01 options (start_score select 301/501/701, double_out checkbox, best_of_legs number); on submit builds `{command:"start_game",mode,players,options}` and calls `send`. Default mode "x01", default players parse trims empties.

- [ ] **Step 3: Run** `npm test -- Setup` → pass.

---

## Task 8: App shell wiring (`ui/src/App.tsx`, `ui/src/views/LiveGame.tsx`)

**Files:** modify `ui/src/App.tsx`; create `ui/src/views/LiveGame.tsx`.

- [ ] **LiveGame** — props `{ state: GameState }`; dispatch on `state.mode` to the right board; render the active player's name; below it nothing else (Controls/Banners live in App).
- [ ] **App** — calls `useGranbridgeSocket()`, selects `connection`, `gameState`, `banners`; renders `<ConnectionBadge>`, `<Banners>`, and either `<Setup send={send}>` (when no in-progress game) or `<LiveGame state={gameState}>` + `<Controls send={send}>`. Honor `?kiosk=1` to hide the badge/header.
- [ ] **Step: build check** — `npm run build` succeeds (tsc + vite). Run `npm test` → all pass.

```tsx
// App.tsx skeleton
import { useGranbridgeSocket } from "./useGranbridgeSocket";
import { useStore } from "./store";
import { Setup } from "./views/Setup";
import { LiveGame } from "./views/LiveGame";
import { Controls } from "./components/Controls";
import { Banners } from "./components/Banners";
import { ConnectionBadge } from "./components/ConnectionBadge";
export default function App() {
  const { send } = useGranbridgeSocket();
  const connection = useStore((s) => s.connection);
  const gameState = useStore((s) => s.gameState);
  const banners = useStore((s) => s.banners);
  const playing = gameState && gameState.status === "in_progress";
  const kiosk = new URLSearchParams(location.search).has("kiosk");
  return (
    <div className="min-h-full bg-neutral-950 text-white p-6">
      {!kiosk && <header className="flex justify-between items-center mb-8"><h1 className="text-3xl font-black tracking-tight">GRANBRIDGE</h1><ConnectionBadge connection={connection} /></header>}
      <Banners banners={banners} />
      {playing ? (<><LiveGame state={gameState!} /><div className="mt-10"><Controls send={send} /></div></>) : (<Setup send={send} />)}
    </div>
  );
}
```

---

## Task 9: Tauri scaffold (flagged — needs Rust)

**Files:** `ui/src-tauri/tauri.conf.json`, `ui/src-tauri/Cargo.toml`, `ui/src-tauri/src/main.rs`, `ui/src-tauri/build.rs`.
Provide a minimal Tauri v2 config pointing `frontendDist` to `../dist`, `devUrl` to the Vite dev server, app identifier `com.granbridge.app`, a window 1280×800 resizable, and a stock `main.rs` (`tauri::Builder::default().run(...)`). Add a note at top of `tauri.conf.json`'s sibling `README` line: building requires Rust (`cargo`/`rustup`) which is not installed in the current environment; `npm run build` + `cargo tauri build` later.
- [ ] No test (not compiled here). Just create the files. Confirm `npm run build` (web) still succeeds.

---

## Task 10: Docs

- [ ] Add a "Desktop UI" section to the root `README.md`: `cd ui && npm install && npm run dev` opens the app; it connects to `ws://127.0.0.1:8787` (run `granbridge serve` first). `?kiosk=1` for fullscreen/OBS. Native app: `cargo tauri build` once Rust is installed.

---

## Self-Review
- **Spec coverage:** scaffold/build (T1), connect+status+reconnect (T4), Setup→start_game (T7), live boards per mode (T5a–d), controls→commands (T6), transition banners (T6/store T3), tests (each task), Tauri scaffold (T9), README (T10). All success criteria mapped.
- **Placeholders:** foundation (T1–4), X01 board (5a), Controls (6), App (8) have full code; 5b–5d/Setup/LiveGame are specified by precise props + test expectations following the 5a pattern (acceptable: deterministic contracts, capable implementer). 
- **Type consistency:** `Event`/`Command`/`GameState` from `types.ts` used consistently; store `applyEvent`/`setConnection`/`reset`, hook `send`, board prop `{state}`, Controls/Setup prop `{send}` consistent across tasks.
- **Parallelism:** T5a–d + T6 are disjoint component files after T1–4; T7/T8 depend on them (serial).
