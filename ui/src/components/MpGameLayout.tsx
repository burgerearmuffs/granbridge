/**
 * MpGameLayout — broadcast-rail shell for the multiplayer in-game view.
 *
 * Layout (no-scroll):
 *   Root: full viewport-height flex row, overflow-hidden
 *   Left (flex-1):  board + score, centered
 *   Right (~34%):   column — oppVideo (flex-[1.4]) | selfVideo (flex-1) | oppCard | controls (mt-auto)
 *
 * All inner regions carry data-* attributes for test targeting.
 */

import type { ReactNode } from "react";

interface MpGameLayoutProps {
  /** The game board/scoreboard for the active mode */
  board: ReactNode;
  /** Local camera feed (small) */
  selfVideo: ReactNode;
  /** Opponent camera feed (larger) */
  oppVideo: ReactNode;
  /** Opponent profile card — may be null until card arrives */
  oppCard: ReactNode;
  /** MpControls + host/guest action controls */
  controls: ReactNode;
}

export function MpGameLayout({ board, selfVideo, oppVideo, oppCard, controls }: MpGameLayoutProps) {
  return (
    <div
      data-mp-layout
      className="flex h-[calc(100vh-6rem)] overflow-hidden rounded-lg"
    >
      {/* Left: board zone — flex-1, centered */}
      <div
        data-board-zone
        className="flex-1 flex flex-col items-center justify-center min-h-0 overflow-hidden p-4"
      >
        {board}
      </div>

      {/* Right rail: ~34% width, column layout */}
      <div className="w-[34%] flex flex-col min-h-0 overflow-hidden bg-neutral-900/60 p-3 gap-3">
        {/* Opponent video — largest */}
        <div
          data-opp-video-zone
          className="flex-[1.4] min-h-0 overflow-hidden rounded-lg"
        >
          {oppVideo}
        </div>

        {/* Self video — smaller */}
        <div className="flex-1 min-h-0 overflow-hidden rounded-lg">
          {selfVideo}
        </div>

        {/* Opponent card (optional) */}
        {oppCard && (
          <div className="flex-none">
            {oppCard}
          </div>
        )}

        {/* Controls — pushed to bottom */}
        <div className="mt-auto flex-none">
          {controls}
        </div>
      </div>
    </div>
  );
}
