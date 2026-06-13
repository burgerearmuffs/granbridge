/**
 * ShareResult — "Copy result" + "Save image" buttons shown on a finished game.
 */

import { useState } from "react";
import type { GameState } from "../types";
import { buildResultText, downloadResultCard } from "../share/resultCard";

export function ShareResult({ state }: { state: GameState }) {
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState(false);

  if (state.status !== "finished") return null;

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(buildResultText(state));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* leave the button as-is; nothing to copy into */ }
  };

  const save = () => {
    setSaveError(!downloadResultCard(state));
  };

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={() => void copy()}
        aria-label="Copy result to clipboard"
        className="px-4 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-200 hover:bg-neutral-700"
      >
        {copied ? "Copied ✓" : "📋 Copy result"}
      </button>
      <button
        onClick={save}
        aria-label="Save result image"
        className="px-4 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-200 hover:bg-neutral-700"
      >
        🖼 Save image
      </button>
      {saveError && (
        <span role="alert" className="text-xs text-red-300">Couldn't render the image here.</span>
      )}
    </div>
  );
}
