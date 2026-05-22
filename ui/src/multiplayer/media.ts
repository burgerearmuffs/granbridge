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

/**
 * Request camera+mic access.
 * Returns null when `navigator.mediaDevices` is unavailable (tests / SSR).
 */
export async function getLocalStream(
  constraints: MediaConstraints = { video: true, audio: true },
): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return null;
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.warn("[media] getUserMedia failed:", err);
    return null;
  }
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
