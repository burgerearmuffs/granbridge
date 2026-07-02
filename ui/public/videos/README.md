# Checkout & Announcement Video Clips

Real celebration clips shipped with the app, rendered procedurally by
`tools/make_videos.py` (PIL frames piped to ffmpeg — rotating rays, physics
confetti, broadcast headline with glow; 960×540 @ 30 fps, H.264 yuv420p).
To restyle a clip, edit its `ClipSpec` there and rerun:

```
.venv/Scripts/python tools/make_videos.py
```

## Filenames

These paths come from `ui/src/video/manifest.ts` (`VIDEO_MANIFEST`):

| File | Triggered by | Duration |
|------|--------------|----------|
| `game-won.mp4` | `game_won` — CheckoutOverlay "GAME SHOT!" | 6 s |
| `leg-won.mp4`  | `leg_won` — CheckoutOverlay "LEG!" | 4 s |
| `one-eighty.mp4` | a 180 visit (outranks the third dart's treble clip) | 2.6 s |
| `treble-twenty.mp4` | a T20 hit | 2.2 s |
| `treble-nineteen.mp4` | a T19 hit | 2.2 s |
| `treble-eighteen.mp4` | a T18 hit | 2.2 s |
| `bullseye.mp4` | a double bull (DBULL) | 2.2 s |

## Replacing a clip / fallback behaviour

Drop any `.mp4` at the same path — Vite serves `ui/public/` at the site root
with no hashing. If a file is absent (404) or unplayable, the overlays catch
`onError` and fall back to the built-in procedural CSS celebration — no code
change required.

Specs if you swap in your own: H.264 + AAC MP4, ≤ 20 MB; keep announcement
clips ≤ 5 s (the AnnouncementOverlay hard-caps them at 5 s), and the
`<video>` element is `muted` so autoplay works everywhere.
