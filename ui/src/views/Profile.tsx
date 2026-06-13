import { useEffect, useState } from "react";
import { getOrCreatePlayer, setPlayerName, setPlayerColor, applyRecoveryKey } from "../multiplayer/player";
import { AVATAR_PALETTE, defaultAvatarColor } from "../multiplayer/avatar";
import { Avatar } from "../components/Avatar";
import { fetchMyCareerSummary, type CareerSummary } from "../multiplayer/careerSummary";
import { fetchPlayerSummary, toCareerSummary } from "../stats/statsClient";
import { exportRecoveryKey } from "../multiplayer/recoveryKey";
import { getUploadEnabled, setUploadEnabled } from "../stats/uploadPref";
import { PageHeader } from "../components/Page";
import { isKeyBackedUp, markKeyBackedUp } from "../components/Onboarding";

export function Profile() {
  const [profile, setProfile] = useState(() => getOrCreatePlayer());
  const [summary, setSummary] = useState<CareerSummary | null>(null);
  const [statsSource, setStatsSource] = useState<"server" | "local">("local");
  const [copied, setCopied] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [upload, setUpload] = useState(() => getUploadEnabled());
  const [keyBackedUp, setKeyBackedUp] = useState(() => isKeyBackedUp());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchPlayerSummary(profile.id);
        if (!cancelled) { setSummary(toCareerSummary(s)); setStatsSource("server"); }
      } catch {
        const local = await fetchMyCareerSummary(profile.name);
        if (!cancelled) { setSummary(local); setStatsSource("local"); }
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id, profile.name]);

  const exportKey = async () => {
    const key = exportRecoveryKey(profile);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(key);
      markKeyBackedUp();
      setKeyBackedUp(true);
      setKeyCopied(true);
      setKeyError(null);
      setTimeout(() => setKeyCopied(false), 1500);
    } catch {
      setKeyError("Clipboard unavailable — copy your key manually: " + key);
    }
  };
  const restoreKey = () => {
    try {
      setProfile(applyRecoveryKey(keyInput.trim()));
      setKeyError(null);
      setKeyInput("");
    } catch {
      setKeyError("That doesn't look like a valid recovery key.");
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard?.writeText(profile.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-md mx-auto mt-8 space-y-6">
      <PageHeader title="Profile" />

      {!keyBackedUp && (
        <div role="status" className="bg-amber-900/40 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-200">
          <strong>Back up your recovery key.</strong> It's the only way to keep your server career
          stats if you reinstall or switch PCs.{" "}
          <button onClick={exportKey} className="underline font-semibold" aria-label="Back up recovery key now">
            Copy it now
          </button>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Avatar name={profile.name} color={profile.avatar.color} size={72} />
        <p className="text-neutral-400 text-sm">This is how opponents see you in matches.</p>
      </div>

      <label className="block">
        <span className="text-sm text-neutral-300">Display name</span>
        <input
          type="text"
          value={profile.name}
          onChange={(e) => setProfile(setPlayerName(e.target.value))}
          aria-label="Display name"
          className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </label>

      <div>
        <span className="text-sm text-neutral-300">Avatar color</span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {AVATAR_PALETTE.map((c) => (
            <button
              key={c}
              aria-label={`Color ${c}`}
              onClick={() => setProfile(setPlayerColor(c))}
              style={{ backgroundColor: c }}
              className={`w-8 h-8 rounded-full border-2 ${profile.avatar.color === c ? "border-white" : "border-transparent"}`}
            />
          ))}
          <button
            aria-label="Reset avatar color to default"
            onClick={() => setProfile(setPlayerColor(defaultAvatarColor(profile.id)))}
            className="text-xs text-neutral-400 underline ml-2"
          >
            Reset
          </button>
        </div>
      </div>

      <div>
        <span className="text-sm text-neutral-300">Player ID</span>
        <div className="mt-1 flex items-center gap-2">
          <code className="text-xs text-neutral-400 bg-neutral-800 rounded px-2 py-1 truncate max-w-[16rem]">{profile.id}</code>
          <button onClick={copyId} aria-label="Copy player ID" className="text-xs text-amber-300 underline">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="border-t border-neutral-800 pt-4">
        <h3 className="text-sm text-neutral-300 mb-1">Recovery key</h3>
        <p className="text-neutral-600 text-xs mb-2">
          Back this up to restore your stats on another device. Restoring replaces this device's identity.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={exportKey} aria-label="Export recovery key" className="text-xs text-amber-300 underline">
            {keyCopied ? "Copied" : "Export recovery key"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            aria-label="Recovery key"
            placeholder="Paste a recovery key"
            className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button onClick={restoreKey} aria-label="Restore" className="text-xs text-amber-300 underline">Restore</button>
        </div>
        {keyError && <p role="alert" className="text-red-300 text-xs mt-1">{keyError}</p>}
      </div>

      <div className="border-t border-neutral-800 pt-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={upload}
            onChange={(e) => { setUploadEnabled(e.target.checked); setUpload(e.target.checked); }}
            aria-label="Upload my stats to the server"
            className="accent-amber-400 w-4 h-4"
          />
          <span className="text-sm text-neutral-300">Upload my stats to the server</span>
        </label>
        <p className="text-neutral-600 text-xs mt-1">When off, finished games stay on this device only.</p>
      </div>

      <div>
        <h3 className="text-sm text-neutral-300 mb-2">
          Career stats{" "}
          {summary && (
            <span className="text-neutral-500">{statsSource === "server" ? "(across devices)" : "(this device)"}</span>
          )}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="3-Dart Avg" value={summary ? summary.threeDartAvg.toFixed(1) : "…"} />
          <Stat label="Wins" value={summary ? String(summary.wins) : "…"} />
          <Stat label="Games" value={summary ? String(summary.gamesPlayed) : "…"} />
        </div>
        {summary && (
          <p className="text-neutral-600 text-xs mt-2">
            {statsSource === "server"
              ? "Synced from the stats server, keyed by your player ID."
              : "Server unreachable — showing local stats (keyed by display name)."}
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-800 rounded-lg px-3 py-3 text-center">
      <div className="text-2xl font-bold text-amber-300 tabular-nums">{value}</div>
      <div className="text-xs text-neutral-400">{label}</div>
    </div>
  );
}
