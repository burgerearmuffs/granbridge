import { useState, useCallback } from "react";
import { soundManager } from "../sound/SoundManager";

/**
 * A mute/unmute button + volume slider that reads from and writes to the
 * global soundManager singleton.  Changes are persisted to localStorage
 * automatically by the manager.
 */
export function SoundToggle() {
  const [enabled, setEnabledState] = useState(() => soundManager.getEnabled());
  const [volume, setVolumeState] = useState(() => soundManager.getVolume());

  const toggleEnabled = useCallback(() => {
    const next = !soundManager.getEnabled();
    soundManager.setEnabled(next);
    setEnabledState(next);
  }, []);

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    soundManager.setVolume(val);
    setVolumeState(val);
  }, []);

  return (
    <div className="flex items-center gap-3" aria-label="Sound controls">
      <button
        type="button"
        onClick={toggleEnabled}
        aria-pressed={enabled}
        aria-label={enabled ? "Mute sounds" : "Unmute sounds"}
        className="text-neutral-300 hover:text-white transition-colors text-lg leading-none select-none"
        title={enabled ? "Mute" : "Unmute"}
      >
        {enabled ? "🔊" : "🔇"}
      </button>

      {enabled && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={handleVolume}
          aria-label="Volume"
          className="w-20 accent-amber-400"
        />
      )}
    </div>
  );
}
