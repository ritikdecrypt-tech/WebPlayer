import type { ShotType } from "./types";

/** One direction of the ping-pong breath. Slightly quicker than the app's 10s so a typical shot still completes a zoom-in and zoom-out. */
export const KEN_BURNS_DURATION_MS = 7000;

export type KenBurnsPreset = {
  scale: [number, number];
  x: [number, number];
  y: [number, number];
};

/**
 * Same per-shot Ken Burns presets as kidz/src/components/CrossfadeIllustration.tsx.
 * scale/x/y are fractions of the layer size; x/y of [0,0] is zoom-only.
 */
export const KEN_BURNS_PRESETS: Record<ShotType, KenBurnsPreset> = {
  wide_establishing: { scale: [1.06, 1.16], x: [0, 0], y: [0, 0] },
  extreme_wide: { scale: [1.04, 1.13], x: [0, 0], y: [0, 0] },
  close_up: { scale: [1.05, 1.1], x: [0, 0], y: [0, 0] },
  extreme_close_up: { scale: [1.02, 1.06], x: [0, 0], y: [0, 0] },
  over_shoulder: { scale: [1.1, 1.16], x: [-0.035, 0.035], y: [0, 0] },
  low_angle_scale: { scale: [1.06, 1.14], x: [0, 0], y: [-0.03, 0.03] },
  ultra_wide_action: { scale: [1.08, 1.18], x: [-0.045, 0.045], y: [0, 0] },
  detail_vignette: { scale: [1.02, 1.06], x: [0, 0], y: [0, 0] },
  wide: { scale: [1.06, 1.16], x: [0, 0], y: [0, 0] },
  medium: { scale: [1.1, 1.16], x: [-0.035, 0.035], y: [0, 0] },
  close: { scale: [1.05, 1.1], x: [0, 0], y: [0, 0] },
};

export function kenBurnsPreset(shotType: ShotType | string | undefined): KenBurnsPreset {
  if (shotType && shotType in KEN_BURNS_PRESETS) {
    return KEN_BURNS_PRESETS[shotType as ShotType];
  }
  return KEN_BURNS_PRESETS.wide_establishing;
}
