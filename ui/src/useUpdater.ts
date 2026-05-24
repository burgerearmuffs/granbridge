import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "dismissed";

export interface UpdaterState {
  phase: UpdatePhase;
  version: string | null;
  notes: string | null;
  progress: number; // 0..1
  error: string | null;
  startUpdate: () => void;
  dismiss: () => void;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useUpdater(): UpdaterState {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return; // StrictMode mounts effects twice in dev
    checkedRef.current = true;
    if (!isTauri()) return;
    setPhase("checking");
    check()
      .then((update) => {
        if (update) {
          updateRef.current = update;
          setVersion(update.version);
          setNotes(update.body ?? null);
          setPhase("available");
        } else {
          setPhase("idle");
        }
      })
      .catch((e) => {
        setError(String(e));
        setPhase("error");
      });
  }, []);

  const startUpdate = useCallback(() => {
    const update = updateRef.current;
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    let total = 0;
    let downloaded = 0;
    update
      .downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setProgress(total > 0 ? Math.min(downloaded / total, 1) : 0);
            break;
          case "Finished":
            setProgress(1);
            setPhase("ready");
            break;
        }
      })
      .then(() => relaunch())
      .catch((e) => {
        setError(String(e));
        setPhase("error");
      });
  }, []);

  const dismiss = useCallback(() => setPhase("dismissed"), []);

  return { phase, version, notes, progress, error, startUpdate, dismiss };
}
