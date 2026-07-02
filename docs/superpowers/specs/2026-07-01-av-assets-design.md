# AV Assets & Visual Polish — Design

**Date:** 2026-07-01
**Status:** Approved (autonomous mandate — user pre-approved; explicit ask 2026-05-22: "rich graphics, sound effects, and checkout videos")

## Problem

The UI has a complete progressive-enhancement seam for real media —
`SOUND_MANIFEST` / `VIDEO_MANIFEST` paths, per-call-site fallbacks — but no
actual assets exist and the `FilePack` referenced by the sound manifest was
never implemented. Sounds play through the realtime `SynthPack` oscillator
bleeps; celebration videos always fall back to procedural CSS.

## Goals

1. Ship **real sound effects** for all 9 `SoundName` events.
2. Ship **real celebration/announcement videos** for all 7 `VIDEO_MANIFEST` keys.
3. Implement **`FilePack`** so the shipped audio actually plays, with per-sound
   fallback to `SynthPack`.
4. A modest **visual polish pass** (CSS depth, video fade-in) that respects
   `prefers-reduced-motion`.
5. All assets **reproducible** from generator scripts committed to `tools/`.

Non-goals: BLE/protocol layer (guardrail — untouched), rebuilding installers,
licensed/sampled media (assets are 100% self-generated), new Settings UI
(existing sound/video toggles already cover the new assets).

## Approaches considered

- **A. Drop-in generated assets + FilePack (chosen).** Offline Python+ffmpeg
  generators produce layered, mastered audio and rendered motion-graphics MP4s.
  Zero new runtime dependencies; leverages the existing fallback seam.
- **B. Richer realtime synthesis only.** Improve SynthPack scheduling/voices.
  Rejected: realtime WebAudio can't match offline layering/mastering (noise-based
  crowd swells, reverb tails), and does nothing for videos.
- **C. Third-party asset packs.** Rejected: violates "only assets you can come
  up with" constraint and adds licensing risk.

## Design

### 1. Sound generation — `tools/make_sounds.py`

Python (numpy, tools-only dep) synthesises each event at 44.1 kHz stereo:
layered oscillators + shaped noise, ADSR envelopes, detuned unison for fanfares,
Schroeder-style reverb tail, per-clip peak normalisation to −1 dBFS, soft-clip
master. Writes WAV to a temp dir, encodes MP3 (libmp3lame 192 kbps) into
`ui/public/sounds/` at the exact manifest filenames.

Sound identities (all < 3 s):

| Event | Character |
|---|---|
| hit | woody thud: filtered noise burst + 180 Hz body knock |
| hit-treble | thud + bright metallic triad sparkle |
| hit-bull | thud + rising shimmer sweep |
| miss | dull low thump, slight pitch drop |
| bust | descending sawtooth buzzer + low impact |
| leg-won | two-chord brass-ish fanfare + short crowd swell (shaped noise) |
| game-won | full four-chord fanfare, crowd swell + sparkle rain |
| one-eighty | rising arpeggio into unison stab + big crowd roar |
| checkout-available | soft two-note bell chime, long decay |

### 2. `FilePack` — `ui/src/sound/FilePack.ts`

Implements `SoundPack`. Lazy per-sound `fetch` + `decodeAudioData` into cached
`AudioBuffer`s on first play (first play always follows a user gesture, so the
AudioContext can start). Playback via `AudioBufferSourceNode` → `GainNode`
(volume). Failure handling per sound: fetch !ok / decode error → mark failed,
delegate that sound to an injected fallback `SoundPack` (SynthPack) forever;
while a buffer is still loading, concurrent plays await the same promise (no
double-fetch), and the *first* play falls back to synth so the cue is never
silent. No AudioContext available → whole pack delegates. `SoundManager`
singleton becomes `new SoundManager(new FilePack(SOUND_MANIFEST, new SynthPack()))`.
TDD with mocked fetch/AudioContext.

### 3. Video generation — `tools/make_videos.py`

PIL renders per-frame PNG-free RGB frames piped straight to ffmpeg stdin
(`rawvideo` → H.264 yuv420p, CRF 22, 960×540 @ 30 fps, `+faststart`). Shared
scene toolkit: dark arena backdrop with radial vignette, rotating gold conic
rays, physics confetti particles, Impact-font italic headline with glow and
scale-in, sub-label. Per-clip themes:

| Clip | Duration | Theme |
|---|---|---|
| game-won.mp4 | 6 s | gold rays, dense confetti, "GAME SHOT!" |
| leg-won.mp4 | 4 s | teal accent, medium confetti, "LEG!" |
| one-eighty.mp4 | 2.6 s | triple text-flash "180", max confetti burst |
| treble-twenty.mp4 | 2.2 s | gold flash "TREBLE 20!" + ray burst |
| treble-nineteen.mp4 | 2.2 s | same, "TREBLE 19!" |
| treble-eighteen.mp4 | 2.2 s | same, "TREBLE 18!" |
| bullseye.mp4 | 2.2 s | red/gold ring zoom, "BULLSEYE!" |

All ≤ ~2 MB each (well under the 20 MB README cap); announcement clips ≤ 2.6 s
(under the 5 s overlay cap). Videos are muted by the players — no audio track.

### 4. Visual polish

- `index.css`: layered arena backdrop (dual vignette + faint SVG-noise texture),
  glassier `granbridge-board-container` with inset highlight, video fade-in
  keyframe.
- `CheckoutOverlay` / `AnnouncementOverlay`: apply fade-in class to `<video>`
  (reduced-motion path unchanged — it never mounts video).
- READMEs in `public/sounds` / `public/videos` updated: assets now shipped,
  regeneration instructions (`tools/make_sounds.py`, `tools/make_videos.py`),
  drop-in replacement still supported.

### 5. Testing & verification

- Unit: FilePack (fallback matrix, caching, volume), existing suites stay green.
- Asset sanity: generator scripts assert output existence/size; ffprobe checks
  duration/codec in the build step run manually.
- `npm test` + `npm run build` green; manual smoke via vite dev if feasible.

### Risks

- Binary assets in git (~5–10 MB total): acceptable — Tauri bundles `public/`,
  and regeneration scripts keep them reproducible.
- MP3 licensing: LAME patents expired; fine.
- Windows-only font path in video generator: acceptable (project is a Windows
  app; script falls back to PIL default font if Impact is missing).
