/**
 * After the last narration ends, the player holds the last scene for a short
 * tail while the background music fades to silence, then shows the End Card.
 * Mirrors kidz/src/utils/endingCue.ts.
 */

export const ENDING_TAIL_MS = 2000;

/** Ease-in fade: gentle at first, reaches silence at the end of the tail. */
export function endingTailMusicVolume(baseVolume: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return baseVolume * (1 - t);
}

// Linear fade (even drop)
// baseVolume * (1 - t)
// Gentler start, steeper end (current)
// baseVolume * (1 - t * t)
// Even steeper near the end
// baseVolume * (1 - t * t * t)
// Faster fade early
// baseVolume * (1 - Math.sqrt(t))