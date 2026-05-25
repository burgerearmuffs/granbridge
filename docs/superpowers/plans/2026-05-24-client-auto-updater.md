# Client Auto-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GRANBRIDGE desktop client checks GitHub on launch for a newer release and offers a one-click "download + install + relaunch", using the official Tauri v2 updater.

**Architecture:** Frontend `useUpdater` hook calls the Tauri updater plugin's `check()` on mount; if a newer version exists, an `UpdateBanner` offers a one-click `downloadAndInstall()` of the signed NSIS setup followed by `relaunch()`. GitHub Releases hosts a `latest.json` manifest that is the version oracle. Updates are minisign-verified by the plugin.

**Tech Stack:** Tauri v2 (`tauri-plugin-updater`, `tauri-plugin-process`), React 18 + TypeScript, Vitest + Testing Library, Rust/cargo.

**Repo facts:** root = `granbridge`; client lives under `ui/` (Vite/React) + `ui/src-tauri/` (Tauri/Rust). App version source of truth = `ui/src-tauri/tauri.conf.json` `version` (currently `0.1.1`). GitHub repo = `burgerearmuffs/granbridge`. cargo may need `export PATH="$HOME/.cargo/bin:$PATH"`; heavy native builds may require the Bash sandbox disabled.

---

### Task 1: Add frontend updater dependencies

**Files:**
- Modify: `ui/package.json` (dependencies)

- [ ] **Step 1: Install the Tauri updater + process + api packages**

Run (from repo root `granbridge`):
```bash
npm --prefix ui install @tauri-apps/plugin-updater@^2 @tauri-apps/plugin-process@^2 @tauri-apps/api@^2
```
Expected: packages added under `dependencies` in `ui/package.json`; `ui/package-lock.json` updated; exit 0.

- [ ] **Step 2: Verify they resolve**

Run:
```bash
npm --prefix ui ls @tauri-apps/plugin-updater @tauri-apps/plugin-process @tauri-apps/api
```
Expected: each prints an installed `@^2.x` version, no "missing".

- [ ] **Step 3: Commit**

```bash
git add ui/package.json ui/package-lock.json
git commit -m "build(ui): add Tauri updater/process/api deps for auto-updater"
```

---

### Task 2: `useUpdater` hook (TDD)

**Files:**
- Create: `ui/src/useUpdater.ts`
- Test: `ui/src/useUpdater.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/useUpdater.test.tsx`:
```tsx
import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdater } from "./useUpdater";

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("useUpdater", () => {
  it("surfaces an available update", async () => {
    (check as Mock).mockResolvedValue({
      version: "0.1.2",
      body: "Bug fixes",
      downloadAndInstall: vi.fn(),
    });
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    expect(result.current.version).toBe("0.1.2");
    expect(result.current.notes).toBe("Bug fixes");
  });

  it("stays idle when there is no update", async () => {
    (check as Mock).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(result.current.phase).toBe("idle");
  });

  it("downloads then relaunches on startUpdate", async () => {
    const downloadAndInstall = vi.fn(async (cb: (e: unknown) => void) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Finished" });
    });
    (check as Mock).mockResolvedValue({ version: "0.1.2", body: null, downloadAndInstall });
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.startUpdate());
    await waitFor(() => expect(relaunch).toHaveBeenCalled());
    expect(downloadAndInstall).toHaveBeenCalled();
    expect(result.current.progress).toBe(1);
  });

  it("fails silently when the check rejects", async () => {
    (check as Mock).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toContain("offline");
  });

  it("no-ops outside Tauri", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => {});
    expect(check).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("dismiss hides the banner state", async () => {
    (check as Mock).mockResolvedValue({ version: "0.1.2", body: null, downloadAndInstall: vi.fn() });
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("dismissed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm --prefix ui test -- useUpdater
```
Expected: FAIL — cannot resolve `./useUpdater` (module not found).

- [ ] **Step 3: Implement the hook**

Create `ui/src/useUpdater.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "dismissed";

export interface UpdaterState {
  phase: UpdatePhase;
  version: string | null;
  notes: string | null;
  progress: number; // 0..1
  error: string | null;
  startUpdate: () => void;
  dismiss: () => void;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useUpdater(): UpdaterState {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return; // StrictMode mounts effects twice in dev
    checkedRef.current = true;
    if (!isTauri()) return;
    setPhase("checking");
    check()
      .then((update) => {
        if (update) {
          updateRef.current = update;
          setVersion(update.version);
          setNotes(update.body ?? null);
          setPhase("available");
        } else {
          setPhase("idle");
        }
      })
      .catch((e) => {
        setError(String(e));
        setPhase("error");
      });
  }, []);

  const startUpdate = useCallback(() => {
    const update = updateRef.current;
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    let total = 0;
    let downloaded = 0;
    update
      .downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setProgress(total > 0 ? Math.min(downloaded / total, 1) : 0);
            break;
          case "Finished":
            setProgress(1);
            setPhase("ready");
            break;
        }
      })
      .then(() => relaunch())
      .catch((e) => {
        setError(String(e));
        setPhase("error");
      });
  }, []);

  const dismiss = useCallback(() => setPhase("dismissed"), []);

  return { phase, version, notes, progress, error, startUpdate, dismiss };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm --prefix ui test -- useUpdater
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/useUpdater.ts ui/src/useUpdater.test.tsx
git commit -m "feat(ui): useUpdater hook — launch check + one-click install via Tauri updater"
```

---

### Task 3: `UpdateBanner` component (TDD)

**Files:**
- Create: `ui/src/components/UpdateBanner.tsx`
- Test: `ui/src/components/UpdateBanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/components/UpdateBanner.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";
import type { UpdaterState } from "../useUpdater";

function makeState(overrides: Partial<UpdaterState> = {}): UpdaterState {
  return {
    phase: "available",
    version: "0.1.2",
    notes: null,
    progress: 0,
    error: null,
    startUpdate: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

describe("UpdateBanner", () => {
  it("shows the new version and triggers startUpdate", () => {
    const startUpdate = vi.fn();
    render(<UpdateBanner state={makeState({ startUpdate })} />);
    expect(screen.getByText(/0\.1\.2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /update & restart/i }));
    expect(startUpdate).toHaveBeenCalled();
  });

  it("renders nothing when idle", () => {
    const { container } = render(<UpdateBanner state={makeState({ phase: "idle", version: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when dismissed", () => {
    const { container } = render(<UpdateBanner state={makeState({ phase: "dismissed" })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows download progress", () => {
    render(<UpdateBanner state={makeState({ phase: "downloading", progress: 0.42 })} />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it("dismiss button calls dismiss", () => {
    const dismiss = vi.fn();
    render(<UpdateBanner state={makeState({ dismiss })} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(dismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm --prefix ui test -- UpdateBanner
```
Expected: FAIL — cannot resolve `./UpdateBanner`.

- [ ] **Step 3: Implement the component**

Create `ui/src/components/UpdateBanner.tsx`:
```tsx
import type { UpdaterState } from "../useUpdater";

export function UpdateBanner({ state }: { state: UpdaterState }) {
  const { phase, version, notes, progress, startUpdate, dismiss } = state;

  // Silent for: no update, still checking, a failed background check (version null), or dismissed.
  if (phase === "dismissed" || version === null) return null;

  const downloading = phase === "downloading" || phase === "ready";
  const failed = phase === "error";

  return (
    <div className="mb-4 flex items-center gap-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <span className="font-semibold text-amber-300">Update available</span>
      <span className="text-neutral-300">
        v{version}
        {notes ? ` — ${notes}` : ""}
      </span>
      <div className="ml-auto flex items-center gap-3">
        {failed && <span className="text-red-400">Update failed — try later</span>}
        {downloading ? (
          <span className="tabular-nums text-amber-200">
            {phase === "ready" ? "Restarting…" : `Downloading ${Math.round(progress * 100)}%`}
          </span>
        ) : (
          <button
            onClick={startUpdate}
            className="rounded-full bg-amber-400 px-4 py-1.5 font-semibold text-neutral-900 hover:bg-amber-300"
          >
            Update &amp; restart
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-neutral-400 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm --prefix ui test -- UpdateBanner
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/UpdateBanner.tsx ui/src/components/UpdateBanner.test.tsx
git commit -m "feat(ui): UpdateBanner — notify + one-click update UI"
```

---

### Task 4: Wire the banner into `App.tsx`

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Add the imports**

In `ui/src/App.tsx`, add to the import block (after the existing component imports):
```tsx
import { useUpdater } from "./useUpdater";
import { UpdateBanner } from "./components/UpdateBanner";
```

- [ ] **Step 2: Instantiate the hook**

Inside `export default function App() {`, right after `const { send } = useGranbridgeSocket();`, add:
```tsx
  const updater = useUpdater();
```

- [ ] **Step 3: Render the banner under the header**

In the returned JSX, the header is wrapped in `{!kiosk && ( <header …>…</header> )}`. Immediately
**after** that `{!kiosk && (…)}` header block and **before** `<Banners …/>` (or the next element),
insert:
```tsx
      {!kiosk && <UpdateBanner state={updater} />}
```

- [ ] **Step 4: Verify the UI typechecks and builds**

Run:
```bash
npm --prefix ui run build
```
Expected: `tsc -b` passes and `vite build` succeeds (exit 0), proving the new imports/types are valid.

- [ ] **Step 5: Run the full frontend test suite (no regressions)**

Run:
```bash
npm --prefix ui test
```
Expected: all tests pass, including the new `useUpdater` + `UpdateBanner` suites.

- [ ] **Step 6: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat(ui): show update banner on launch (non-kiosk)"
```

---

### Task 5: Register the Rust plugins

**Files:**
- Modify: `ui/src-tauri/Cargo.toml`
- Modify: `ui/src-tauri/src/main.rs`

- [ ] **Step 1: Add the crates to `Cargo.toml`**

In `ui/src-tauri/Cargo.toml`, under `[dependencies]`, add after the `tauri-plugin-shell` line:
```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Register the plugins in `main.rs`**

In `ui/src-tauri/src/main.rs`, change the builder chain so it reads:
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
```
(Leave the rest of `setup`/`run` unchanged.)

- [ ] **Step 3: Verify Rust compiles**

Run:
```bash
(cd ui/src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo check)
```
Expected: `cargo check` succeeds (downloads + compiles the two new crates, exit 0).
Note: if the sandbox blocks network/MSVC, re-run with the Bash tool's sandbox disabled.

- [ ] **Step 4: Commit**

```bash
git add ui/src-tauri/Cargo.toml ui/src-tauri/Cargo.lock ui/src-tauri/src/main.rs
git commit -m "feat(app): register tauri-plugin-updater + tauri-plugin-process"
```

---

### Task 6: Updater config + capabilities

**Files:**
- Modify: `ui/src-tauri/tauri.conf.json`
- Modify: `ui/src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the updater plugin config + updater artifacts flag**

In `ui/src-tauri/tauri.conf.json`:

(a) Add a top-level `"plugins"` block (sibling of `"app"` and `"bundle"`):
```json
  "plugins": {
    "updater": {
      "pubkey": "REPLACE_WITH_MINISIGN_PUBLIC_KEY",
      "endpoints": [
        "https://github.com/burgerearmuffs/granbridge/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  },
```

(b) Inside the existing `"bundle"` object, add:
```json
    "createUpdaterArtifacts": true,
```

- [ ] **Step 2: Grant the frontend permission to call the plugins**

In `ui/src-tauri/capabilities/default.json`, add to the `"permissions"` array (after `"core:default"`):
```json
    "updater:default",
    "process:allow-restart",
```

- [ ] **Step 3: Verify the config is valid JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('ui/src-tauri/tauri.conf.json','utf8')); JSON.parse(require('fs').readFileSync('ui/src-tauri/capabilities/default.json','utf8')); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add ui/src-tauri/tauri.conf.json ui/src-tauri/capabilities/default.json
git commit -m "feat(app): updater endpoint/config + capability permissions (placeholder pubkey)"
```

---

### Task 7: Signing keypair + release pipeline docs

**Files:**
- Modify: `ui/src-tauri/tauri.conf.json` (real pubkey)
- Modify: `docs/RELEASING.md`
- Modify: `.gitignore` (ensure key files never committed)

- [ ] **Step 1: USER ACTION — generate the minisign keypair**

The user runs (one time) and safeguards the output; do NOT commit the private key:
```bash
npm --prefix ui run tauri -- signer generate -w "$HOME/.granbridge-updater.key"
```
This prints/writes a **private** key (password-protected) and a **public** key. The user provides the
public key string. (If running autonomously without the user, leave the placeholder and STOP here with
a clear note that release signing is blocked until the key exists.)

- [ ] **Step 2: Insert the real public key**

In `ui/src-tauri/tauri.conf.json`, replace `REPLACE_WITH_MINISIGN_PUBLIC_KEY` (under `plugins.updater.pubkey`)
with the public key from Step 1 (a single-line `dW...` base64 string).

- [ ] **Step 3: Guard the private key in `.gitignore`**

Append to `.gitignore`:
```
# Updater signing key (never commit)
*.key
*.key.pub
.granbridge-updater.key*
```

- [ ] **Step 4: Document signing + new release assets in `docs/RELEASING.md`**

(a) Under "Prerequisites / environment gotchas", add:
```markdown
- **Updater signing** (one time): generate a minisign keypair —
  `npm --prefix ui run tauri -- signer generate -w "$HOME/.granbridge-updater.key"`.
  The **public** key lives in `ui/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); keep the
  **private** key file and its password **off-repo** (never commit). The auto-updater refuses any
  release whose `.sig` doesn't verify against the public key.
```

(b) In step 4 ("Build the installers"), prepend the signing env vars so `tauri build` signs and emits
`latest.json` (because `createUpdaterArtifacts` is on):
```markdown
   ```
   export PATH="$HOME/.cargo/bin:$PATH"
   export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.granbridge-updater.key")"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<your key password>"
   npm --prefix ui run tauri -- build
   # → bundle/nsis/GRANBRIDGE_<ver>_x64-setup.exe (+ .sig) and a generated latest.json
   ```
```

(c) Update the "Artifacts every release includes" list and the `gh release create` command (step 9) to
add **two** assets: the NSIS `-setup.exe.sig` and `latest.json`. Add these lines to the `gh release create`
asset list:
```
     "ui\src-tauri\target\release\bundle\nsis\GRANBRIDGE_<ver>_x64-setup.exe.sig" \
     "<path-to-generated>\latest.json" \
```
And add a note: the updater fetches `latest.json` from `releases/latest/download/latest.json`, so it
must be attached to **every** release that should be offered as an update.

- [ ] **Step 5: Verify config still parses + tests still pass**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('ui/src-tauri/tauri.conf.json','utf8')); console.log('json ok')" && npm --prefix ui test
```
Expected: `json ok` and all frontend tests pass.

- [ ] **Step 6: Commit**

```bash
git add ui/src-tauri/tauri.conf.json docs/RELEASING.md .gitignore
git commit -m "docs(release): updater signing + latest.json/.sig assets; set updater pubkey"
```

---

### Task 8: End-to-end release verification (release-time, heavy)

**Files:** none (verification only)

- [ ] **Step 1: Produce a signed updater bundle**

Following the updated `docs/RELEASING.md` steps 1-5 with the signing env vars set, run a full
`npm --prefix ui run tauri -- build`. (Heavy MSVC/cargo build; may need the sandbox disabled.)
Expected: `bundle/nsis/GRANBRIDGE_<ver>_x64-setup.exe`, a matching `.exe.sig`, and a generated
`latest.json` whose `signature` field is non-empty and whose `platforms["windows-x86_64"].url` points
at the release download.

- [ ] **Step 2: Manual smoke (documented, requires two versions)**

Document in the PR description (no code): install version N, then publish a release N+1 with
`latest.json` + signed setup attached; launch the installed N build → the banner appears → "Update &
restart" downloads, installs, and relaunches into N+1. Confirm: an up-to-date build shows no banner;
launching offline shows no banner and no error dialog.

- [ ] **Step 3 (optional): tag note in `docs/BUILD-LOG.md`**

Add a one-line BUILD-LOG entry summarizing the auto-updater feature + the new release requirement
(every release must attach `latest.json` + `.sig`).

```bash
git add docs/BUILD-LOG.md
git commit -m "docs: BUILD-LOG — client auto-updater"
```

---

## Notes for the executor
- App version comparison is driven by `ui/src-tauri/tauri.conf.json` `version` vs `latest.json` `version`. Bump both `tauri.conf.json` and `pyproject.toml` per the existing release runbook.
- The updater only updates **installer-based** installs (NSIS). Portable-zip users see the banner notice but it cannot self-install — that is by design (see the spec's "Out of scope").
- If `cargo check` or `tauri build` fails for network/sandbox reasons, re-run the Bash tool with the sandbox disabled; these are environment issues, not code issues.
