import { useEffect, useState } from "react";
import { getOrCreatePlayer, setPlayerName, setPlayerColor } from "../multiplayer/player";
import { AVATAR_PALETTE, defaultAvatarColor } from "../multiplayer/avatar";
import { Avatar } from "../components/Avatar";
import { fetchMyCareerSummary, type CareerSummary } from "../multiplayer/careerSummary";
import { fetchPlayerSummary, toCareerSummary } from "../stats/statsClient";

export function Profile() {
  const [profile, setProfile] = useState(() => getOrCreatePlayer());
  const [summary, setSummary] = useState<CareerSummary | null>(null);
  const [statsSource, setStatsSource] = useState<"server" | "local">("local");
  const [copied, setCopied] = useState(false);

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

  const copyId = async () => {
    try {
      await navigator.clipboard?.writeText(profile.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-md mx-auto mt-8 space-y-6">
      <h2 className="text-2xl font-bold">Profile</h2>

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

      <div>
        <h3 className="text-sm text-neutral-300 mb-2">
          Career stats{" "}
          <span className="text-neutral-500">{statsSource === "server" ? "(across devices)" : "(this device)"}</span>
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="3-Dart Avg" value={summary ? summary.threeDartAvg.toFixed(1) : "…"} />
          <Stat label="Wins" value={summary ? String(summary.wins) : "…"} />
          <Stat label="Games" value={summary ? String(summary.gamesPlayed) : "…"} />
        </div>
        <p className="text-neutral-600 text-xs mt-2">
          {statsSource === "server"
            ? "Synced from the stats server, keyed by your player ID."
            : "Server unreachable — showing local stats (keyed by display name)."}
        </p>
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
