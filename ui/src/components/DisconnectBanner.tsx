/**
 * Prominent mid-game connection banner. The header ConnectionBadge is small
 * (and absent in kiosk mode); a board drop during play deserves a banner the
 * thrower can't miss. The engine lives in the bridge, so game state survives
 * board reconnects — say so, to take the panic out of the moment.
 */

interface Props {
  connection: string;
  playing: boolean;
}

export function DisconnectBanner({ connection, playing }: Props) {
  if (!playing || connection === "connected") return null;

  const boardSide = connection === "reconnecting" || connection === "scanning" || connection === "connecting";
  const message = boardSide
    ? "Board reconnecting — hang tight, your game is untouched."
    : "Connection lost — waiting for the bridge. Your game resumes where it left off.";

  return (
    <div
      role="alert"
      className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/60
                 bg-amber-950/70 px-4 py-3 text-amber-200 text-sm font-semibold"
    >
      <span
        aria-hidden="true"
        className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse motion-reduce:animate-none"
      />
      {message}
    </div>
  );
}
