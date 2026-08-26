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
/** Playback speed options — index 1 is normal (1x). Never auto-advance this. */
const RATES = [0.85, 1, 1.15] as const;
const DEFAULT_RATE_INDEX = 1;

function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse), (hover: none)").matches;
}

/** Fresh Audio element tuned for iOS Safari (autoplay + inline playback). */
function createNarrationAudio(url: string, rate: number): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  // iOS treats media without playsinline more like fullscreen video and can
  // block/interrupt programmatic pause/play.
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.src = url;
  // Apply rate after metadata so WebKit doesn't drop or clamp the value.
  const applyRate = () => {
    audio.playbackRate = rate;
    try {
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    } catch {
      /* older WebKit */
    }
  };
  if (audio.readyState >= 1) applyRate();
  else audio.addEventListener("loadedmetadata", applyRate, { once: true });
  return audio;
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

/** Phones: CSS portrait overlay instead of native Fullscreen (which often rotates to landscape). */
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

  const shellRef = useRef<HTMLDivElement | null>(null);
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const rateRef = useRef<number>(RATES[DEFAULT_RATE_INDEX]);
  const speakGenRef = useRef(0);
  /** Generation id belonging to the active narration HTMLAudioElement — pause must NOT bump this or ontimeupdate/onended die after resume (iOS play/pause break). */
  const narrationGenRef = useRef(0);
  const usingTtsRef = useRef(false);
  const audioUnlockedRef = useRef(false);
  const endingFadeIntervalRef = useRef<number | null>(null);
  const endingTailActiveRef = useRef(false);
  const endingTailRemainingMsRef = useRef(ENDING_TAIL_MS);

  indexRef.current = index;
  isPlayingRef.current = isPlaying;
  rateRef.current = RATES[rateIndex];

  const current = scenes[index] ?? null;
  const shotCount = current?.shots?.length || (current?.image_url ? 1 : 0);
  const shotIndex =
    shotCount > 0 ? Math.min(shotCount - 1, Math.floor(progress * shotCount)) : 0;
  const activeImage =
    current?.shots?.[shotIndex]?.url ?? current?.image_url ?? null;

  const sceneDurationsMs = useMemo(
    () => scenes.map((s) => estimateSpeechDurationMs(s.text, RATES[rateIndex])),
    [scenes, rateIndex],
  );
  const totalDurationMs = sceneDurationsMs.reduce((sum, d) => sum + d, 0);
  const elapsedDurationMs =
    sceneDurationsMs.slice(0, index).reduce((sum, d) => sum + d, 0) +
    progress * (sceneDurationsMs[index] ?? 0);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current != null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const stopSpeech = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    speechUtteranceRef.current = null;
  }, []);

  const clearEndingFade = useCallback(() => {
    if (endingFadeIntervalRef.current != null) {
      window.clearInterval(endingFadeIntervalRef.current);
      endingFadeIntervalRef.current = null;
    }
  }, []);

  const teardownNarration = useCallback(() => {
    const audio = narrationRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      narrationRef.current = null;
    }
    narrationGenRef.current = -1;
    usingTtsRef.current = false;
    stopSpeech();
    clearProgressTimer();
    clearEndingFade();
  }, [clearProgressTimer, stopSpeech, clearEndingFade]);

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

  /** Prime HTMLAudio + speechSynthesis inside a real user gesture (required on iOS Safari). */
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;

    const music = musicRef.current;
    if (music) {
      const prevVol = music.volume;
      music.volume = 0;
      music.play()
        .then(() => {
          music.pause();
          music.currentTime = 0;
          music.volume = prevVol || MUSIC_VOLUME;
        })
        .catch(() => {
          music.volume = prevVol || MUSIC_VOLUME;
        });
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        const warm = new SpeechSynthesisUtterance(" ");
        warm.volume = 0;
        warm.rate = 1;
        window.speechSynthesis.speak(warm);
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
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

  const beginEndingTail = useCallback((remainingMs: number = ENDING_TAIL_MS) => {
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
      music.volume = endingTailMusicVolume(MUSIC_VOLUME, alreadyElapsed / ENDING_TAIL_MS);
      music.play().catch(() => {});
    }

    const started = Date.now();
    endingFadeIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const remaining = Math.max(0, duration - elapsed);
      endingTailRemainingMsRef.current = remaining;
      const progress = 1 - remaining / ENDING_TAIL_MS;
      if (musicRef.current) {
        musicRef.current.volume = endingTailMusicVolume(MUSIC_VOLUME, progress);
      }
      if (remaining <= 0) completeEndingTail();
    }, 50);
  }, [clearEndingFade, completeEndingTail]);

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
      // speakScene is defined below; call via ref pattern after declaration
      speakSceneRef.current?.(next);
    } else {
      beginEndingTail(ENDING_TAIL_MS);
    }
  }, [scenes.length, beginEndingTail]);

  const speakWithDeviceTts = useCallback(
    (text: string, gen: number) => {
      usingTtsRef.current = true;
      if (typeof window === "undefined" || !window.speechSynthesis) {
        const duration = estimateSpeechDurationMs(text, rateRef.current);
        const started = Date.now();
        progressTimerRef.current = window.setInterval(() => {
          if (speakGenRef.current !== gen) return;
          const ratio = Math.min(1, (Date.now() - started) / duration);
          setProgress(ratio);
          if (ratio >= 1) {
            clearProgressTimer();
            advanceOrFinish();
          }
        }, 100);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rateRef.current;
      utterance.lang = "en-US";
      speechUtteranceRef.current = utterance;

      const duration = estimateSpeechDurationMs(text, rateRef.current);
      const started = Date.now();
      progressTimerRef.current = window.setInterval(() => {
        if (speakGenRef.current !== gen) return;
        setProgress(Math.min(0.99, (Date.now() - started) / duration));
      }, 100);

      utterance.onend = () => {
        if (speakGenRef.current !== gen) return;
        clearProgressTimer();
        setProgress(1);
        advanceOrFinish();
      };
      utterance.onerror = () => {
        if (speakGenRef.current !== gen) return;
        clearProgressTimer();
        setIsPlaying(false);
      };

      window.speechSynthesis.speak(utterance);
    },
    [advanceOrFinish, clearProgressTimer],
  );

  const speakSceneRef = useRef<((i: number) => void) | null>(null);

  const speakScene = useCallback(
    (i: number) => {
      const scene = scenes[i];
      if (!scene) return;

      const gen = ++speakGenRef.current;
      teardownNarration();
      cancelEndingTail();
      usingTtsRef.current = false;
      setProgress(0);
      setIsPlaying(true);
      setFinished(false);
      showControls();

      if (musicRef.current && musicRef.current.paused) {
        musicRef.current.play().catch(() => {});
      }

      const spoken = sanitizeForSpeech(scene.text);

      if (scene.audio_url) {
        const audio = createNarrationAudio(scene.audio_url, rateRef.current);
        narrationRef.current = audio;
        narrationGenRef.current = gen;

        audio.ontimeupdate = () => {
          // Use narrationGenRef so pause/resume does not kill progress updates.
          if (narrationGenRef.current !== gen) return;
          if (audio.duration > 0) {
            setProgress(Math.min(1, audio.currentTime / audio.duration));
          }
        };
        audio.onended = () => {
          if (narrationGenRef.current !== gen) return;
          setProgress(1);
          advanceOrFinish();
        };
        audio.onerror = () => {
          if (narrationGenRef.current !== gen) return;
          console.warn("[StoryPlayer] narration audio failed — falling back to TTS");
          speakWithDeviceTts(spoken, gen);
        };
        void audio.play().then(
          () => {
            // Ensure rate stuck at the chosen value after play starts (WebKit quirk).
            audio.playbackRate = rateRef.current;
          },
          (err: unknown) => {
            if (narrationGenRef.current !== gen) return;
            const name =
              err && typeof err === "object" && "name" in err
                ? String((err as { name: string }).name)
                : "";
            // Autoplay blocked — leave the play button ready; do NOT swap to
            // TTS (speechSynthesis is also gesture-gated and sounds too fast
            // on many iPhones).
            if (name === "NotAllowedError") {
              setIsPlaying(false);
              showControls();
              return;
            }
            console.warn("[StoryPlayer] narration play failed — falling back to TTS", err);
            speakWithDeviceTts(spoken, gen);
          },
        );
        return;
      }

      speakWithDeviceTts(spoken, gen);
    },
    [scenes, teardownNarration, showControls, advanceOrFinish, speakWithDeviceTts, cancelEndingTail],
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
    if (
      narrationRef.current &&
      narrationRef.current.paused &&
      !narrationRef.current.ended &&
      !usingTtsRef.current
    ) {
      setIsPlaying(true);
      setFinished(false);
      narrationRef.current.playbackRate = rateRef.current;
      void narrationRef.current.play().catch(() => {
        // Still blocked — keep UI on play so the user can try again.
        setIsPlaying(false);
      });
      musicRef.current?.play().catch(() => {});
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
    // HTML narration: pause in place. Do NOT bump speakGenRef / narrationGenRef
    // or ontimeupdate/onended become dead after resume (classic iOS "play does
    // nothing" / stuck-at-end bug).
    if (narrationRef.current && !usingTtsRef.current) {
      narrationRef.current.pause();
      musicRef.current?.pause();
      setIsPlaying(false);
      showControls();
      return;
    }
    // TTS path cannot true-pause on iOS — cancel and restart on next play.
    speakGenRef.current++;
    stopSpeech();
    clearProgressTimer();
    clearEndingFade();
    musicRef.current?.pause();
    setIsPlaying(false);
    showControls();
  }, [stopSpeech, clearProgressTimer, clearEndingFade, showControls]);

  const toggle = useCallback(() => {
    // Read the ref so rapid double-taps on iOS don't both see the same stale
    // React state and no-op / double-flip.
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const setPlaybackRateIndex = useCallback((nextIndex: number) => {
    const clamped = ((nextIndex % RATES.length) + RATES.length) % RATES.length;
    setRateIndex(clamped);
    const rate = RATES[clamped];
    rateRef.current = rate;
    if (narrationRef.current) {
      narrationRef.current.playbackRate = rate;
    }
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(i, scenes.length - 1));
      setIndex(clamped);
      setProgress(0);
      setImageFailed(false);
      setFinished(false);
      if (isPlayingRef.current) speakScene(clamped);
      else {
        teardownNarration();
        cancelEndingTail();
        setIsPlaying(false);
      }
      showControls();
    },
    [scenes.length, speakScene, teardownNarration, cancelEndingTail, showControls],
  );

  const replay = useCallback(() => {
    setFinished(false);
    setIndex(0);
    setProgress(0);
    setImageFailed(false);
    teardownNarration();
    cancelEndingTail();
    setIsPlaying(false);
    setShowDedication(true);
  }, [teardownNarration, cancelEndingTail]);

  const startAfterDedication = useCallback(() => {
    unlockAudio();
    setShowDedication(false);
    play();
  }, [play, unlockAudio]);

  // Desktop only: auto-advance past the dedication. On phones (esp. iOS
  // Safari) autoplay without a tap is blocked — keep "Tap to begin".
  useEffect(() => {
    if (!showDedication) return;
    if (isCoarsePointerDevice()) return;
    const timer = window.setTimeout(() => startAfterDedication(), 4500);
    return () => window.clearTimeout(timer);
  }, [showDedication, startAfterDedication]);

  // Background music
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      teardownNarration();
      musicRef.current?.pause();
      if (hideControlsTimerRef.current != null) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [teardownNarration]);

  // Prefetch nearby images
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

  // Keep the share/referral slug in the address bar for the whole playback
  // session so the End Card CTA and any copied URL still carry it. The
  // slug is the story's unique share short_code — same value track-referral
  // looks up — and is also present on the inbound share URL as `?ref=`.
  useEffect(() => {
    if (!story.referral_slug || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("ref") === story.referral_slug) return;
    url.searchParams.set("ref", story.referral_slug);
    window.history.replaceState({}, "", url);
  }, [story.referral_slug]);

  // Native Fullscreen API only — never request on load, story start, or URL open.
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
      // Mobile: stay in portrait and fill the phone. Native Fullscreen API
      // often forces landscape and is unreliable on iOS for non-video nodes.
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
