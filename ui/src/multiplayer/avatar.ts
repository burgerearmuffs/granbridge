/**
 * Pure avatar helpers — deterministic color + initials. No DOM, no state.
 */

export const AVATAR_PALETTE: string[] = [
  "#f59e0b", "#ef4444", "#10b981", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

/** Deterministic palette color from a stable id (sum of char codes mod palette size). */
export function defaultAvatarColor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

/** Up to 2 uppercase initials. Two+ tokens → first letter of each of the first two;
 *  single token → first two characters; empty → "?". */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const tokens = trimmed.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}
