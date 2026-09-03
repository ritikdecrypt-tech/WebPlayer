"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShotType } from "@/lib/types";
import { KEN_BURNS_DURATION_MS, kenBurnsPreset } from "@/lib/kenBurns";

const CROSSFADE_MS = 550;
const SINE_IN_OUT = "cubic-bezier(0.37, 0, 0.63, 1)";

type ObjectFit = "cover" | "contain";

type LayerProps = {
  url: string | null;
  variant: number;
  shotType: ShotType;
  objectFit: ObjectFit;
  still?: boolean;
  onError?: () => void;
  onLoad?: () => void;
};

function pct(value: number): string {
  return `${value * 100}%`;
}

function KenBurnsLayer({
  url,
  variant,
  shotType,
  objectFit,
  still,
  onError,
  onLoad,
}: LayerProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const motionRef = useRef<HTMLDivElement | null>(null);
  const handledLoadRef = useRef(false);
  const lastUrlRef = useRef(url);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  if (lastUrlRef.current !== url) {
    lastUrlRef.current = url;
    handledLoadRef.current = false;
  }

  const notifyLoaded = useCallback(() => {
    if (handledLoadRef.current) return;
    handledLoadRef.current = true;
    onLoadRef.current?.();
  }, []);

  const motion = useMemo(() => {
    const preset = kenBurnsPreset(shotType);
    const panEnabled = objectFit === "cover";
    const mirror = variant % 2 === 1;
    const xFrom = panEnabled ? (mirror ? -preset.x[1] : preset.x[0]) : 0;
    const xTo = panEnabled ? (mirror ? -preset.x[0] : preset.x[1]) : 0;
    const yFrom = panEnabled ? preset.y[0] : 0;
    const yTo = panEnabled ? preset.y[1] : 0;
    const from = `translate(${pct(xFrom)}, ${pct(yFrom)}) scale(${preset.scale[0]})`;
    const to = `translate(${pct(xTo)}, ${pct(yTo)}) scale(${preset.scale[1]})`;
    const mid = `translate(${pct((xFrom + xTo) / 2)}, ${pct((yFrom + yTo) / 2)}) scale(${
      (preset.scale[0] + preset.scale[1]) / 2
    })`;
    return { from, to, mid };
  }, [shotType, objectFit, variant]);

  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) notifyLoaded();
  }, [url, notifyLoaded]);

  useEffect(() => {
    const el = motionRef.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (still) {
      el.style.transform = motion.mid;
      return;
    }
    el.style.transform = motion.from;
    const animation = el.animate(
      [
        { transform: motion.from, easing: SINE_IN_OUT },
        { transform: motion.to, easing: SINE_IN_OUT },
        { transform: motion.from },
      ],
      {
        duration: KEN_BURNS_DURATION_MS * 2,
        iterations: Infinity,
      },
    );
    animation.play();
    return () => {
      animation.cancel();
    };
  }, [url, still, motion]);

  if (!url) return null;

  return (
    <div ref={motionRef} className={`scene-kb ${still ? "is-still" : "is-live"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={url}
        alt=""
        className={`scene-image scene-image-${objectFit}`}
        onError={onError}
        onLoad={notifyLoaded}
      />
    </div>
  );
}

const MemoKenBurnsLayer = memo(KenBurnsLayer);

type Props = {
  imageUrl: string | null;
  variant: number;
  shotType: ShotType;
  objectFit?: ObjectFit;
  onError?: () => void;
};

/**
 * Web port of the app's CrossfadeIllustration: 550ms dissolve between shots,
 * plus a Ken Burns zoom/pan breath that must keep running for the whole scene.
 */
function CrossfadeIllustration({
  imageUrl,
  variant,
  shotType = "wide_establishing",
  objectFit = "cover",
  onError,
}: Props) {
  const [current, setCurrent] = useState<string | null>(imageUrl);
  const [currentVariant, setCurrentVariant] = useState(variant);
  const [currentShotType, setCurrentShotType] = useState(shotType);
  const [previous, setPrevious] = useState<string | null>(null);
  const [previousVariant, setPreviousVariant] = useState(variant);
  const [previousShotType, setPreviousShotType] = useState(shotType);
  const [incomingOpacity, setIncomingOpacity] = useState(1);
  const [fadeEnabled, setFadeEnabled] = useState(false);

  const currentRef = useRef(current);
  currentRef.current = current;
  const currentVariantRef = useRef(currentVariant);
  currentVariantRef.current = currentVariant;
  const currentShotTypeRef = useRef(currentShotType);
  currentShotTypeRef.current = currentShotType;
  const transitioningRef = useRef(false);
  const pendingRef = useRef<{ url: string; variant: number; shotType: ShotType } | null>(
    null,
  );
  const fadeTimerRef = useRef<number | null>(null);
  const loadFallbackRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (fadeTimerRef.current != null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (loadFallbackRef.current != null) {
      window.clearTimeout(loadFallbackRef.current);
      loadFallbackRef.current = null;
    }
  }, []);

  const finishFade = useCallback(
    (startNext: (url: string, v: number, st: ShotType) => void) => {
      setPrevious(null);
      transitioningRef.current = false;
      const next = pendingRef.current;
      if (next) {
        pendingRef.current = null;
        startNext(next.url, next.variant, next.shotType);
      }
    },
    [],
  );

  const startTransition = useCallback((url: string, v: number, st: ShotType) => {
    transitioningRef.current = true;
    setPrevious(currentRef.current);
    setPreviousVariant(currentVariantRef.current);
    setPreviousShotType(currentShotTypeRef.current);
    setCurrent(url);
    setCurrentVariant(v);
    setCurrentShotType(st);
    setFadeEnabled(false);
    setIncomingOpacity(0);
  }, []);

  const beginFadeIn = useCallback(() => {
    if (!transitioningRef.current) return;
    if (loadFallbackRef.current != null) {
      window.clearTimeout(loadFallbackRef.current);
      loadFallbackRef.current = null;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFadeEnabled(true);
        setIncomingOpacity(1);
      });
    });
    if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = window.setTimeout(() => {
      finishFade(startTransition);
    }, CROSSFADE_MS);
  }, [finishFade, startTransition]);

  useEffect(() => {
    if (imageUrl === currentRef.current) {
      pendingRef.current = null;
      return;
    }

    if (!imageUrl) {
      pendingRef.current = null;
      if (!currentRef.current) {
        setPrevious(null);
        setCurrent(null);
        setCurrentVariant(variant);
        setCurrentShotType(shotType);
        setIncomingOpacity(1);
        setFadeEnabled(false);
        transitioningRef.current = false;
      }
      return;
    }

    if (transitioningRef.current) {
      pendingRef.current = { url: imageUrl, variant, shotType };
      return;
    }

    pendingRef.current = null;
    startTransition(imageUrl, variant, shotType);
  }, [imageUrl, variant, shotType, startTransition]);

  useEffect(() => {
    if (!transitioningRef.current) return;
    loadFallbackRef.current = window.setTimeout(() => {
      beginFadeIn();
    }, 120);
    return () => {
      if (loadFallbackRef.current != null) {
        window.clearTimeout(loadFallbackRef.current);
        loadFallbackRef.current = null;
      }
    };
  }, [current, beginFadeIn]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  if (!current && !previous) {
    return <div className="scene-placeholder" aria-hidden />;
  }

  const fadeTransition = fadeEnabled ? `opacity ${CROSSFADE_MS}ms ease-in-out` : "none";

  return (
    <div className="scene-crossfade" aria-hidden>
      {previous ? (
        <div
          className="scene-fade-layer"
          style={{ opacity: 1 - incomingOpacity, transition: fadeTransition }}
        >
          <MemoKenBurnsLayer
            key={`prev-${previous}`}
            url={previous}
            variant={previousVariant}
            shotType={previousShotType}
            objectFit={objectFit}
            still
          />
        </div>
      ) : null}
      {current ? (
        <div
          className="scene-fade-layer"
          style={{ opacity: incomingOpacity, transition: fadeTransition }}
        >
          <MemoKenBurnsLayer
            key={`cur-${current}`}
            url={current}
            variant={currentVariant}
            shotType={currentShotType}
            objectFit={objectFit}
            still={false}
            onError={onError}
            onLoad={beginFadeIn}
          />
        </div>
      ) : null}
    </div>
  );
}

export default memo(CrossfadeIllustration);
