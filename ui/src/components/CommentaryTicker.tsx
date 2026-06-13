/**
 * CommentaryTicker — shows the latest offline-commentary line from the bridge
 * (`commentary` events, on by default since v0.1.6). Auto-hides a few seconds
 * after each line so it reads like a broadcast caption, not a log.
 */

import { useEffect, useState } from "react";
import { useStore } from "../store";

const SHOW_MS = 6000;

export function CommentaryTicker() {
  const line = useStore((s) => s.commentary);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!line) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(id);
  }, [line]);

  if (!line || !visible) return null;

  return (
    <div
      role="status"
      aria-label="Commentary"
      className="text-center text-sm italic text-neutral-400"
    >
      <span aria-hidden>🎙</span> {line.text}
    </div>
  );
}
