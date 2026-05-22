import { useState, useCallback, useId } from "react";

const STORAGE_KEY = "granbridge.video";

interface VideoSettings {
  enabled: boolean;
  reducedMotion: boolean;
}

function readSettings(): VideoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VideoSettings>;
      return {
        enabled:      parsed.enabled      !== false,
        reducedMotion: parsed.reducedMotion === true,
      };
    }
  } catch {
    // ignore parse errors
  }
  return { enabled: true, reducedMotion: false };
}

function writeSettings(s: VideoSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore write errors (private browsing quota, etc.)
  }
}

/**
 * Small header control: toggle checkout videos on/off and a reduced-motion
 * checkbox. Persists to `localStorage` under the key `granbridge.video`.
 */
export function VideoToggle() {
  const [settings, setSettings] = useState<VideoSettings>(readSettings);
  const reducedMotionId = useId();

  const toggleEnabled = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      writeSettings(next);
      return next;
    });
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, reducedMotion: !prev.reducedMotion };
      writeSettings(next);
      return next;
    });
  }, []);

  return (
    <div className="flex items-center gap-3" aria-label="Video controls">
      <button
        type="button"
        onClick={toggleEnabled}
        aria-pressed={settings.enabled}
        aria-label={settings.enabled ? "Disable checkout videos" : "Enable checkout videos"}
        className="text-neutral-300 hover:text-white transition-colors text-lg leading-none select-none"
        title={settings.enabled ? "Disable videos" : "Enable videos"}
      >
        {settings.enabled ? "🎬" : "🚫"}
      </button>

      {settings.enabled && (
        <label
          htmlFor={reducedMotionId}
          className="flex items-center gap-1 text-xs text-neutral-400 cursor-pointer select-none"
        >
          <input
            id={reducedMotionId}
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={toggleReducedMotion}
            className="accent-amber-400"
            aria-label="Reduced motion"
          />
          <span>Reduced motion</span>
        </label>
      )}
    </div>
  );
}
