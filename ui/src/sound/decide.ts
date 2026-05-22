import type { Event } from "../types";

export type SoundName =
  | "hit"
  | "hit-treble"
  | "hit-bull"
  | "miss"
  | "bust"
  | "leg-won"
  | "game-won"
  | "one-eighty"
  | "checkout-available";

/**
 * Pure, stateful decision layer — no audio, fully unit-testable.
 *
 * State tracked across calls:
 *  - Rolling visit accumulator (up to 3 dart_hit scores, reset after 3)
 *  - Whether a checkout suggestion is currently visible (to detect the
 *    absent→present transition for the "checkout-available" cue)
 */
export class SoundDecider {
  /** Scores accumulated in the current visit (reset after 3 darts). */
  private visitScores: number[] = [];
  /** Whether checkout was present the last time we saw a game_state. */
  private checkoutPresent = false;

  decide(event: Event): SoundName | null {
    switch (event.type) {
      case "dart_hit": {
        const { bed, score } = event;

        // Classify the bed
        let name: SoundName;
        if (bed === "MISS") {
          name = "miss";
        } else if (bed === "BULL" || bed === "DBULL" || bed === "SBULL") {
          name = "hit-bull";
        } else if (bed.startsWith("T")) {
          name = "hit-treble";
        } else {
          name = "hit";
        }

        // Accumulate for 180 detection
        this.visitScores.push(score);
        if (this.visitScores.length >= 3) {
          const total = this.visitScores.reduce((a, b) => a + b, 0);
          this.visitScores = []; // reset for next visit
          if (total === 180) return "one-eighty";
        }

        return name;
      }

      case "bust":
        // A bust resets the visit so a partial visit doesn't bleed into the next
        this.visitScores = [];
        return "bust";

      case "leg_won":
        this.visitScores = [];
        return "leg-won";

      case "game_won":
        this.visitScores = [];
        return "game-won";

      case "game_state": {
        const checkout = event.state.mode_view?.checkout;
        const nowPresent = Array.isArray(checkout) && checkout.length > 0;
        const wasPresent = this.checkoutPresent;
        this.checkoutPresent = nowPresent;
        // Fire only on the absent→present transition
        if (nowPresent && !wasPresent) return "checkout-available";
        return null;
      }

      default:
        return null;
    }
  }

  /** Reset all internal state (e.g. at game start). */
  reset(): void {
    this.visitScores = [];
    this.checkoutPresent = false;
  }
}
