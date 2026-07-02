/**
 * AnnouncementOverlay — broadcast-style flash for big single-dart moments
 * (TREBLE TWENTY!, BULLSEYE!, ONE EIGHTY!).
 *
 * Same drop-a-clip mechanism as CheckoutOverlay: if a matching .mp4 exists in
 * ui/public/videos/ it plays fullscreen-muted; on 404/unplayable it falls back
 * to a procedural text flash. Sits *below* CheckoutOverlay's z-index so a
 * winning dart's GAME SHOT takeover always outranks its own treble flash.
 * Honors the granbridge.video settings (enabled / reduced motion).
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { VIDEO_MANIFEST } from "../video/manifest";
import type { AnnounceKey } from "../video/decide";

export const ANNOUNCE_LABELS: Record<AnnounceKey, string> = {
  "treble-twenty":   "TREBLE TWENTY!",
  "treble-nineteen": "TREBLE NINETEEN!",
  "treble-eighteen": "TREBLE EIGHTEEN!",
  "bullseye":        "BULLSEYE!",
  "one-eighty":      "ONE EIGHTY!",
};

const FLASH_MS = 1800;
const REDUCED_MS = 1200;
const VIDEO_CAP_MS = 5000;

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

export function AnnouncementOverlay() {
  const announcement = useStore((s) => s.announcement);
  const [visible, setVisible] = useState(false);
  const [useVideo, setUseVideo] = useState(false);
  const seenAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!announcement || announcement.at <= seenAtRef.current) return;
    seenAtRef.current = announcement.at;
    const { enabled, reducedMotion } = videoSettings();
    if (!enabled) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const wantVideo = !reducedMotion;
    setUseVideo(wantVideo);
    setVisible(true);
    timerRef.current = setTimeout(
      () => setVisible(false),
      reducedMotion ? REDUCED_MS : wantVideo ? VIDEO_CAP_MS : FLASH_MS,
    );
  }, [announcement]);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  if (!visible || !announcement) return null;
  const label = ANNOUNCE_LABELS[announcement.key];

  return (
    <div
      data-testid="announcement-overlay"
      role="status"
      aria-label={label}
      className="fixed inset-0 z-[9000] pointer-events-none flex items-center justify-center"
    >
      {useVideo && (
        <video
          key={`${announcement.key}-${announcement.at}`}
          src={VIDEO_MANIFEST[announcement.key]}
          autoPlay
          muted
          playsInline
          data-testid="announcement-video"
          className="absolute inset-0 w-full h-full object-cover video-fade-in"
          onEnded={() => setVisible(false)}
          onError={() => {
            // No clip for this moment — procedural flash instead.
            setUseVideo(false);
            if (timerRef.current !== null) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setVisible(false), FLASH_MS);
          }}
        />
      )}
      {!useVideo && (
        <div className="announce-flash text-center px-8">
          <span
            className="block text-6xl md:text-7xl font-black italic tracking-tight
                       bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600
                       bg-clip-text text-transparent
                       drop-shadow-[0_0_30px_rgba(251,191,36,0.55)]"
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
}
