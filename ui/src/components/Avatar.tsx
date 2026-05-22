/** Avatar — a colored circle with the player's initials. Pure, presentational. */
import { initials } from "../multiplayer/avatar";

interface AvatarProps {
  name: string;
  color: string;
  size?: number;
}

export function Avatar({ name, color, size = 40 }: AvatarProps) {
  return (
    <div
      role="img"
      aria-label={`${name} avatar`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: Math.round(size * 0.4) }}
      className="inline-flex items-center justify-center rounded-full text-white font-bold select-none leading-none"
    >
      {initials(name)}
    </div>
  );
}
