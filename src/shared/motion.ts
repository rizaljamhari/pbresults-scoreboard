/**
 * One motion model for everything that animates on the overlay. Each animated thing stores
 * `{ preset, durationMs, easing, delayMs }`; how it plays (once, looping, or swapping old content for new) belongs to
 * that thing, not to the setting. Keyframes live in the overlay stylesheet as `motion-<preset>` (enter) and
 * `motion-<preset>-loop` (enter, hold, leave).
 */

export const motionPresetValues = ["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "drop-in", "glide-in", "scale"] as const;
export type MotionPreset = (typeof motionPresetValues)[number];

export const motionEasingValues = ["ease", "linear", "ease-in", "ease-out", "ease-in-out", "snappy", "expo-out"] as const;
export type MotionEasing = (typeof motionEasingValues)[number];

export type MotionSettings = {
  preset: MotionPreset;
  durationMs: number;
  easing: MotionEasing;
  delayMs: number;
};

export const motionPresetLabels: Record<MotionPreset, string> = {
  none: "None",
  fade: "Fade",
  "slide-up": "Slide up",
  "slide-down": "Slide down",
  "slide-left": "Slide left",
  "slide-right": "Slide right",
  "drop-in": "Drop in",
  "glide-in": "Glide in",
  scale: "Scale"
};

export const motionEasingLabels: Record<MotionEasing, string> = {
  ease: "Ease",
  linear: "Linear",
  "ease-in": "Ease in",
  "ease-out": "Ease out",
  "ease-in-out": "Ease in-out",
  snappy: "Snappy",
  "expo-out": "Strong ease out"
};

const easingCss: Record<MotionEasing, string> = {
  ease: "ease",
  linear: "linear",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  snappy: "cubic-bezier(0, 0, 0.2, 1)",
  "expo-out": "cubic-bezier(0.16, 1, 0.3, 1)"
};

export function motionEasingCss(easing: MotionEasing) {
  return easingCss[easing];
}

/** Total time the motion takes, including its delay. */
export function motionTotalMs(motion: MotionSettings) {
  return motion.preset === "none" ? 0 : motion.durationMs + motion.delayMs;
}

/** Plays the preset once, as content arrives. */
export function motionEnter(motion: MotionSettings): string | undefined {
  if (motion.preset === "none") {
    return undefined;
  }
  const delay = motion.delayMs > 0 ? ` ${motion.delayMs}ms both` : "";
  return `motion-${motion.preset} ${motion.durationMs}ms ${easingCss[motion.easing]}${delay}`;
}

/** Plays the preset backwards, as content leaves. The delay is skipped: leaving should never wait. */
export function motionLeave(motion: MotionSettings): string | undefined {
  if (motion.preset === "none") {
    return undefined;
  }
  return `motion-${motion.preset} ${motion.durationMs}ms ${easingCss[motion.easing]} reverse`;
}

/** Enters, holds and leaves, over and over, while something stays on screen (the event cards). */
export function motionLoop(motion: MotionSettings): string | undefined {
  if (motion.preset === "none") {
    return undefined;
  }
  const delay = motion.delayMs > 0 ? ` ${motion.delayMs}ms` : "";
  return `motion-${motion.preset}-loop ${motion.durationMs}ms ${easingCss[motion.easing]}${delay} infinite alternate`;
}

/**
 * Old content leaving and new content arriving at the same time (team switch). The outgoing half runs the preset
 * backwards with `ease-out`: a reversed animation also reverses its easing, so it accelerates away.
 */
export function motionSwap(motion: MotionSettings): { out: string; in: string } | null {
  if (motion.preset === "none") {
    return null;
  }
  return {
    out: `motion-${motion.preset} ${motion.durationMs}ms ease-out reverse both`,
    in: `motion-${motion.preset} ${motion.durationMs}ms ${easingCss[motion.easing]}${motion.delayMs > 0 ? ` ${motion.delayMs}ms` : ""} both`
  };
}

/** Plain-language summary, e.g. "Fade, 250 ms" — used by Rehearsal and the editor. */
export function describeMotion(motion: MotionSettings) {
  if (motion.preset === "none") {
    return "no motion";
  }
  const delay = motion.delayMs > 0 ? ` after ${motion.delayMs} ms` : "";
  return `${motionPresetLabels[motion.preset].toLowerCase()}, ${motion.durationMs} ms${delay}`;
}
