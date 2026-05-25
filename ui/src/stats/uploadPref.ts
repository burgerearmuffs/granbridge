/** Global "upload my stats" preference (default ON), following the VideoToggle localStorage pattern. */
const KEY = "granbridge.uploadStats";

export function getUploadEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

export function setUploadEnabled(v: boolean): void {
  try { localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
}
