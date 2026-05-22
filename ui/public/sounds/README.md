# Sound Effect Files

Drop audio files here to enable real sound effects in place of the built-in
synthesiser (`SynthPack`).

Vite serves everything in `ui/public/` at the site root with no filename hashing,
so files placed here are immediately available at the paths listed below.

## Expected filenames

These paths come from `ui/src/sound/manifest.ts` (`SOUND_MANIFEST`):

| File | Sound event |
|------|-------------|
| `hit.mp3`                | Regular dart hit (single / double) |
| `hit-treble.mp3`         | Treble hit |
| `hit-bull.mp3`           | Bullseye hit |
| `miss.mp3`               | Dart misses the board |
| `bust.mp3`               | Player busts |
| `leg-won.mp3`            | Player wins a leg |
| `game-won.mp3`           | Player wins the game |
| `one-eighty.mp3`         | 180 scored in a single visit |
| `checkout-available.mp3` | Checkout route becomes available |

## How to activate

A `FilePack` implementation (see `ui/src/sound/manifest.ts` for pseudocode) would
consume this manifest and replace the SynthPack at runtime:

```ts
import { soundManager } from "./SoundManager";
import { FilePack } from "./FilePack";
import { SOUND_MANIFEST } from "./manifest";

soundManager.setPack(new FilePack(SOUND_MANIFEST));
```

Until a FilePack is wired up, dropping files here has no effect — the SynthPack
synthesiser is used automatically.

## Recommended specs

- Short clips (< 3 s), 44.1 kHz, mono or stereo
- MP3 (128 kbps+) for broad browser support
