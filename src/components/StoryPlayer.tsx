"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SharedStory } from "@/lib/types";
import {
  estimateSpeechDurationMs,
  formatClockTime,
  sanitizeForSpeech,
} from "@/lib/playback";
import { ENDING_TAIL_MS, endingTailMusicVolume } from "@/lib/endingCue";
import EndCard from "@/components/EndCard";
import DedicationCard from "@/components/DedicationCard";

const MUSIC_VOLUME = 0.22;
/** Same speed steps as the native PlayerSu / PlayerMu / PlayerBi. */
const RATES = [0.85, 1, 1.15] as const;
/** Match the phone app default (PlayerSu starts at 0.85x). */
const DEFAULT_RATE_INDEX = 0;

function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse), (hover: none)").matches;
}

/** Read real file duration from a narration URL (for the scrub-bar clock). */
function probeAudioDurationMs(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const finish = (ms: number | null) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch {
        /* ignore */
      }
      resolve(ms);
    };
    audio.onloadedmetadata = () => {
      const ms = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null;
      finish(ms && ms > 0 ? ms : null);
    };
    audio.onerror = () => finish(null);
    // Do NOT set crossOrigin — Supabase signed URLs often lack CORS headers,
    // and anonymous CORS mode then blocks metadata/playback in Safari.
    audio.src = url;
  });
}

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function requestElementFullscreen(el: HTMLElement): Promise<void> {
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  const webkitEl = el as FullscreenElement;
  if (webkitEl.webkitRequestFullscreen) {
    await webkitEl.webkitRequestFullscreen();
  }
}

async function exitDocumentFullscreen(): Promise<void> {
  if (document.exitFullscreen && document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  const doc = document as FullscreenDocument;
  if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
    await doc.webkitExitFullscreen();
  }
}

function prefersPortraitCssFullscreen(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px), (pointer: coarse) and (hover: none)").matches;
}

type Props = {
  story: SharedStory;
};

export default function StoryPlayer({ story }: Props) {
  const scenes = story.scenes;
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rateIndex, setRateIndex] = useState(DEFAULT_RATE_INDEX);
  const [imageFailed, setImageFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [showDedication, setShowDedication] = useState(true);
  /** Real narration file lengths (ms), filled as metadata loads. Null = still estimating. */
  const [audioDurationsMs, setAudioDurationsMs] = useState<(number | null)[]>(() =>
    scenes.map(() => null),
  );

  const shellRef = useRef<HTMLDivElement | null>(null);
  const narrationElRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const rateRef = useRef<number>(RATES[DEFAULT_RATE_INDEX]);
  /** Bumped when we intentionally replace/tear down narration (seek, new scene, unmount) — not on pause. */
  const sceneTokenRef = useRef(0);
  const audioUnlockedRef = useRef(false);
  const endingFadeIntervalRef = useRef<number | null>(null);
  const endingTailActiveRef = useRef(false);
  const endingTailRemainingMsRef = useRef(ENDING_TAIL_MS);
  const speakSceneRef = useRef<((i: number) => void) | null>(null);

  indexRef.current = index;
  isPlayingRef.current = isPlaying;
  rateRef.current = RATES[rateIndex];

  const current = scenes[index] ?? null;
  const shotCount = current?.shots?.length || (current?.image_url ? 1 : 0);
  const shotIndex =
    shotCount > 0 ? Math.min(shotCount - 1, Math.floor(progress * shotCount)) : 0;
  const activeImage =
    current?.shots?.[shotIndex]?.url ?? current?.image_url ?? null;

  // Prefer real audio file duration (÷ playback rate) so the clock matches the
  // phone app's narration files. Fall back to the text estimate only when a
  // scene has no audio_url or metadata hasn't loaded yet.
  const sceneDurationsMs = useMemo(
    () =>
      scenes.map((s, i) => {
        const rate = RATES[rateIndex];
        const real = audioDurationsMs[i];
        if (real != null && real > 0) return Math.round(real / rate);
        return estimateSpeechDurationMs(s.text, rate);
      }),
    [scenes, rateIndex, audioDurationsMs],
  );
  const totalDurationMs =
    sceneDurationsMs.reduce((sum, d) => sum + d, 0) + ENDING_TAIL_MS;
  const elapsedDurationMs =
    sceneDurationsMs.slice(0, index).reduce((sum, d) => sum + d, 0) +
    progress * (sceneDurationsMs[index] ?? 0);

  // Probe every scene's narration file once so the total clock matches generation.
  useEffect(() => {
    let cancelled = false;
    const urls = scenes.map((s) => s.audio_url);
    urls.forEach((url, i) => {
      if (!url) return;
      void probeAudioDurationMs(url).then((ms) => {
        if (cancelled || ms == null) return;
        setAudioDurationsMs((prev) => {
          if (prev[i] === ms) return prev;
          const next = [...prev];
          next[i] = ms;
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [scenes]);

  const clearEndingFade = useCallback(() => {
    if (endingFadeIntervalRef.current != null) {
      window.clearInterval(endingFadeIntervalRef.current);
      endingFadeIntervalRef.current = null;
    }
  }, []);

  const stopNarrationElement = useCallback(() => {
    const el = narrationElRef.current;
    if (!el) return;
    el.onended = null;
    el.ontimeupdate = null;
    el.onerror = null;
    el.pause();
    el.removeAttribute("src");
    try {
      el.load();
    } catch {
      /* ignore */
    }
  }, []);

  const restoreMusicVolume = useCallback(() => {
    if (musicRef.current) {
      musicRef.current.volume = MUSIC_VOLUME;
      musicRef.current.playbackRate = 1;
    }
  }, []);

  const cancelEndingTail = useCallback(() => {
    clearEndingFade();
    endingTailActiveRef.current = false;
    endingTailRemainingMsRef.current = ENDING_TAIL_MS;
    restoreMusicVolume();
  }, [clearEndingFade, restoreMusicVolume]);

  /** Unlock media inside a user gesture — required on iOS Safari. */
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;

    const narration = narrationElRef.current;
    if (narration) {
      // Silent unlock of the dedicated narration element.
      const prev = narration.volume;
      narration.volume = 0;
      void narration
        .play()
        .then(() => {
          narration.pause();
          narration.volume = prev || 1;
        })
        .catch(() => {
          narration.volume = prev || 1;
        });
    }

    const music = musicRef.current;
    if (music) {
      const prevVol = music.volume;
      music.volume = 0;
      void music
        .play()
        .then(() => {
          music.pause();
          music.currentTime = 0;
          music.volume = prevVol || MUSIC_VOLUME;
        })
        .catch(() => {
          music.volume = prevVol || MUSIC_VOLUME;
        });
    }
  }, []);

  const completeEndingTail = useCallback(() => {
    clearEndingFade();
    endingTailActiveRef.current = false;
    endingTailRemainingMsRef.current = ENDING_TAIL_MS;
    if (musicRef.current) {
      musicRef.current.volume = 0;
      musicRef.current.pause();
    }
    setIsPlaying(false);
    setFinished(true);
    setProgress(1);
  }, [clearEndingFade]);

  const beginEndingTail = useCallback(
    (remainingMs: number = ENDING_TAIL_MS) => {
      clearEndingFade();
      const duration = Math.max(0, remainingMs);
      if (duration <= 0) {
        completeEndingTail();
        return;
      }
      endingTailActiveRef.current = true;
      endingTailRemainingMsRef.current = duration;
      setIsPlaying(true);
      setProgress(1);

      const music = musicRef.current;
      if (music) {
        const alreadyElapsed = ENDING_TAIL_MS - duration;
        music.volume = endingTailMusicVolume(
          MUSIC_VOLUME,
          alreadyElapsed / ENDING_TAIL_MS,
        );
        void music.play().catch(() => {});
      }

      const started = Date.now();
      endingFadeIntervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - started;
        const remaining = Math.max(0, duration - elapsed);
        endingTailRemainingMsRef.current = remaining;
        const fadeProgress = 1 - remaining / ENDING_TAIL_MS;
        if (musicRef.current) {
          musicRef.current.volume = endingTailMusicVolume(MUSIC_VOLUME, fadeProgress);
        }
        if (remaining <= 0) completeEndingTail();
      }, 50);
    },
    [clearEndingFade, completeEndingTail],
  );

  const scheduleHideControls = useCallback(() => {
    if (hideControlsTimerRef.current != null) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = window.setTimeout(() => {
      if (isPlayingRef.current) setControlsVisible(false);
    }, 3200);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  const advanceOrFinish = useCallback(() => {
    const next = indexRef.current + 1;
    if (next < scenes.length) {
      setIndex(next);
      setProgress(0);
      setImageFailed(false);
      speakSceneRef.current?.(next);
    } else {
      beginEndingTail(ENDING_TAIL_MS);
    }
  }, [scenes.length, beginEndingTail]);

  /**
   * Play scene i using the pre-generated narration file (same audio as the
   * phone app). No device-TTS fallback — that sounded faster and desynced time.
   */
  const speakScene = useCallback(
    (i: number) => {
      const scene = scenes[i];
      const el = narrationElRef.current;
      if (!scene || !el) return;

      const token = ++sceneTokenRef.current;
      cancelEndingTail();
      clearEndingFade();
      setProgress(0);
      setIsPlaying(true);
      setFinished(false);
      showControls();

      if (musicRef.current?.paused) {
        void musicRef.current.play().catch(() => {});
      }

      el.onended = null;
      el.ontimeupdate = null;
      el.onerror = null;
      el.pause();

      const url = scene.audio_url;
      if (!url) {
        // No narration file — hold the scene; user can skip via progress segments.
        console.warn(`[StoryPlayer] scene ${i} has no audio_url`);
        setIsPlaying(false);
        setProgress(1);
        return;
      }

      el.src = url;
      el.playbackRate = rateRef.current;
      try {
        (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      } catch {
        /* older WebKit */
      }

      el.ontimeupdate = () => {
        if (sceneTokenRef.current !== token) return;
        if (el.duration > 0) {
          setProgress(Math.min(1, el.currentTime / el.duration));
        }
      };
      el.onended = () => {
        if (sceneTokenRef.current !== token) return;
        setProgress(1);
        advanceOrFinish();
      };
      el.onerror = () => {
        if (sceneTokenRef.current !== token) return;
        console.error(`[StoryPlayer] narration failed to load for scene ${i}`);
        setIsPlaying(false);
        showControls();
      };

      const start = () => {
        if (sceneTokenRef.current !== token) return;
        el.playbackRate = rateRef.current;
        void el.play().then(
          () => {
            if (sceneTokenRef.current !== token) return;
            // Re-assert rate after play — WebKit sometimes resets it.
            el.playbackRate = rateRef.current;
          },
          (err: unknown) => {
            if (sceneTokenRef.current !== token) return;
            const name =
              err && typeof err === "object" && "name" in err
                ? String((err as { name: string }).name)
                : "";
            console.warn("[StoryPlayer] play() blocked or failed", name || err);
            setIsPlaying(false);
            showControls();
          },
        );
      };

      if (el.readyState >= 2) start();
      else {
        const onReady = () => {
          el.removeEventListener("loadeddata", onReady);
          start();
        };
        el.addEventListener("loadeddata", onReady);
        el.load();
      }
    },
    [scenes, cancelEndingTail, clearEndingFade, showControls, advanceOrFinish],
  );
  speakSceneRef.current = speakScene;

  const play = useCallback(() => {
    if (scenes.length === 0) return;
    unlockAudio();

    if (endingTailActiveRef.current) {
      beginEndingTail(endingTailRemainingMsRef.current);
      showControls();
      return;
    }

    const el = narrationElRef.current;
    // True resume: same scene audio, paused mid-file.
    if (
      el &&
      el.src &&
      el.paused &&
      !el.ended &&
      el.currentTime > 0 &&
      Number.isFinite(el.duration)
    ) {
      el.playbackRate = rateRef.current;
      setIsPlaying(true);
      setFinished(false);
      void el.play().catch(() => setIsPlaying(false));
      void musicRef.current?.play().catch(() => {});
      showControls();
      return;
    }

    speakScene(indexRef.current);
  }, [scenes.length, speakScene, showControls, beginEndingTail, unlockAudio]);

  const pause = useCallback(() => {
    if (endingTailActiveRef.current) {
      clearEndingFade();
      musicRef.current?.pause();
      setIsPlaying(false);
      showControls();
      return;
    }
    // Pause in place — do not bump sceneTokenRef or tear down src.
    narrationElRef.current?.pause();
    musicRef.current?.pause();
    setIsPlaying(false);
    showControls();
  }, [clearEndingFade, showControls]);

  const toggle = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const setPlaybackRateIndex = useCallback((nextIndex: number) => {
    const clamped = ((nextIndex % RATES.length) + RATES.length) % RATES.length;
    setRateIndex(clamped);
    const rate = RATES[clamped];
    rateRef.current = rate;
    if (narrationElRef.current) {
      narrationElRef.current.playbackRate = rate;
    }
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(i, scenes.length - 1));
      setIndex(clamped);
      setProgress(0);
      setImageFailed(false);
      setFinished(false);
      cancelEndingTail();
      if (isPlayingRef.current) {
        speakScene(clamped);
      } else {
        sceneTokenRef.current++;
        stopNarrationElement();
        setIsPlaying(false);
      }
      showControls();
    },
    [scenes.length, speakScene, cancelEndingTail, stopNarrationElement, showControls],
  );

  const replay = useCallback(() => {
    setFinished(false);
    setIndex(0);
    setProgress(0);
    setImageFailed(false);
    sceneTokenRef.current++;
    stopNarrationElement();
    cancelEndingTail();
    setIsPlaying(false);
    setShowDedication(true);
  }, [stopNarrationElement, cancelEndingTail]);

  const startAfterDedication = useCallback(() => {
    unlockAudio();
    setShowDedication(false);
    // Defer one frame so the dedication unmounts, then start inside the
    // same user-gesture turn (still sync enough for iOS after unlock).
    window.setTimeout(() => play(), 0);
  }, [play, unlockAudio]);

  useEffect(() => {
    if (!showDedication) return;
    if (isCoarsePointerDevice()) return;
    const timer = window.setTimeout(() => startAfterDedication(), 4500);
    return () => window.clearTimeout(timer);
  }, [showDedication, startAfterDedication]);

  useEffect(() => {
    if (!story.music_url) return;
    const audio = new Audio();
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = MUSIC_VOLUME;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.src = story.music_url;
    musicRef.current = audio;
    return () => {
      audio.pause();
      musicRef.current = null;
    };
  }, [story.music_url]);

  useEffect(() => {
    return () => {
      sceneTokenRef.current++;
      stopNarrationElement();
      clearEndingFade();
      musicRef.current?.pause();
      if (hideControlsTimerRef.current != null) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [stopNarrationElement, clearEndingFade]);

  useEffect(() => {
    const urls = [
      ...(scenes[index]?.shots?.map((s) => s.url) ?? []),
      scenes[index]?.image_url,
      ...(scenes[index + 1]?.shots?.map((s) => s.url) ?? []),
      scenes[index + 1]?.image_url,
    ].filter((u): u is string => !!u);
    urls.forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  }, [scenes, index]);

  useEffect(() => {
    setImageFailed(false);
  }, [activeImage]);

  useEffect(() => {
    if (!story.referral_slug || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("ref") === story.referral_slug) return;
    url.searchParams.set("ref", story.referral_slug);
    window.history.replaceState({}, "", url);
  }, [story.referral_slug]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(getFullscreenElement() === shellRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsImmersive(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const expanded = isFullscreen || isImmersive;

  useEffect(() => {
    if (!isImmersive) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [isImmersive]);

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (getFullscreenElement() || isImmersive) {
        if (getFullscreenElement()) await exitDocumentFullscreen();
        setIsImmersive(false);
        return;
      }
      if (prefersPortraitCssFullscreen()) {
        setIsImmersive(true);
        return;
      }
      await requestElementFullscreen(shell);
      if (getFullscreenElement() !== shell) {
        setIsImmersive(true);
      }
    } catch {
      setIsImmersive(true);
    }
  }, [isImmersive]);

  if (!current) {
    return (
      <div className="player-stage">
        <div className="player-shell centered">
          <p className="muted">This story has no scenes yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`player-stage${expanded ? " is-expanded" : ""}`}>
      <div
        className={`player-shell${isImmersive ? " immersive" : ""}`}
        ref={shellRef}
      >
        {/* Persistent narration element — more reliable pause/resume on iOS than new Audio(). */}
        <audio
          ref={narrationElRef}
          playsInline
          preload="auto"
          className="narration-audio"
        />

        <div
          className={`cinema${expanded ? " is-expanded" : ""}`}
          onClick={() => {
            if (showDedication || finished) return;
            if (!isPlayingRef.current) {
              play();
              return;
            }
            if (controlsVisible) setControlsVisible(false);
            else showControls();
          }}
        >
          {activeImage && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={activeImage}
              src={activeImage}
              alt={current.title || story.title || "Story scene"}
              className="scene-image"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="scene-placeholder" aria-hidden />
          )}

          {current.motion_video_url && isPlaying && (
            <video
              key={current.motion_video_url}
              className="scene-motion"
              src={current.motion_video_url}
              autoPlay
              muted
              loop
              playsInline
              disablePictureInPicture
              controlsList="nofullscreen"
            />
          )}

          <div className="cinema-veil top" />
          <div className="cinema-veil bottom" />

          <header
            className={`chrome top-chrome ${
              !showDedication && (controlsVisible || !isPlaying) ? "visible" : "hidden"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="brand-mark">Kinora</div>
            <div className="scene-meta">
              <span>
                {story.title || current.title}
                {story.child_name ? ` · ${story.child_name}` : ""}
              </span>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={(e) => {
                e.stopPropagation();
                setPlaybackRateIndex(rateIndex + 1);
              }}
              aria-label="Change playback speed"
            >
              {RATES[rateIndex] === 1 ? "1x" : `${RATES[rateIndex]}x`}
            </button>
          </header>

          <div
            className={`chrome center-chrome ${
              !showDedication && (controlsVisible || !isPlaying) ? "visible" : "hidden"
            }`}
          >
            <button
              type="button"
              className="play-fab"
              onClick={(e) => {
                e.stopPropagation();
                if (finished) replay();
                else toggle();
              }}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>
          </div>

          <footer
            className={`chrome bottom-chrome ${
              !showDedication && (controlsVisible || !isPlaying) ? "visible" : "hidden"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="caption">{sanitizeForSpeech(current.text)}</p>
            <div className="progress-row">
              <span className="clock">{formatClockTime(elapsedDurationMs)}</span>
              <div className="progress-track" aria-hidden>
                {scenes.map((_, i) => {
                  const fill = i < index ? 1 : i === index ? progress : 0;
                  return (
                    <button
                      key={i}
                      type="button"
                      className="progress-seg"
                      onClick={() => goTo(i)}
                      aria-label={`Go to scene ${i + 1}`}
                    >
                      <span style={{ width: `${fill * 100}%` }} />
                    </button>
                  );
                })}
              </div>
              <span className="clock">{formatClockTime(totalDurationMs)}</span>
              <span className="counter">
                {index + 1}/{scenes.length}
              </span>
            </div>
          </footer>

          {story.show_watermark && !finished && !showDedication && (
            <div className="watermark" aria-hidden>
              <span>Kinora</span>
            </div>
          )}
        </div>

        {showDedication && !finished && (
          <DedicationCard
            childName={story.child_name}
            recipients={story.dedication?.recipients ?? []}
            note={story.dedication?.note ?? null}
            onBegin={startAfterDedication}
          />
        )}

        {finished && <EndCard onReplay={replay} />}

        <button
          type="button"
          className="fullscreen-btn"
          onClick={(e) => {
            e.stopPropagation();
            showControls();
            void toggleFullscreen();
          }}
          aria-label={expanded ? "Exit full screen" : "Full screen"}
          title={expanded ? "Exit full screen" : "Full screen"}
        >
          {expanded ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path
                d="M9 3v2H5.8L9 8.2 7.6 9.6 4 6V9H2V3h7Zm6 0h7v6h-2V6l-3.6 3.6L15 8.2 18.2 5H15V3ZM4 15h2v3.2L9.2 15l1.4 1.4L7 20h3v2H3v-7Zm13.6-1.4L21 17.2V14h2v7h-7v-2h3.2L14.6 15l1.4-1.4Z"
                fill="currentColor"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path
                d="M3 3h7v2H5.8L9 8.2 7.6 9.6 4 6v4.2H2V3h1Zm12 0h7v7h-2V5.8L15.8 9 14.4 7.6 18 4h-3V3ZM3 14h2v4.2L8.2 15l1.4 1.4L6 20h4.2v2H3v-8Zm16 0h2v8h-8v-2H18l-3.2-3.2 1.4-1.4L20 18.2V14Z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
