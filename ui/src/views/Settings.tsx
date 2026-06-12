/**
 * Settings view — camera/mic device pickers (with live camera test), broker URL,
 * local-data management, and app/update info.
 *
 * Device labels are empty until the user has granted camera/mic permission at
 * least once (browser privacy rule); the "Test camera" preview doubles as the
 * permission grant, after which Refresh fills in real labels.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMpStore, DEFAULT_BROKER_URL } from "../multiplayer/store";
import {
  acquireLocalMedia,
  buildConstraints,
  listAudioInputs,
  listVideoInputs,
} from "../multiplayer/media";
import { VideoTile } from "../components/VideoTile";
import { apiBase } from "../apiBase";
import { isTauri } from "../useUpdater";

/** A broker URL must be a WebSocket origin. */
export function isValidBrokerUrl(url: string): boolean {
  const t = url.trim().toLowerCase();
  return t.startsWith("ws://") || t.startsWith("wss://");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-neutral-900 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}

export function Settings() {
  const camDeviceId = useMpStore((s) => s.camDeviceId);
  const micDeviceId = useMpStore((s) => s.micDeviceId);
  const brokerUrl = useMpStore((s) => s.brokerUrl);

  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [brokerInput, setBrokerInput] = useState(brokerUrl);
  const [brokerSaved, setBrokerSaved] = useState(false);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "done" | "error">("idle");
  const [clearedCount, setClearedCount] = useState(0);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const previewRef = useRef<MediaStream | null>(null);

  const refreshDevices = useCallback(async () => {
    setCams(await listVideoInputs());
    setMics(await listAudioInputs());
  }, []);

  useEffect(() => {
    void refreshDevices();
    return () => {
      previewRef.current?.getTracks().forEach((t) => t.stop());
      previewRef.current = null;
    };
  }, [refreshDevices]);

  const stopPreview = useCallback(() => {
    previewRef.current?.getTracks().forEach((t) => t.stop());
    previewRef.current = null;
    setPreviewStream(null);
  }, []);

  const startPreview = useCallback(async () => {
    stopPreview();
    setPreviewError(null);
    const { stream, failure } = await acquireLocalMedia(
      buildConstraints(true, false, useMpStore.getState().camDeviceId, null),
    );
    if (stream) {
      previewRef.current = stream;
      setPreviewStream(stream);
      // Permission was just granted → labels become readable.
      void refreshDevices();
    } else {
      setPreviewError(
        failure === "denied"
          ? "Camera permission denied — check Windows privacy settings."
          : "Couldn't start the camera.",
      );
    }
  }, [stopPreview, refreshDevices]);

  const saveBroker = useCallback(() => {
    if (!isValidBrokerUrl(brokerInput)) return;
    useMpStore.getState().setBrokerUrl(brokerInput.trim());
    setBrokerSaved(true);
    setTimeout(() => setBrokerSaved(false), 2000);
  }, [brokerInput]);

  const resetBroker = useCallback(() => {
    setBrokerInput(DEFAULT_BROKER_URL);
    useMpStore.getState().setBrokerUrl(DEFAULT_BROKER_URL);
  }, []);

  const clearHistory = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase()}/api/history/clear`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { cleared_games?: number };
      setClearedCount(data.cleared_games ?? 0);
      setClearState("done");
    } catch {
      setClearState("error");
    }
  }, []);

  const checkUpdates = useCallback(async () => {
    if (!isTauri()) {
      setUpdateMsg("Update checks run in the installed app.");
      return;
    }
    setUpdateMsg("Checking…");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      setUpdateMsg(update ? `Update ${update.version} available — see the banner above.` : "You're up to date.");
    } catch (e) {
      setUpdateMsg(`Update check failed: ${String(e)}`);
    }
  }, []);

  const brokerValid = isValidBrokerUrl(brokerInput);
  const selectCls = "mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      <Section title="Camera & microphone">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-neutral-300">Camera</span>
            <select
              aria-label="Camera device"
              className={selectCls}
              value={camDeviceId ?? ""}
              onChange={(e) => useMpStore.getState().setCamDeviceId(e.target.value || null)}
            >
              <option value="">Default camera</option>
              {cams.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-neutral-300">Microphone</span>
            <select
              aria-label="Microphone device"
              className={selectCls}
              value={micDeviceId ?? ""}
              onChange={(e) => useMpStore.getState().setMicDeviceId(e.target.value || null)}
            >
              <option value="">Default microphone</option>
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3">
          {previewStream ? (
            <button
              onClick={stopPreview}
              className="px-4 py-2 rounded-lg bg-neutral-700 text-sm font-semibold hover:bg-neutral-600"
            >
              Stop test
            </button>
          ) : (
            <button
              onClick={() => void startPreview()}
              className="px-4 py-2 rounded-lg bg-amber-400 text-neutral-900 text-sm font-bold hover:bg-amber-300"
            >
              Test camera
            </button>
          )}
          <button
            onClick={() => void refreshDevices()}
            className="px-4 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Refresh devices
          </button>
        </div>
        {previewError && (
          <p role="alert" className="text-sm text-red-300">{previewError}</p>
        )}
        {previewStream && (
          <div className="w-64">
            <VideoTile stream={previewStream} label="Camera test" muted />
          </div>
        )}
        <p className="text-xs text-neutral-500">
          Device names appear after you've granted camera access once (use Test camera).
          Changes apply the next time you join a multiplayer room.
        </p>
      </Section>

      <Section title="Multiplayer server">
        <label className="block">
          <span className="text-sm text-neutral-300">Broker URL</span>
          <input
            type="text"
            value={brokerInput}
            onChange={(e) => setBrokerInput(e.target.value)}
            aria-label="Broker URL"
            className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
        {!brokerValid && (
          <p role="alert" className="text-sm text-red-300">
            Must start with ws:// or wss://
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={saveBroker}
            disabled={!brokerValid}
            className="px-4 py-2 rounded-lg bg-amber-400 text-neutral-900 text-sm font-bold hover:bg-amber-300 disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={resetBroker}
            className="px-4 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Reset to default
          </button>
          {brokerSaved && <span role="status" className="text-sm text-emerald-300">Saved ✓</span>}
        </div>
      </Section>

      <Section title="Local data">
        {clearState === "confirm" ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-red-300">Delete all local match history? This can't be undone.</span>
            <button
              onClick={() => void clearHistory()}
              className="px-4 py-2 rounded-lg bg-red-600 text-sm font-bold hover:bg-red-500"
            >
              Yes, delete
            </button>
            <button
              onClick={() => setClearState("idle")}
              className="px-4 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-300 hover:bg-neutral-700"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setClearState("confirm")}
              className="px-4 py-2 rounded-lg bg-neutral-800 text-sm text-red-300 hover:bg-neutral-700"
            >
              Clear match history…
            </button>
            {clearState === "done" && (
              <span role="status" className="text-sm text-emerald-300">
                Cleared {clearedCount} game{clearedCount === 1 ? "" : "s"} ✓
              </span>
            )}
            {clearState === "error" && (
              <span role="alert" className="text-sm text-red-300">
                Couldn't reach the bridge — is it running?
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-neutral-500">
          Match history is stored locally on this PC. Server-side career stats (Profile tab) are not affected.
        </p>
      </Section>

      <Section title="Updates">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void checkUpdates()}
            className="px-4 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Check for updates
          </button>
          {updateMsg && <span role="status" className="text-sm text-neutral-300">{updateMsg}</span>}
        </div>
      </Section>
    </div>
  );
}
