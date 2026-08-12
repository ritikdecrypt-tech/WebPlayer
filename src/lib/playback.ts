/** Rough spoken duration estimate — mirrors the mobile player's heuristic. */
export function estimateSpeechDurationMs(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = 155 * rate;
  const ms = (words / Math.max(wordsPerMinute, 1)) * 60_000;
  return Math.max(2500, Math.round(ms));
}

export function formatClockTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}
