/**
 * MpControls — mute mic, toggle camera, leave room.
 * Reflects and persists state via the multiplayer store.
 */
import { useMpStore } from "../multiplayer/store";

interface MpControlsProps {
  onLeave: () => void;
}

export function MpControls({ onLeave }: MpControlsProps) {
  const mic = useMpStore((s) => s.mic);
  const cam = useMpStore((s) => s.cam);
  const setMic = useMpStore((s) => s.setMic);
  const setCam = useMpStore((s) => s.setCam);

  return (
    <div className="flex items-center gap-3 mt-4">
      <button
        onClick={() => setMic(!mic)}
        aria-pressed={mic}
        title={mic ? "Mute mic" : "Unmute mic"}
        className={[
          "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
          mic
            ? "bg-neutral-700 text-white hover:bg-neutral-600"
            : "bg-red-700 text-white hover:bg-red-600",
        ].join(" ")}
      >
        {mic ? "🎤 Mic on" : "🎤 Muted"}
      </button>

      <button
        onClick={() => setCam(!cam)}
        aria-pressed={cam}
        title={cam ? "Turn camera off" : "Turn camera on"}
        className={[
          "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
          cam
            ? "bg-neutral-700 text-white hover:bg-neutral-600"
            : "bg-red-700 text-white hover:bg-red-600",
        ].join(" ")}
      >
        {cam ? "📷 Cam on" : "📷 Cam off"}
      </button>

      <button
        onClick={onLeave}
        className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-800 text-white hover:bg-red-700 transition-colors"
      >
        Leave room
      </button>
    </div>
  );
}
