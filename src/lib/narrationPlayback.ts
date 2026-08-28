/**
 * App players (PlayerSu / PlayerMu / PlayerBi) default to 0.85x.
 * Safari often ignores HTMLMediaElement.playbackRate (it snaps back to 1),
 * which makes the Web Player finish early. Web Audio honors the rate.
 */

/** Same default as kidz PlayerSu / PlayerMu / PlayerBi. Locked — no speed UI. */
export const APP_NARRATION_RATE = 0.85;

type WebkitAudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function createAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as WebkitAudioContextWindow).webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio is not available");
  }
  return new Ctor();
}

function isAllowedNarrationSrc(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    if (parsed.protocol !== "https:") return false;
    if (host.endsWith(".supabase.co") || host.endsWith(".supabase.in")) return true;
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (configured) {
      try {
        return host === new URL(configured).hostname.toLowerCase();
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function fetchNarrationBytes(url: string): Promise<ArrayBuffer> {
  if (!isAllowedNarrationSrc(url)) {
    throw new Error("narration URL is not allowed");
  }
  try {
    const direct = await fetch(url);
    if (direct.ok) return direct.arrayBuffer();
  } catch {
    /* Signed storage URLs often omit CORS — Safari then fails fetch(). */
  }
  const proxied = await fetch(`/api/narration?src=${encodeURIComponent(url)}`);
  if (!proxied.ok) {
    throw new Error(`narration fetch failed (${proxied.status})`);
  }
  return proxied.arrayBuffer();
}

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

/**
 * Rate-accurate narration via AudioBufferSourceNode.
 * playbackRate here is always honored, including iOS Safari.
 */
export class WebAudioNarration {
  private readonly rate: number;
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private cache = new Map<string, AudioBuffer>();
  private offset = 0;
  private startedAt = 0;
  private playing = false;
  private onEnded: (() => void) | null = null;

  constructor(rate: number) {
    this.rate = rate;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get hasBuffer(): boolean {
    return this.buffer != null && this.buffer.duration > 0;
  }

  get canResume(): boolean {
    return this.hasBuffer && !this.playing && this.getProgress() < 0.995;
  }

  unlock(): void {
    try {
      this.ctx = this.ctx ?? createAudioContext();
      void this.ctx.resume();
    } catch {
      /* Web Audio unavailable — caller falls back to the media element */
    }
  }

  getProgress(): number {
    if (!this.buffer || this.buffer.duration <= 0) return 0;
    return Math.min(1, this.getBufferTime() / this.buffer.duration);
  }

  async load(url: string): Promise<AudioBuffer> {
    this.unlock();
    if (!this.ctx) throw new Error("Web Audio is not available");
    await this.ctx.resume();

    const cached = this.cache.get(url);
    if (cached) return cached;

    const data = await fetchNarrationBytes(url);
    // Safari detaches the ArrayBuffer passed to decodeAudioData.
    const copy = data.slice(0);
    const decoded = await this.ctx.decodeAudioData(copy);
    this.cache.set(url, decoded);
    return decoded;
  }

  playBuffer(buffer: AudioBuffer, onEnded: () => void, startOffset = 0): void {
    this.unlock();
    if (!this.ctx) throw new Error("Web Audio is not available");
    this.stopSource();
    this.buffer = buffer;
    this.offset = Math.max(0, Math.min(startOffset, buffer.duration));
    this.onEnded = onEnded;
    this.startSource();
  }

  /** Keep a decoded buffer ready without starting (paused during load). */
  hold(buffer: AudioBuffer, onEnded: () => void): void {
    this.stopSource();
    this.buffer = buffer;
    this.offset = 0;
    this.playing = false;
    this.onEnded = onEnded;
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.getBufferTime();
    this.playing = false;
    this.stopSource();
  }

  resume(onEnded: () => void): boolean {
    if (!this.buffer || !this.ctx) return false;
    if (this.playing) return true;
    if (this.offset >= this.buffer.duration - 0.04) return false;
    this.onEnded = onEnded;
    this.startSource();
    return true;
  }

  stop(): void {
    this.playing = false;
    this.offset = 0;
    this.buffer = null;
    this.onEnded = null;
    this.stopSource();
  }

  private getBufferTime(): number {
    if (!this.buffer) return this.offset;
    if (!this.playing || !this.ctx) return this.offset;
    const consumed = (this.ctx.currentTime - this.startedAt) * this.rate;
    return Math.min(this.buffer.duration, this.offset + consumed);
  }

  private startSource(): void {
    if (!this.ctx || !this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.ctx.destination);
    src.onended = () => {
      if (!this.playing) return;
      this.playing = false;
      this.offset = this.buffer?.duration ?? this.offset;
      this.source = null;
      this.onEnded?.();
    };
    this.source = src;
    this.startedAt = this.ctx.currentTime;
    src.start(0, this.offset);
    this.playing = true;
  }

  private stopSource(): void {
    const src = this.source;
    this.source = null;
    if (!src) return;
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
  }
}
