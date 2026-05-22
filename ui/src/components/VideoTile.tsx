/**
 * VideoTile — renders a single camera stream in a <video> element.
 *
 * MediaStreams are bound via a ref / srcObject (never innerHTML).
 * Local tile is muted; remote tiles are unmuted.
 */
import { useEffect, useRef } from "react";
import { Avatar } from "./Avatar";

interface VideoTileProps {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  micActive?: boolean;
  camActive?: boolean;
  avatarName?: string;
  avatarColor?: string;
}

export function VideoTile({ stream, label, muted = false, micActive = true, camActive = true, avatarName, avatarColor }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // Safe DOM: bind via srcObject, never innerHTML
    el.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-neutral-800 aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="w-full h-full object-cover"
        aria-label={`Video stream for ${label}`}
      />
      {!stream && avatarName && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar name={avatarName} color={avatarColor ?? "#3f3f46"} size={64} />
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <span className="bg-black/60 text-white text-xs px-2 py-0.5 rounded-full truncate max-w-[70%]">
          {label}
        </span>
        <span className="flex gap-1">
          {!micActive && (
            <span className="bg-red-600/80 text-white text-xs px-1.5 py-0.5 rounded-full" title="Mic off">
              🎤✕
            </span>
          )}
          {!camActive && (
            <span className="bg-red-600/80 text-white text-xs px-1.5 py-0.5 rounded-full" title="Cam off">
              📷✕
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
