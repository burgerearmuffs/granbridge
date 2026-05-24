/** Pure recovery-key codec: base64("granbridge:" + id + ":" + writeToken). No persistence. */
const PREFIX = "granbridge";

export function exportRecoveryKey(idy: { id: string; writeToken: string }): string {
  return btoa(`${PREFIX}:${idy.id}:${idy.writeToken}`);
}

export function importRecoveryKey(key: string): { id: string; writeToken: string } {
  let decoded: string;
  try {
    decoded = atob(key.trim());
  } catch {
    throw new Error("invalid recovery key");
  }
  const parts = decoded.split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) {
    throw new Error("invalid recovery key");
  }
  return { id: parts[1], writeToken: parts[2] };
}
