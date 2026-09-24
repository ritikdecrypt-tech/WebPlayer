/** Lock-screen / Control Center artwork. Same mark as the native app icon. */
export const KINORA_ARTWORK_PATH = "/icon.png";

export function kinoraArtwork(origin: string): MediaImage[] {
  const src = new URL(KINORA_ARTWORK_PATH, origin).href;
  return [
    { src, sizes: "1024x1024", type: "image/png" },
    { src, sizes: "512x512", type: "image/png" },
  ];
}

export function storyMediaMetadata(input: {
  title: string | null;
  childName: string;
  origin: string;
}): MediaMetadataInit {
  const child = input.childName.trim();
  const title =
    input.title?.trim() || (child ? `${child}'s story` : "Kinora story");
  return {
    title,
    artist: "Kinora",
    album: child || "Kinora",
    artwork: kinoraArtwork(input.origin),
  };
}

export function publishMediaPosition(
  session: MediaSession,
  el: HTMLMediaElement,
  fallbackRate: number,
) {
  if (typeof session.setPositionState !== "function") return;
  const duration = el.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const position = Math.min(duration, Math.max(0, el.currentTime || 0));
  const playbackRate =
    Number.isFinite(el.playbackRate) && el.playbackRate > 0
      ? el.playbackRate
      : fallbackRate;
  try {
    session.setPositionState({ duration, playbackRate, position });
  } catch {
    /* Safari rejects a position that races a duration change. */
  }
}
