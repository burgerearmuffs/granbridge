# Checkout Video Clips

Drop `.mp4` files here to enable real celebration videos.

Vite serves everything in `ui/public/` at the site root with no filename hashing,
so files placed here are immediately available at the paths listed below.

## Expected filenames

| File | Triggered by |
|------|-------------|
| `game-won.mp4` | `game_won` event — shown by `CheckoutOverlay` as "GAME SHOT!" |
| `leg-won.mp4`  | `leg_won` event  — shown by `CheckoutOverlay` as "LEG!"       |

These paths come from `ui/src/video/manifest.ts`:

```
/videos/game-won.mp4
/videos/leg-won.mp4
```

## Fallback behaviour

If a file is absent (HTTP 404) or unplayable, `CheckoutOverlay` catches the
`onError` event and automatically falls back to the built-in procedural
CSS/text celebration — no code change required.

## Recommended specs

- Short clips (4–10 s), portrait or landscape, ≤ 20 MB
- H.264 + AAC in an MP4 container for broad browser support
- The `<video>` element is `muted` so autoplay works in all browsers
