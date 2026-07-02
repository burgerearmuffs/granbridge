/**
 * EntranceOverlay — walk-on moment when the local player starts a game.
 *
 * Plays the theme's video (muted) with the player's name drawn on top, and
 * fires the theme fanfare through an <audio> element at the SoundManager's
 * volume (the Start click is a user gesture, so playback is autoplay-safe).
 * Click anywhere to skip. Honors granbridge.video settings: disabled → never
 * shows; reduced motion → brief static name card, no video, no audio.
 * Missing/broken video degrades to the procedural name card.
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { soundManager } from "../sound/SoundManager";
import { ENTRANCE_THEMES, ENTRANCE_CAP_MS, ENTRANCE_REDUCED_MS } from "./themes";

function videoSettings(): { enabled: boolean; reducedMotion: boolean } {
  try {
    const raw = localStorage.getItem("granbridge.video");
    if (raw) {
      const p = JSON.parse(raw) as { enabled?: boolean; reducedMotion?: boolean };
      return { enabled: p.enabled !== false, reducedMotion: p.reducedMotion === true };
    }
  } catch { /* ignore */ }
  return { enabled: true, reducedMotion: false };
}

function playFanfare(src: string): void {
  try {
    if (typeof Audio === "undefined" || !soundManager.getEnabled()) return;
    const el = new Audio(src);
    el.volume = soundManager.getVolume();
    void el.play()?.catch?.(() => { /* missing file / autoplay veto → silent */ });
  } catch { /* never block the entrance on audio */ }
}

export function EntranceOverlay() {
  const entrance = useStore((s) => s.entrance);
  const [visible, setVisible] = useState(false);
  const [useVideo, setUseVideo] = useState(false);
  const seenAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!entrance || entrance.at <= seenAtRef.current) return;
    seenAtRef.current = entrance.at;
    const { enabled, reducedMotion } = videoSettings();
    if (!enabled) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setUseVideo(!reducedMotion);
    setVisible(true);
    if (!reducedMotion) playFanfare(ENTRANCE_THEMES[entrance.theme].sound);
    timerRef.current = setTimeout(
      () => setVisible(false),
      reducedMotion ? ENTRANCE_REDUCED_MS : ENTRANCE_CAP_MS,
    );
  }, [entrance]);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  if (!visible || !entrance) return null;
  const spec = ENTRANCE_THEMES[entrance.theme];

  const dismiss = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setVisible(false);
  };

  return (
    <div
      data-testid="entrance-overlay"
      role="status"
      aria-label={`Now throwing: ${entrance.playerName}`}
      className="fixed inset-0 z-[9500] flex items-center justify-center cursor-pointer"
      onClick={dismiss}
    >
      {useVideo && (
        <video
          key={entrance.at}
          src={spec.video}
          autoPlay
          muted
          playsInline
          data-testid="entrance-video"
          className="absolute inset-0 w-full h-full object-cover video-fade-in"
          onEnded={dismiss}
          onError={() => setUseVideo(false)}
        />
      )}
      <div className="relative text-center px-8 pointer-events-none">
        <div
          className="text-sm md:text-base font-bold uppercase tracking-[0.35em] text-neutral-200
                     drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
        >
          Now throwing
        </div>
        <div
          className="announce-flash text-6xl md:text-8xl font-black italic tracking-tight
                     drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]"
          style={{ color: spec.accent }}
        >
          {entrance.playerName}
        </div>
      </div>
    </div>
  );
}
