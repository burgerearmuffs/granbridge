import type { UpdaterState } from "../useUpdater";

export function UpdateBanner({ state }: { state: UpdaterState }) {
  const { phase, version, notes, progress, startUpdate, dismiss } = state;

  // Silent for: no update, still checking, a failed background check (version null), or dismissed.
  if (phase === "dismissed" || version === null) return null;

  const downloading = phase === "downloading" || phase === "ready";
  const failed = phase === "error";

  return (
    <div className="mb-4 flex items-center gap-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <span className="font-semibold text-amber-300">Update available</span>
      <span className="text-neutral-300">
        v{version}
        {notes ? ` — ${notes}` : ""}
      </span>
      <div className="ml-auto flex items-center gap-3">
        {failed && <span className="text-red-400">Update failed — try later</span>}
        {downloading ? (
          <span className="tabular-nums text-amber-200">
            {phase === "ready" ? "Restarting…" : `Downloading ${Math.round(progress * 100)}%`}
          </span>
        ) : (
          <button
            onClick={startUpdate}
            className="rounded-full bg-amber-400 px-4 py-1.5 font-semibold text-neutral-900 hover:bg-amber-300"
          >
            Update &amp; restart
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-neutral-400 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
