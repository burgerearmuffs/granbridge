/**
 * Anonymous identity — persisted to localStorage.
 * Pure module: no WebRTC, no DOM; fully unit-testable.
 */

export interface PlayerIdentity {
  id: string;
  name: string;
}

const STORAGE_KEY = "granbridge.player";

/** Return existing persisted identity, or create+persist a new one. */
export function getOrCreatePlayer(): PlayerIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlayerIdentity;
      if (parsed.id && parsed.name) return parsed;
    }
  } catch {
    /* ignore corrupt storage */
  }
  const id = crypto.randomUUID();
  const short = id.slice(0, 6);
  const identity: PlayerIdentity = { id, name: `Player-${short}` };
  _persist(identity);
  return identity;
}

/** Update the stored display name; returns the updated identity. */
export function setPlayerName(name: string): PlayerIdentity {
  const existing = getOrCreatePlayer();
  const updated: PlayerIdentity = { ...existing, name };
  _persist(updated);
  return updated;
}

function _persist(p: PlayerIdentity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota errors in tests/SSR */
  }
}
