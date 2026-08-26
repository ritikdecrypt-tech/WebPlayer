/**
 * Playback timing helpers — MUST stay in lockstep with
 * kidz/src/utils/textToSpeech.ts or the web clock diverges from the phone app.
 */

// expo-speech / native player estimate: ~150 wpm at rate 1.0, scaled by rate.
const WORDS_PER_SECOND_AT_RATE_1 = 2.5;
const MIN_DURATION_MS = 1200;

export function estimateSpeechDurationMs(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wordsPerSecond = WORDS_PER_SECOND_AT_RATE_1 * Math.max(rate, 0.1);
  return Math.max((words / wordsPerSecond) * 1000, MIN_DURATION_MS);
}

/** Same rounding as the native player — Math.round, not floor. */
export function formatClockTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

const EMOJI_PATTERN =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

export function sanitizeForSpeech(text: string): string {
  return text
    .replace(EMOJI_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}
