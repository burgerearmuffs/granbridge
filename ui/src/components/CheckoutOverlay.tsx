import { useEffect, useRef, useState, useCallback } from "react";
import type { VideoKey } from "../video/decide";
import { VIDEO_MANIFEST } from "../video/manifest";

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Text labels
// ---------------------------------------------------------------------------
const LABELS: Record<VideoKey, string> = {
  "game-won": "GAME SHOT!",
  "leg-won":  "LEG!",
};

const CONTEXT_LABELS: Record<VideoKey, string> = {
  "game-won": "Game Won",
  "leg-won":  "Leg Won",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface CheckoutTrigger {
  key: VideoKey;
  /** Bump this integer to re-fire the overlay for the same key. */
  n: number;
}

interface Props {
  trigger: CheckoutTrigger | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function CheckoutOverlay({ trigger }: Props) {
  const settings = readSettings();

  // When disabled entirely, render nothing at all.
  if (!settings.enabled) return null;

  return <OverlayInner trigger={trigger} settings={settings} />;
}

// Inner component — settings already resolved, trigger is not-null-gated above.
function OverlayInner({
  trigger,
  settings,
}: {
  trigger: CheckoutTrigger | null;
  settings: VideoSettings;
}) {
  const [visible, setVisible] = useState(false);
  const [useVideo, setUseVideo] = useState(false);
  const prevRef = useRef<{ key: VideoKey; n: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const hide = useCallback(() => {
    setVisible(false);
    setUseVideo(false);
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!trigger) return;
    // Fire only when trigger changes (key or n bumped).
    const prev = prevRef.current;
    if (prev && prev.key === trigger.key && prev.n === trigger.n) return;
    prevRef.current = { key: trigger.key, n: trigger.n };

    // Cancel any running hide timer / previous video.
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (settings.reducedMotion) {
      // Reduced motion: show static text briefly, no video, no animation.
      setUseVideo(false);
      setVisible(true);
      hideTimerRef.current = setTimeout(hide, 2000);
      return;
    }

    // Full mode: try video first; CheckoutOverlay sets useVideo=true and the
    // <video> element's onError will fall back to procedural if the file 404s.
    const src = VIDEO_MANIFEST[trigger.key];
    if (src) {
      setUseVideo(true);
      setVisible(true);
      // Safety fallback: if video never fires onEnded/onError within 12 s, hide.
      hideTimerRef.current = setTimeout(hide, 12_000);
    } else {
      setUseVideo(false);
      setVisible(true);
      hideTimerRef.current = setTimeout(hide, 4000);
    }

    return () => {
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [trigger, settings.reducedMotion, hide]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!visible || !trigger) return null;

  const label = LABELS[trigger.key];
  const contextLabel = CONTEXT_LABELS[trigger.key];

  return (
    <div
      data-testid="checkout-overlay"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {useVideo ? (
        <video
          ref={videoRef}
          key={`${trigger.key}-${trigger.n}`}
          src={VIDEO_MANIFEST[trigger.key]}
          autoPlay
          muted
          playsInline
          data-testid="checkout-video"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          onEnded={hide}
          onError={() => {
            // Video file not found or unplayable — fall back to procedural.
            if (hideTimerRef.current !== null) {
              clearTimeout(hideTimerRef.current);
              hideTimerRef.current = null;
            }
            setUseVideo(false);
            // Keep visible=true; procedural fallback will show instead.
            hideTimerRef.current = setTimeout(hide, 4000);
          }}
        />
      ) : (
        <ProceduralCelebration
          label={label}
          contextLabel={contextLabel}
          reducedMotion={settings.reducedMotion}
          videoKey={trigger.key}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Procedural celebration
// ---------------------------------------------------------------------------
interface ProceduralProps {
  label: string;
  contextLabel: string;
  reducedMotion: boolean;
  videoKey: VideoKey;
}

function ProceduralCelebration({ label, contextLabel, reducedMotion, videoKey }: ProceduralProps) {
  const accent = videoKey === "game-won" ? "#ffd54a" : "#4ecdc4";

  if (reducedMotion) {
    return (
      <div
        data-testid="procedural-celebration"
        style={{
          background: "rgba(0,0,0,0.75)",
          color: accent,
          fontSize: "clamp(2rem, 8vw, 5rem)",
          fontWeight: 900,
          letterSpacing: "0.05em",
          padding: "0.5em 1em",
          borderRadius: "0.25em",
          textAlign: "center",
        }}
      >
        {label}
        <div
          data-testid="context-label"
          style={{
            fontSize: "clamp(0.75rem, 2.5vw, 1.25rem)",
            fontWeight: 600,
            letterSpacing: "0.1em",
            opacity: 0.75,
            marginTop: "0.25em",
          }}
        >
          {contextLabel}
        </div>
      </div>
    );
  }

  // Full animated celebration: rays + scale-in text.
  return (
    <div
      data-testid="procedural-celebration"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "min(80vw, 600px)",
        height: "min(80vw, 600px)",
      }}
    >
      {/* Spinning rays */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: `conic-gradient(
            from 0deg,
            transparent 0deg,
            ${accent}22 10deg,
            transparent 20deg,
            transparent 30deg,
            ${accent}22 40deg,
            transparent 50deg,
            transparent 60deg,
            ${accent}22 70deg,
            transparent 80deg,
            transparent 90deg,
            ${accent}22 100deg,
            transparent 110deg,
            transparent 120deg,
            ${accent}22 130deg,
            transparent 140deg,
            transparent 150deg,
            ${accent}22 160deg,
            transparent 170deg,
            transparent 180deg,
            ${accent}22 190deg,
            transparent 200deg,
            transparent 210deg,
            ${accent}22 220deg,
            transparent 230deg,
            transparent 240deg,
            ${accent}22 250deg,
            transparent 260deg,
            transparent 270deg,
            ${accent}22 280deg,
            transparent 290deg,
            transparent 300deg,
            ${accent}22 310deg,
            transparent 320deg,
            transparent 330deg,
            ${accent}22 340deg,
            transparent 350deg,
            transparent 360deg
          )`,
          borderRadius: "50%",
          animation: "checkout-spin 3s linear infinite",
        }}
      />

      {/* Glow backdrop */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          width: "60%",
          height: "60%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}55 0%, transparent 70%)`,
          animation: "checkout-pulse 1s ease-in-out infinite alternate",
        }}
      />

      {/* Main label text + context label */}
      <div
        style={{
          position: "relative",
          color: accent,
          fontSize: "clamp(3rem, 12vw, 7rem)",
          fontWeight: 900,
          letterSpacing: "0.05em",
          textAlign: "center",
          textShadow: `0 0 30px ${accent}, 0 0 60px ${accent}88`,
          animation: "checkout-scalein 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
          lineHeight: 1.1,
        }}
      >
        {label}
        <div
          data-testid="context-label"
          style={{
            fontSize: "clamp(0.75rem, 2.5vw, 1.25rem)",
            fontWeight: 600,
            letterSpacing: "0.1em",
            opacity: 0.75,
            marginTop: "0.25em",
            textShadow: "none",
          }}
        >
          {contextLabel}
        </div>
      </div>

      {/* Keyframe styles injected once */}
      <style>{`
        @keyframes checkout-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes checkout-pulse {
          from { opacity: 0.5; transform: scale(0.9); }
          to   { opacity: 1;   transform: scale(1.1); }
        }
        @keyframes checkout-scalein {
          from { opacity: 0; transform: scale(0.3); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
