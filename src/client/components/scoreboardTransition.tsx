import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { TransitionSettings } from "../../shared/theme";

/**
 * Show and Hide for the whole scoreboard.
 *
 * With the transition on, Show sweeps a band across the screen. The scoreboard's plates appear behind its trailing
 * edge (a clip on the stage that moves with the band), and the contents start building in once the band is
 * `contentsStart` percent of the way through, still only showing where the band has passed. Hide fades the contents, then
 * plays the sweep backwards so the band covers the plates as it goes. Pressing the other button part-way through
 * turns the sweep round from where it is.
 *
 * With the transition off, Show replays each piece's own entrance and Hide plays each piece's own exit.
 */
export type ScoreboardPhase =
  | "shown"
  | "hidden"
  /** The band is sweeping in, uncovering the plates. */
  | "entering"
  /** Contents are building in, behind the band if it is still finishing its sweep. */
  | "building"
  /** Contents are fading out before the band comes back. */
  | "leaving-contents"
  /** The band is sweeping back, covering the plates. */
  | "leaving-wipe"
  /** Transition off: each piece plays its own exit. */
  | "leaving-plain";

/** The edge block's pace, which the stage's clip follows: it sets off late and fast, and lands softly. */
const SWEEP_EASING = "cubic-bezier(0.55, 0, 0.25, 1)";
/** The colour strip starts slower than the text, overtakes it in the middle and leaves first. */
const STRIP_EASING = "cubic-bezier(0.6, 0, 0.3, 1)";
/** The text keeps a steadier pace than the colour around it. */
const TEXT_EASING = "cubic-bezier(0.3, 0.15, 0.55, 0.9)";
/** How long contents take to fade out on Hide before the band returns. */
export const CONTENTS_OUT_MS = 200;
/** The edge block's width, as a share of the canvas. */
const EDGE_SHARE = 0.1;
/** How far past the screen the strip travels, so it clears the screen before the text does. */
const STRIP_OVERSHOOT = 0.25;
/** How far behind the others the edge block starts, so the text and colour arrive first and it uncovers last. */
const EDGE_LAG = 0.8;

/** The running sweep, and which way it is heading now (reverse() turns it round). */
type Sweep = { animations: Animation[]; stage: Animation; forward: boolean };

type LayerName = "strip" | "text" | "edge";

/** Where the band runs: its left side and width on the canvas. Full screen is the whole canvas width. */
export type BandArea = { left: number; width: number };

/**
 * Where each band layer travels across the band's own area, as the left edge of a layer `width` px wide (text is as
 * wide as its content, so it uses percentages of itself). Left to right, each layer starts just off the area's left
 * and ends off its right; right to left mirrors that. The stage's clip, in canvas pixels, follows the edge block's
 * trailing side.
 */
export function bandSweepFrames(direction: TransitionSettings["direction"], area: BandArea, canvasWidth: number) {
  const W = area.width;
  const edge = Math.round(W * EDGE_SHARE);
  const across = (from: number, to: number) => [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }];
  // A layer w px wide whose left edge goes from x to y, seen in a mirror.
  const mirrored = (from: number, to: number, w: number) => across(W - from - w, W - to - w);
  const edgeStart = Math.round(-edge - W * EDGE_LAG);
  const layers: Record<LayerName, { frames: Keyframe[]; easing: string }> =
    direction === "left-to-right"
      ? {
          strip: { frames: across(-W, Math.round(W * (1 + STRIP_OVERSHOOT))), easing: STRIP_EASING },
          text: { frames: [{ transform: "translateX(-100%)" }, { transform: `translateX(${W}px)` }], easing: TEXT_EASING },
          edge: { frames: across(edgeStart, W), easing: SWEEP_EASING }
        }
      : {
          strip: { frames: mirrored(-W, Math.round(W * (1 + STRIP_OVERSHOOT)), W), easing: STRIP_EASING },
          text: { frames: [{ transform: `translateX(${W}px)` }, { transform: "translateX(-100%)" }], easing: TEXT_EASING },
          edge: { frames: mirrored(edgeStart, W, edge), easing: SWEEP_EASING }
        };
  // Clipped from the side the band comes from, in step with the edge block's trailing side, until it has crossed the
  // band's area. Insets wider than the canvas just mean fully clipped.
  const stage: Keyframe[] =
    direction === "left-to-right"
      ? [{ clipPath: `inset(0 ${canvasWidth - area.left - edgeStart}px 0 0)` }, { clipPath: `inset(0 ${canvasWidth - area.left - W}px 0 0)` }]
      : [{ clipPath: `inset(0 0 0 ${area.left + W - edgeStart}px)` }, { clipPath: `inset(0 0 0 ${area.left}px)` }];
  return { layers, stage, edgeWidth: edge };
}

/**
 * Ends a sweep. The band is hidden first: its layers snap back to the band's edge when their animations are
 * cancelled, and React only hides the band on its next render, so for a frame the band would show standing still.
 */
export function releaseSweep(
  sweep: { animations: Array<Pick<Animation, "cancel">>; stage: Pick<Animation, "cancel"> },
  band: { style: { display: string } } | null
) {
  if (band) band.style.display = "none";
  sweep.animations.forEach((animation) => animation.cancel());
  sweep.stage.cancel();
}

export function useScoreboardTransition({
  visible,
  settings,
  reduceMotion,
  buildMs,
  plainExitMs,
  canvasWidth,
  bandArea,
  stageRef,
  bandRef
}: {
  visible: boolean;
  settings: TransitionSettings;
  /** The band is not drawn yet when a sweep starts, so its size comes in rather than being measured. */
  canvasWidth: number;
  bandArea: BandArea;
  reduceMotion: boolean;
  /** How long the contents take to build in once the band has passed. */
  buildMs: number;
  /** The longest piece exit, for Hide with the transition off. */
  plainExitMs: number;
  stageRef: RefObject<HTMLDivElement | null>;
  bandRef: RefObject<HTMLDivElement | null>;
}) {
  const [phase, setPhase] = useState<ScoreboardPhase>(visible ? "shown" : "hidden");
  /** The band is moving; it can still be finishing after the contents have started building. */
  const [bandMoving, setBandMoving] = useState(false);
  /** Goes up each time Show should replay the pieces' own entrances (transition off). */
  const [plainShowRun, setPlainShowRun] = useState(0);
  const phaseRef = useRef(phase);
  const sweepRef = useRef<Sweep | null>(null);
  const timerRef = useRef<number | null>(null);
  const previousVisibleRef = useRef(visible);
  const latest = useRef({ buildMs, plainExitMs, settings, canvasWidth, bandArea });
  latest.current = { buildMs, plainExitMs, settings, canvasWidth, bandArea };

  function go(next: ScoreboardPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function after(ms: number, next: () => void) {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      next();
    }, ms);
  }

  function stopSweep() {
    const sweep = sweepRef.current;
    sweepRef.current = null;
    if (sweep) releaseSweep(sweep, bandRef.current);
    setBandMoving(false);
  }

  /** Builds the contents in; with `keepBand`, the band carries on to the end of its sweep meanwhile. */
  function startBuilding(keepBand = false) {
    if (!keepBand) stopSweep();
    go("building");
    after(latest.current.buildMs, () => go("shown"));
  }

  /** Starts the build once the forward sweep reaches the theme's Contents start point. */
  function scheduleBuild(sweep: Sweep) {
    const { sweepMs, contentsStart } = latest.current.settings;
    if (contentsStart >= 100) return;
    const progress = sweep.stage.effect?.getComputedTiming().progress ?? 0;
    after(Math.max(0, (contentsStart / 100 - progress) * sweepMs), () => {
      if (sweepRef.current === sweep && sweep.forward) startBuilding(true);
    });
  }

  function finishHidden() {
    // Hide the stage before the clip lets go, so the plates never flash back for a frame.
    if (stageRef.current) stageRef.current.style.visibility = "hidden";
    stopSweep();
    go("hidden");
  }

  /** Starts the band, forwards for Show or backwards for Hide. Without the Web Animations API it cuts. */
  function startSweep(forward: boolean) {
    stopSweep();
    const band = bandRef.current;
    const stage = stageRef.current;
    // A hidden page (a switched-off OBS source, a background tab) pauses animations, so it cuts to the end instead.
    if (!band || !stage || typeof band.animate !== "function" || document.visibilityState === "hidden") {
      if (forward) startBuilding();
      else finishHidden();
      return;
    }
    // Matches what React draws while the band sweeps; stopSweep may have hidden it by hand.
    band.style.display = "block";
    setBandMoving(true);
    const { direction, sweepMs } = latest.current.settings;
    const plan = bandSweepFrames(direction, latest.current.bandArea, latest.current.canvasWidth);
    const timing = (easing: string): KeyframeAnimationOptions => ({
      duration: sweepMs,
      easing,
      fill: "both",
      direction: forward ? "normal" : "reverse"
    });
    const animations = [...band.querySelectorAll<HTMLElement>("[data-band-layer]")].map((layer) => {
      const { frames, easing } = plan.layers[layer.dataset.bandLayer as LayerName];
      return layer.animate(frames, timing(easing));
    });
    const sweep: Sweep = { animations, stage: stage.animate(plan.stage, timing(SWEEP_EASING)), forward };
    sweepRef.current = sweep;
    sweep.stage.onfinish = () => {
      if (sweepRef.current !== sweep) return;
      if (!sweep.forward) finishHidden();
      // The build may already be running behind the band; then only the band is let go.
      else if (phaseRef.current === "entering") startBuilding();
      else stopSweep();
    };
    if (forward) scheduleBuild(sweep);
  }

  /** Turns a running sweep round from where it is. */
  function turnSweep() {
    const sweep = sweepRef.current;
    if (!sweep) return false;
    sweep.animations.forEach((animation) => animation.reverse());
    sweep.stage.reverse();
    sweep.forward = !sweep.forward;
    return true;
  }

  useLayoutEffect(() => {
    if (previousVisibleRef.current === visible) return;
    previousVisibleRef.current = visible;
    clearTimer();
    const current = phaseRef.current;

    if (reduceMotion) {
      stopSweep();
      go(visible ? "shown" : "hidden");
      return;
    }

    if (!latest.current.settings.enabled) {
      stopSweep();
      if (visible) {
        go("shown");
        setPlainShowRun((run) => run + 1);
      } else {
        go("leaving-plain");
        after(latest.current.plainExitMs, () => go("hidden"));
      }
      return;
    }

    if (visible) {
      if (current === "leaving-contents") {
        startBuilding();
      } else if (current === "leaving-wipe" && turnSweep()) {
        go("entering");
        scheduleBuild(sweepRef.current!);
      } else if (current === "hidden" || current === "leaving-plain" || current === "leaving-wipe") {
        go("entering");
        startSweep(true);
      }
    } else if (current === "building" && sweepRef.current?.forward && turnSweep()) {
      // Hide just after Show, while the band is still finishing: it turns round and covers what has built so far.
      go("leaving-wipe");
    } else if (current === "shown" || current === "building") {
      go("leaving-contents");
      after(CONTENTS_OUT_MS, () => {
        go("leaving-wipe");
        startSweep(false);
      });
    } else if (current === "entering" && turnSweep()) {
      go("leaving-wipe");
    } else if (current === "entering") {
      finishHidden();
    }
    // Only a Show or Hide starts anything; the other values are read when it happens.
  }, [visible]);

  // Leaving the page mid-sweep must not leave timers or animations behind.
  useEffect(
    () => () => {
      clearTimer();
      stopSweep();
    },
    []
  );

  return { phase, plainShowRun, bandMoving };
}

/** A darker shade of a hex colour, for the strip's tail. Anything else is returned as it is. */
export function darkerShade(color: string, amount = 0.55) {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 || hex.length === 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return color;
  const channel = (index: number) => Math.round(parseInt(full.slice(index, index + 2), 16) * (1 - amount)).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}${full.slice(6)}`;
}

/**
 * The band that sweeps across on Show and Hide, in three layers that travel at their own pace: a colour strip that
 * fades in from a darker tail, the text (with the event logo) over the video, and a narrow edge block that uncovers
 * the scoreboard. An image from the library replaces the strip and text.
 */
export function TransitionBand({
  bandRef,
  settings,
  active,
  top,
  height,
  left,
  width,
  text,
  logoUrl,
  imageUrl
}: {
  bandRef: RefObject<HTMLDivElement | null>;
  settings: TransitionSettings;
  /** Only drawn while it sweeps. */
  active: boolean;
  top: number;
  height: number;
  /** Where the band runs on the canvas: the whole width, or the scoreboard's. */
  left: number;
  width: number;
  text: string;
  logoUrl: string | null;
  imageUrl: string | null;
}) {
  const filterId = `band-blur-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // The strip's tail trails behind it, so it fades in from the side it comes from.
  const tailSide = settings.direction === "left-to-right" ? "to right" : "to left";
  const edgeWidth = Math.round(width * EDGE_SHARE);
  const style: CSSProperties = {
    top,
    height,
    left,
    width,
    display: active ? "block" : "none",
    ...(settings.motionBlur ? { filter: `url(#${filterId})` } : {})
  };
  return (
    <>
      {settings.motionBlur ? (
        <svg className="transition-band-defs" width="0" height="0" aria-hidden>
          <filter id={filterId} x="-5%" y="0" width="110%" height="100%">
            <feGaussianBlur stdDeviation="6 0" />
          </filter>
        </svg>
      ) : null}
      <div ref={bandRef} className="transition-band" style={style} aria-hidden>
        {imageUrl ? (
          <img data-band-layer="strip" className="transition-band-layer transition-band-image" src={imageUrl} alt="" style={{ width }} />
        ) : (
          <>
            <span
              data-band-layer="strip"
              className="transition-band-layer"
              style={{
                width,
                // Only while it sweeps; it starts off screen, so the first frame never needs it.
                ...(active
                  ? { background: `linear-gradient(${tailSide}, transparent 0%, ${darkerShade(settings.bandColor)} 22%, ${settings.bandColor} 55%, ${settings.bandColor} 100%)` }
                  : {})
              }}
            />
            <span
              data-band-layer="text"
              className="transition-band-layer transition-band-text"
              style={{ color: settings.bandTextColor, fontFamily: `"${settings.bandFontFamily}", sans-serif`, fontSize: Math.round(height * 0.9) }}
            >
              {logoUrl ? <img className="transition-band-logo" src={logoUrl} alt="" style={{ height: height * 0.9 }} /> : null}
              {text}
            </span>
          </>
        )}
        <span data-band-layer="edge" className="transition-band-layer transition-band-edge" style={{ width: edgeWidth, background: settings.bandEdgeColor }}>
          <i style={{ background: settings.bandTextColor }} />
          <i style={{ background: settings.bandTextColor }} />
        </span>
      </div>
    </>
  );
}
