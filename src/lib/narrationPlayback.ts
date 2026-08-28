/**
 * App players (PlayerSu / PlayerMu / PlayerBi) default to 0.85x with pitch
 * preserved. The Web Player must use the same rate on the same generated
 * MP3s — never Web Audio resampling, which delays playback and changes voice.
 */

/** Same default as kidz PlayerSu / PlayerMu / PlayerBi. Locked — no speed UI. */
export const APP_NARRATION_RATE = 0.85;

/** Apply rate the way WebKit actually honors it on a media element. */
export function applyMediaPlaybackRate(el: HTMLMediaElement, rate: number) {
  try {
    el.defaultPlaybackRate = rate;
  } catch {
    /* ignore */
  }
  el.playbackRate = rate;
  const media = el as HTMLMediaElement & {
    preservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  try {
    media.preservesPitch = true;
    media.webkitPreservesPitch = true;
  } catch {
    /* older WebKit */
  }
}

/** Start or resume media at `rate`. pause→setRate→play is required on some iOS versions. */
export async function playMediaAtRate(
  el: HTMLMediaElement,
  rate: number,
): Promise<void> {
  applyMediaPlaybackRate(el, rate);
  await el.play();
  applyMediaPlaybackRate(el, rate);
  if (Math.abs(el.playbackRate - rate) > 0.01) {
    el.pause();
    applyMediaPlaybackRate(el, rate);
    await el.play();
    applyMediaPlaybackRate(el, rate);
  }
}
