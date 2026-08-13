"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SharedStory } from "@/lib/types";
import {
  estimateSpeechDurationMs,
  formatClockTime,
  sanitizeForSpeech,
} from "@/lib/playback";
import EndCard from "@/components/EndCard";

const MUSIC_VOLUME = 0.22;
const RATES = [0.85, 1, 1.15] as const;

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

type Props = {
  story: SharedStory;
};

export default function StoryPlayer({ story }: Props) {
  const scenes = story.scenes;
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rateIndex, setRateIndex] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const rateRef = useRef<number>(RATES[1]);
  const speakGenRef = useRef(0);

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

  const teardownNarration = useCallback(() => {
    const audio = narrationRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      narrationRef.current = null;
    }
    stopSpeech();
    clearProgressTimer();
  }, [clearProgressTimer, stopSpeech]);

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
      setIsPlaying(false);
      setFinished(true);
      setProgress(1);
      if (musicRef.current) musicRef.current.pause();
    }
  }, [scenes.length]);

  const speakWithDeviceTts = useCallback(
    (text: string, gen: number) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        // No TTS available — advance after estimated duration
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
      setProgress(0);
      setIsPlaying(true);
      setFinished(false);
      showControls();

      if (musicRef.current && musicRef.current.paused) {
        musicRef.current.play().catch(() => {});
      }

      const spoken = sanitizeForSpeech(scene.text);

      if (scene.audio_url) {
        const audio = new Audio(scene.audio_url);
        audio.playbackRate = rateRef.current;
        narrationRef.current = audio;

        audio.ontimeupdate = () => {
          if (speakGenRef.current !== gen) return;
          if (audio.duration > 0) {
            setProgress(Math.min(1, audio.currentTime / audio.duration));
          }
        };
        audio.onended = () => {
          if (speakGenRef.current !== gen) return;
          setProgress(1);
          advanceOrFinish();
        };
        audio.onerror = () => {
          if (speakGenRef.current !== gen) return;
          console.warn("[StoryPlayer] narration audio failed — falling back to TTS");
          speakWithDeviceTts(spoken, gen);
        };
        audio.play().catch(() => {
          if (speakGenRef.current !== gen) return;
          speakWithDeviceTts(spoken, gen);
        });
        return;
      }

      speakWithDeviceTts(spoken, gen);
    },
    [scenes, teardownNarration, showControls, advanceOrFinish, speakWithDeviceTts],
  );

  speakSceneRef.current = speakScene;

  const play = useCallback(() => {
    if (scenes.length === 0) return;
    if (
      narrationRef.current &&
      narrationRef.current.paused &&
      !narrationRef.current.ended
    ) {
      setIsPlaying(true);
      setFinished(false);
      narrationRef.current.play().catch(() => {});
      musicRef.current?.play().catch(() => {});
      showControls();
      return;
    }
    speakScene(indexRef.current);
  }, [scenes.length, speakScene, showControls]);

  const pause = useCallback(() => {
    speakGenRef.current++;
    narrationRef.current?.pause();
    stopSpeech();
    clearProgressTimer();
    musicRef.current?.pause();
    setIsPlaying(false);
    showControls();
  }, [stopSpeech, clearProgressTimer, showControls]);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

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
        setIsPlaying(false);
      }
      showControls();
    },
    [scenes.length, speakScene, teardownNarration, showControls],
  );

  const replay = useCallback(() => {
    setFinished(false);
    setIndex(0);
    setProgress(0);
    setImageFailed(false);
    speakScene(0);
  }, [speakScene]);

  // Background music
  useEffect(() => {
    if (!story.music_url) return;
    const audio = new Audio(story.music_url);
    audio.loop = true;
    audio.volume = MUSIC_VOLUME;
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

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (getFullscreenElement()) {
        await exitDocumentFullscreen();
      } else {
        await requestElementFullscreen(shell);
      }
    } catch {
      // Browser denied or the user dismissed the prompt — stay in page view.
    }
  }, []);

  if (!current) {
    return (
      <div className="player-shell centered">
        <p className="muted">This story has no scenes yet.</p>
      </div>
    );
  }

  return (
    <div className="player-shell" ref={shellRef}>
      <div
        className="cinema"
        onClick={() => {
          if (!isPlaying && !finished) {
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
          className={`chrome top-chrome ${controlsVisible || !isPlaying ? "visible" : "hidden"}`}
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
            onClick={() => setRateIndex((r) => (r + 1) % RATES.length)}
            aria-label="Change playback speed"
          >
            {RATES[rateIndex]}x
          </button>
          <button
            type="button"
            className="ghost-btn fullscreen-btn"
            onClick={() => {
              showControls();
              void toggleFullscreen();
            }}
            aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
          >
            {isFullscreen ? "Exit" : "Full Screen"}
          </button>
        </header>

        <div
          className={`chrome center-chrome ${controlsVisible || !isPlaying ? "visible" : "hidden"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="play-fab"
            onClick={() => {
              if (finished) replay();
              else toggle();
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
        </div>

        <footer
          className={`chrome bottom-chrome ${controlsVisible || !isPlaying ? "visible" : "hidden"}`}
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

        {story.show_watermark && !finished && (
          <div className="watermark" aria-hidden>
            Kinora
          </div>
        )}
      </div>

      {finished && <EndCard childName={story.child_name} />}
    </div>
  );
}
