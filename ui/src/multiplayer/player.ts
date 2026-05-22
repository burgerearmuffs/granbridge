/**
 * Persistent player profile — localStorage. Pure module: no WebRTC, no DOM.
 * Extends the original anonymous identity ({id,name}) with an avatar; legacy
 * records are migrated on read.
 */
import { defaultAvatarColor } from "./avatar";

export interface AvatarSpec {
  color: string;
}
export interface Profile {
  id: string;
  name: string;
  avatar: AvatarSpec;
}

const STORAGE_KEY = "granbridge.player";

/** Return the persisted profile (migrating a legacy {id,name}), or create one. */
export function getOrCreatePlayer(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string; name?: string; avatar?: { color?: unknown } };
      if (parsed.id && parsed.name) {
        const hasColor = parsed.avatar && typeof parsed.avatar.color === "string";
        const profile: Profile = {
          id: parsed.id,
          name: parsed.name,
          avatar: { color: hasColor ? (parsed.avatar!.color as string) : defaultAvatarColor(parsed.id) },
        };
        if (!hasColor) _persist(profile);
        return profile;
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  const id = crypto.randomUUID();
  const profile: Profile = { id, name: `Player-${id.slice(0, 6)}`, avatar: { color: defaultAvatarColor(id) } };
  _persist(profile);
  return profile;
}

/** Update the stored display name; returns the updated profile. */
export function setPlayerName(name: string): Profile {
  const updated: Profile = { ...getOrCreatePlayer(), name };
  _persist(updated);
  return updated;
}

/** Update the stored avatar color; returns the updated profile. */
export function setPlayerColor(color: string): Profile {
  const updated: Profile = { ...getOrCreatePlayer(), avatar: { color } };
  _persist(updated);
  return updated;
}

function _persist(p: Profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota errors in tests/SSR */
  }
}
