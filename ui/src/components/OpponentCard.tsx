/** OpponentCard — opponent's avatar, name, and career summary (received over the data channel). */
import { Avatar } from "./Avatar";
import type { Profile } from "../multiplayer/player";
import type { CareerSummary } from "../multiplayer/careerSummary";

interface OpponentCardProps {
  profile: Profile;
  summary: CareerSummary;
}

export function OpponentCard({ profile, summary }: OpponentCardProps) {
  return (
    <div className="flex items-center gap-4 bg-neutral-900 rounded-lg px-4 py-3">
      <Avatar name={profile.name} color={profile.avatar.color} size={48} />
      <div className="flex-1">
        <div className="font-semibold">{profile.name}</div>
        <div className="text-xs text-neutral-400">opponent</div>
      </div>
      <div className="flex gap-4 text-center">
        <Stat label="Avg" value={summary.threeDartAvg.toFixed(1)} />
        <Stat label="Wins" value={String(summary.wins)} />
        <Stat label="Games" value={String(summary.gamesPlayed)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold text-amber-300 tabular-nums">{value}</div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
