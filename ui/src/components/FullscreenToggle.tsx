/**
 * FullscreenToggle — a header button that enters/exits fullscreen.
 * Uses the useFullscreen hook (Tauri v2 + browser fallback, jsdom-safe).
 */

import { useFullscreen } from "../useFullscreen";

// Inline SVG icons — no dependency needed.
function EnterFullscreenIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="8 3 3 3 3 8" />
      <polyline points="21 8 21 3 16 3" />
      <polyline points="3 16 3 21 8 21" />
      <polyline points="16 21 21 21 21 16" />
      <line x1="3" y1="3" x2="10" y2="10" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="21" y1="21" x2="14" y2="14" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

export function FullscreenToggle() {
  const { isFullscreen, toggle } = useFullscreen();

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label="Toggle fullscreen"
      aria-pressed={isFullscreen}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      className="text-neutral-300 hover:text-white transition-colors leading-none select-none p-1"
    >
      {isFullscreen ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
    </button>
  );
}
