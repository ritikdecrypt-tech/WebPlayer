"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SharedStory } from "@/lib/types";
import {
  estimateSpeechDurationMs,
  formatClockTime,
  sanitizeForSpeech,
} from "@/lib/playback";
import { ENDING_TAIL_MS, endingTailMusicVolume } from "@/lib/endingCue";
import {
  APP_NARRATION_RATE,
  applyMediaPlaybackRate,
  playMediaAtRate,
} from "@/lib/narrationPlayback";
import EndCard from "@/components/EndCard";
import DedicationCard from "@/components/DedicationCard";
import StoryProgressBar from "@/components/StoryProgressBar";
import CrossfadeIllustration from "@/components/CrossfadeIllustration";

const MUSIC_VOLUME = 0.22;

function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse), (hover: none)").matches;
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

function prepareMediaElement(el: HTMLMediaElement) {
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.setAttribute("x-webkit-airplay", "deny");
  try {
    (el as HTMLMediaElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
  } catch {
    /* ignore */
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
  const [imageFailed, setImageFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [showDedication, setShowDedication] = useState(true);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const narrationElRef = useRef<HTMLVideoElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const isPlayingRef = useRef(false);
  /** Bumped when we intentionally replace/tear down narration (seek, new scene, unmount) — not on pause. */
  const sceneTokenRef = useRef(0);
  const audioUnlockedRef = useRef(false);
  const endingFadeIntervalRef = useRef<number | null>(null);
  const endingTailActiveRef = useRef(false);
  const endingTailRemainingMsRef = useRef(ENDING_TAIL_MS);
  const speakSceneRef = useRef<((i: number, withinRatio?: number) => void) | null>(null);
  const pendingSeekRef = useRef<{ index: number; withinRatio: number } | null>(null);
  /** Debounce touch+click double-firing on iOS. */
  const lastToggleAtRef = useRef(0);

  indexRef.current = index;
  isPlayingRef.current = isPlaying;

  const current = scenes[index] ?? null;
  // Same storyboard timing as PlayerSu/Mu/Bi: split the real narration
  // (currentTime/duration) evenly across every shot in this scene, in the
  // order story_pages.shot_sequence assigned. A single leftover image_url
  // is only used when the scene predates multi-shot.
  const shotCount = current?.shots?.length || (current?.image_url ? 1 : 0);
  const shotIndex =
    shotCount > 0 ? Math.min(shotCount - 1, Math.floor(progress * shotCount)) : 0;
  const activeImage =
    current?.shots?.[shotIndex]?.url ?? current?.image_url ?? null;
  const activeShotType =
    current?.shots?.[shotIndex]?.type ?? "wide_establishing";

  // Same clock math as PlayerSu/Mu/Bi at the app's locked 0.85x default.
  const sceneDurationsMs = useMemo(
    () => scenes.map((s) => estimateSpeechDurationMs(s.text, APP_NARRATION_RATE)),
    [scenes],
  );
  const totalDurationMs = sceneDurationsMs.reduce((sum, d) => sum + d, 0);
  const elapsedDurationMs =
    sceneDurationsMs.slice(0, index).reduce((sum, d) => sum + d, 0) +
    progress * (sceneDurationsMs[index] ?? 0);
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
    el.onplaying = null;
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

  const pauseAllMedia = useCallback(() => {
    narrationElRef.current?.pause();
    musicRef.current?.pause();
    clearEndingFade();
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, [clearEndingFade]);

  /** Mark media as unlocked by the user gesture. Do not pause in a later
   *  callback — that races the real play() and causes a silent first scene. */
  const unlockAudio = useCallback(() => {
    audioUnlockedRef.current = true;
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
      setControlsVisible(false);
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
      speakSceneRef.current?.(next, 0);
    } else {
      beginEndingTail(ENDING_TAIL_MS);
    }
  }, [scenes.length, beginEndingTail]);

  /**
   * Stream the same signed narration MP3 the phone app plays, at the same
   * 0.85x (pitch-preserved). Play immediately — do not wait to decode the
   * whole file.
   */
  const speakScene = useCallback(
    (i: number, withinRatio = 0) => {
      const scene = scenes[i];
      const el = narrationElRef.current;
      if (!scene || !el) return;

      const token = ++sceneTokenRef.current;
      pendingSeekRef.current = null;
      cancelEndingTail();
      clearEndingFade();
      setProgress(Math.max(0, Math.min(1, withinRatio)));
      setIsPlaying(true);
      isPlayingRef.current = true;
      setFinished(false);

      const music = musicRef.current;
      if (music) {
        music.volume = MUSIC_VOLUME;
        music.playbackRate = 1;
        void music.play().catch(() => {});
      }

      const url = scene.audio_url;
      if (!url) {
        console.warn(`[StoryPlayer] scene ${i} has no audio_url`);
        setIsPlaying(false);
        isPlayingRef.current = false;
        setProgress(1);
        return;
      }

      el.onended = null;
      el.ontimeupdate = null;
      el.onplaying = null;
      el.onerror = null;

      el.ontimeupdate = () => {
        if (sceneTokenRef.current !== token) return;
        if (Math.abs(el.playbackRate - APP_NARRATION_RATE) > 0.01) {
          applyMediaPlaybackRate(el, APP_NARRATION_RATE);
        }
        if (el.duration > 0) {
          setProgress(Math.min(1, el.currentTime / el.duration));
        }
      };
      el.onplaying = () => {
        if (sceneTokenRef.current !== token) return;
        applyMediaPlaybackRate(el, APP_NARRATION_RATE);
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
        isPlayingRef.current = false;
        showControls();
      };

      const start = () => {
        if (sceneTokenRef.current !== token) return;
        if (withinRatio > 0 && Number.isFinite(el.duration) && el.duration > 0) {
          try {
            el.currentTime = withinRatio * el.duration;
          } catch {
            /* iOS can throw if not seekable yet */
          }
        }
        void playMediaAtRate(el, APP_NARRATION_RATE).then(
          () => {
            if (sceneTokenRef.current !== token) return;
            applyMediaPlaybackRate(el, APP_NARRATION_RATE);
          },
          (err: unknown) => {
            if (sceneTokenRef.current !== token) return;
            const name =
              err && typeof err === "object" && "name" in err
                ? String((err as { name: string }).name)
                : "";
            console.warn("[StoryPlayer] play() blocked or failed", name || err);
            setIsPlaying(false);
            isPlayingRef.current = false;
            showControls();
          },
        );
      };

      const alreadyThisFile = el.getAttribute("src") === url;
      if (!alreadyThisFile) {
        el.src = url;
        applyMediaPlaybackRate(el, APP_NARRATION_RATE);
      }

      if (withinRatio > 0 && el.readyState < 1) {
        const onMeta = () => {
          el.removeEventListener("loadedmetadata", onMeta);
          start();
        };
        el.addEventListener("loadedmetadata", onMeta);
        el.load();
      } else {
        start();
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
      return;
    }

    const pending = pendingSeekRef.current;
    if (pending) {
      pendingSeekRef.current = null;
      speakScene(pending.index, pending.withinRatio);
      return;
    }

    const el = narrationElRef.current;
    // True resume: same scene audio, paused mid-file.
    if (
      el &&
      el.getAttribute("src") &&
      el.paused &&
      !el.ended &&
      el.currentTime > 0 &&
      Number.isFinite(el.duration)
    ) {
      applyMediaPlaybackRate(el, APP_NARRATION_RATE);
      setIsPlaying(true);
      isPlayingRef.current = true;
      setFinished(false);
      void playMediaAtRate(el, APP_NARRATION_RATE).then(
        () => applyMediaPlaybackRate(el, APP_NARRATION_RATE),
        () => {
          setIsPlaying(false);
          isPlayingRef.current = false;
        },
      );
      if (musicRef.current) {
        musicRef.current.volume = MUSIC_VOLUME;
        musicRef.current.playbackRate = 1;
        void musicRef.current.play().catch(() => {});
      }
      return;
    }

    speakScene(indexRef.current, 0);
  }, [scenes.length, speakScene, beginEndingTail, unlockAudio]);

  const pause = useCallback(() => {
    if (endingTailActiveRef.current) {
      clearEndingFade();
      musicRef.current?.pause();
      setIsPlaying(false);
      isPlayingRef.current = false;
      showControls();
      return;
    }
    narrationElRef.current?.pause();
    musicRef.current?.pause();
    setIsPlaying(false);
    isPlayingRef.current = false;
    showControls();
  }, [clearEndingFade, showControls]);

  const toggle = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const goTo = useCallback(
    (i: number, withinRatio = 0) => {
      const clamped = Math.max(0, Math.min(i, scenes.length - 1));
      const ratio = Math.max(0, Math.min(1, withinRatio));
      setIndex(clamped);
      setProgress(ratio);
      setImageFailed(false);
      setFinished(false);
      cancelEndingTail();
      if (isPlayingRef.current) {
        speakScene(clamped, ratio);
      } else {
        pendingSeekRef.current = { index: clamped, withinRatio: ratio };
        const el = narrationElRef.current;
        const url = scenes[clamped]?.audio_url;
        if (el && url && el.getAttribute("src") === url && el.duration > 0) {
          try {
            el.currentTime = ratio * el.duration;
          } catch {
            /* ignore */
          }
        }
        setIsPlaying(false);
      }
      showControls();
    },
    [scenes, speakScene, cancelEndingTail, showControls],
  );

  const replay = useCallback(() => {
    setFinished(false);
    setIndex(0);
    setProgress(0);
    setImageFailed(false);
    pendingSeekRef.current = null;
    sceneTokenRef.current++;
    stopNarrationElement();
    cancelEndingTail();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setShowDedication(true);
  }, [stopNarrationElement, cancelEndingTail]);

  /** iOS fires both touchend and click — debounce so we don't play then immediately pause. */
  const handlePlayFabPress = useCallback(
    (e: React.SyntheticEvent) => {
      e.stopPropagation();
      const now = Date.now();
      if (now - lastToggleAtRef.current < 350) return;
      lastToggleAtRef.current = now;
      if (finished) replay();
      else toggle();
    },
    [finished, toggle, replay],
  );

  const startAfterDedication = useCallback(() => {
    unlockAudio();
    setShowDedication(false);
    // MUST stay synchronous with the tap — setTimeout breaks iOS's user-gesture
    // token and Safari then blocks audio.play().
    play();
  }, [play, unlockAudio]);

  useEffect(() => {
    if (!showDedication) return;
    if (isCoarsePointerDevice()) return;
    const timer = window.setTimeout(() => startAfterDedication(), 4500);
    return () => window.clearTimeout(timer);
  }, [showDedication, startAfterDedication]);

  useEffect(() => {
    const music = musicRef.current;
    if (!music) return;
    music.volume = MUSIC_VOLUME;
    music.playbackRate = 1;
    music.defaultPlaybackRate = 1;
    prepareMediaElement(music);
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
    const halt = () => {
      pauseAllMedia();
    };
    const onVisibility = () => {
      if (document.hidden) halt();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", halt);
    document.addEventListener("freeze", halt);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", halt);
      document.removeEventListener("freeze", halt);
    };
  }, [pauseAllMedia]);

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
    const next = scenes[index + 1]?.audio_url;
    if (!next) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "audio";
    link.href = next;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
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

  const handleImageError = useCallback(() => setImageFailed(true), []);
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
        {/* Hidden video: streams the same MP3 as the app. Video+playsInline is
            how iOS Safari honors playbackRate at 0.85 without changing pitch. */}
        <video
          ref={(el) => {
            narrationElRef.current = el;
            if (el) prepareMediaElement(el);
          }}
          playsInline
          preload="auto"
          disablePictureInPicture
          className="narration-audio"
          aria-hidden
        />
        {story.music_url ? (
          <audio
            ref={(el) => {
              musicRef.current = el;
              if (el) {
                prepareMediaElement(el);
                el.volume = MUSIC_VOLUME;
                el.playbackRate = 1;
                el.defaultPlaybackRate = 1;
              }
            }}
            src={story.music_url}
            loop
            preload="auto"
            playsInline
            className="narration-audio"
            aria-hidden
          />
        ) : null}

        <div
          className={`cinema${expanded ? " is-expanded" : ""}`}
          onClick={() => {
            if (showDedication || finished) return;
            if (controlsVisible) setControlsVisible(false);
            else showControls();
          }}
        >
          <CrossfadeIllustration
            imageUrl={activeImage && !imageFailed ? activeImage : null}
            variant={index % 5}
            shotType={activeShotType}
            objectFit={expanded ? "contain" : "cover"}
            onError={handleImageError}
          />

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
              !showDedication && controlsVisible ? "visible" : "hidden"
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
          </header>

          <div
            className={`chrome center-chrome ${
              !showDedication && controlsVisible ? "visible" : "hidden"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="play-fab"
              onPointerUp={handlePlayFabPress}
              onClick={handlePlayFabPress}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>
          </div>

          <div
            className={`caption-layer ${
              !showDedication && !finished ? "visible" : "hidden"
            } ${controlsVisible ? "with-controls" : ""}`}
          >
            <p className="caption">{sanitizeForSpeech(current.text)}</p>
          </div>

          <footer
            className={`chrome bottom-chrome ${
              !showDedication && controlsVisible ? "visible" : "hidden"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="progress-row">
              <span className="clock">{formatClockTime(elapsedDurationMs)}</span>
              <StoryProgressBar
                sceneCount={scenes.length}
                index={index}
                progress={progress}
                onSeek={(i, withinRatio) => goTo(i, withinRatio)}
                onScrubStart={() => {
                  if (hideControlsTimerRef.current != null) {
                    window.clearTimeout(hideControlsTimerRef.current);
                  }
                  setControlsVisible(true);
                }}
                onScrubEnd={scheduleHideControls}
              />
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
