/**
 * useFullscreen — Tauri v2 window fullscreen + browser Fullscreen API fallback.
 *
 * Guards:
 * - jsdom has no requestFullscreen → everything is a no-op.
 * - Tauri detection: "__TAURI_INTERNALS__" in window (synchronous, no import needed).
 * - All API calls wrapped in try/catch so the hook never throws.
 */

import { useState, useEffect, useCallback } from "react";

function isTauri(): boolean {
  try {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}

function hasBrowserFullscreen(): boolean {
  try {
    return (
      typeof document !== "undefined" &&
      typeof document.documentElement?.requestFullscreen === "function"
    );
  } catch {
    return false;
  }
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keep isFullscreen in sync via the browser fullscreenchange event (non-Tauri).
  useEffect(() => {
    if (isTauri() || !hasBrowserFullscreen()) return;

    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }

    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (isTauri()) {
        // Dynamic import so jsdom never tries to resolve the native module.
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const current = await win.isFullscreen();
        await win.setFullscreen(!current);
        setIsFullscreen(!current);
      } else if (hasBrowserFullscreen()) {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        } else {
          await document.documentElement.requestFullscreen();
          setIsFullscreen(true);
        }
      }
      // jsdom: neither branch matches → safe no-op
    } catch (e) {
      // Surface the failure (e.g. a denied Tauri capability) instead of swallowing it
      // silently — a silent catch here hid the missing set-fullscreen permission.
      console.warn("[useFullscreen] toggle failed:", e);
    }
  }, []);

  return { isFullscreen, toggle };
}
