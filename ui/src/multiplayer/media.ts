/**
 * media.ts — getUserMedia / device-enumeration helpers.
 *
 * Fully guarded: returns null if the browser API is absent (jsdom / SSR).
 * Real A/V verified manually — jsdom has no mediaDevices.
 */

export interface MediaConstraints {
  video?: boolean | MediaTrackConstraints;
  audio?: boolean | MediaTrackConstraints;
}

/** Why media acquisition produced no stream (null = success or nothing requested). */
export type MediaFailure = "unsupported" | "denied" | "failed" | null;

export interface MediaAcquisition {
  stream: MediaStream | null;
  failure: MediaFailure;
}

/**
 * Request camera+mic access, reporting why it failed so the UI can tell the user.
 * - both constraints false → no request, no failure (user opted out)
 * - no `navigator.mediaDevices` → "unsupported" (tests / SSR / very old WebView)
 * - permission rejected → "denied"; anything else → "failed"
 */
export async function acquireLocalMedia(
  constraints: MediaConstraints = { video: true, audio: true },
): Promise<MediaAcquisition> {
  if (!constraints.video && !constraints.audio) return { stream: null, failure: null };
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return { stream: null, failure: "unsupported" };
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia(constraints), failure: null };
  } catch (err) {
    console.warn("[media] getUserMedia failed:", err);
    const name = err instanceof DOMException ? err.name : "";
    const denied = name === "NotAllowedError" || name === "SecurityError";
    return { stream: null, failure: denied ? "denied" : "failed" };
  }
}

/**
 * Request camera+mic access.
 * Returns null when `navigator.mediaDevices` is unavailable (tests / SSR).
 */
export async function getLocalStream(
  constraints: MediaConstraints = { video: true, audio: true },
): Promise<MediaStream | null> {
  return (await acquireLocalMedia(constraints)).stream;
}

/** List video input devices; returns [] when unavailable. */
export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  return _listDevices("videoinput");
}

/** List audio input devices; returns [] when unavailable. */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  return _listDevices("audioinput");
}

async function _listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === kind);
  } catch {
    return [];
  }
}
