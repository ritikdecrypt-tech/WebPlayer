"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  sceneCount: number;
  index: number;
  /** 0..1 progress through the current scene. */
  progress: number;
  onSeek: (index: number, withinRatio: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
};

/**
 * Continuous scrub bar matching the native VideoProgressBar: drag anywhere
 * on the story timeline, including backward and into the middle of a scene.
 */
export default function StoryProgressBar({
  sceneCount,
  index,
  progress,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const overallRatio = sceneCount > 0 ? (index + progress) / sceneCount : 0;
  const displayRatio = dragRatio ?? overallRatio;

  const ratioFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return displayRatio;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return displayRatio;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [displayRatio]);

  const commit = useCallback(
    (clientX: number) => {
      const ratio = ratioFromClientX(clientX);
      const count = Math.max(1, sceneCount);
      const sceneUnits = ratio * count;
      const nextIndex = Math.max(0, Math.min(count - 1, Math.floor(sceneUnits)));
      const withinRatio = Math.max(0, Math.min(1, sceneUnits - nextIndex));
      onSeek(nextIndex, withinRatio);
    },
    [onSeek, ratioFromClientX, sceneCount],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart?.();
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    commit(event.clientX);
    setDragRatio(null);
    onScrubEnd?.();
  };

  return (
    <div
      className="progress-scrub"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="slider"
      aria-label="Story position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(displayRatio * 100)}
    >
      <div className="progress-track-bar" ref={trackRef}>
        <div className="progress-fill" style={{ width: `${displayRatio * 100}%` }} />
        <div className="progress-thumb" style={{ left: `${displayRatio * 100}%` }} />
      </div>
    </div>
  );
}
