import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CLOCK_PULSE_ANIMATION,
  enterSequence,
  motionChange,
  motionEnter,
  motionExit,
  motionLeave,
  motionLoop,
  motionSwap,
  motionTotalMs,
  type ChangeMotionSettings,
  type MotionSettings
} from "../../shared/motion";
import { gradientCss, type FillSettings } from "../../shared/fill";
import { formatClock } from "../../shared/normalize";
import { dropShadowFilter } from "../../shared/shadow";
import type { NormalizedLiveState, StoredAsset, ThemeDefinition, ComponentId, TextEffectSettings, TextFitSettings } from "../../shared/theme";
import { VisibleContentImage } from "./VisibleContentImage";
import { FitText } from "./FitText";
import { useThemeFonts } from "./themeFonts";
import { themeFontFaces } from "../../shared/fonts";
import { useTimeoutToken } from "./momentTriggers";
import { TransitionBand, useScoreboardTransition } from "./scoreboardTransition";
import { movesWithPlacement, placeRect, placementTransform } from "../../shared/placement";

type OverlayRendererProps = {
  theme: ThemeDefinition;
  live: NormalizedLiveState | null;
  assets?: StoredAsset[];
  operatorTextValues?: Record<string, string>;
  editable?: boolean;
  /** Admin previews only: leave the canvas unpainted so what sits behind it shows through. Never used on air. */
  transparentBackground?: boolean;
  selectedComponentId?: string | null;
  onSelectComponent?: (id: string) => void;
  /** Editor only: show the timeout card without a feed jump, held on screen or as one full flash. Never used on air. */
  previewTimeout?: "hold" | "flash" | null;
  /** Operator switch: cut instead of animating (no change motion, pulses, swaps or looping event cards). */
  reduceMotion?: boolean;
  /** Editor only: play this piece's change motion again; a new token replays it. */
  replayChange?: { id: string; token: number } | null;
  /** A new value plays every piece's entrance again, built in with the theme's stagger (the operator's Play entrance). */
  entranceToken?: number | null;
  /**
   * The operator's Show / Hide. Changing it plays the theme's transition; left out, the scoreboard is always shown.
   * While hidden, moment and event cards stay hidden too.
   */
  scoreboardVisible?: boolean;
  /**
   * Draws the design at the theme's on-air placement: the live overlay, its preview, Operations, and the editor's
   * On air view. Left out, the design shows as built (the editor's Design view, theme thumbnails).
   */
  applyPlacement?: boolean;
};

type FramedPiece = Pick<ThemeDefinition["components"]["homeName"], "visible" | "opacity" | "enterMotion" | "exitMotion" | "x" | "width" | "zIndex">;

/** The event card's motion while motion is reduced: one short fade in, no loop. */
const CALM_CARD_MOTION: MotionSettings = { preset: "fade", durationMs: 200, easing: "ease", delayMs: 0 };

/** The event card loops its motion while on screen, or fades in once while motion is reduced. */
export function eventCardAnimation(motion: MotionSettings, reduceMotion: boolean) {
  return reduceMotion ? motionEnter(CALM_CARD_MOTION) : motionLoop(motion);
}

function withoutMotion<T extends { preset: string }>(motion: T): T {
  return { ...motion, preset: "none" };
}

/**
 * Which watched values changed in place since the last render. Nothing counts when the sides moved (a team change
 * or switch moves every value; the team switch animates that), and appearing or blanking is not a change.
 */
export function changedValues(before: Record<string, string>, now: Record<string, string>, sidesMoved: boolean): Array<[id: string, previous: string]> {
  if (sidesMoved) {
    return [];
  }
  return Object.entries(now)
    .filter(([id, value]) => before[id] !== undefined && before[id] !== "" && value !== "" && before[id] !== value)
    .map(([id]) => [id, before[id]]);
}

/**
 * The filter for an image's visible pixels: its drop shadow, and greying out when it applies (always, or for a team
 * logo once that team has lost).
 */
export function imageEffectFilter(effects: ThemeDefinition["components"]["eventLogo"]["imageEffects"], lost: boolean): string | undefined {
  const parts: string[] = [];
  const shadow = dropShadowFilter(effects.shadow);
  if (shadow) {
    parts.push(shadow);
  }
  if (effects.when === "always" || lost) {
    if (effects.grayscale > 0) parts.push(`grayscale(${effects.grayscale})`);
    if (effects.dim > 0) parts.push(`brightness(${Math.round((1 - effects.dim) * 100) / 100})`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

/** Wraps a clock's content in its last-seconds pulse. */
function pulsing(content: ReactNode, pulse: boolean) {
  return pulse ? <span className="clock-pulse" style={{ animation: CLOCK_PULSE_ANIMATION }}>{content}</span> : content;
}

type OverlaySnapshot = {
  state: string;
  period: string;
  round: number;
  sourceStatus: NormalizedLiveState["sourceStatus"];
  leftName: string;
  rightName: string;
  secondLeftName: string;
  secondRightName: string;
  leftScore: number;
  rightScore: number;
};

const TEAM_SWITCH_COOLDOWN_MS = 2200;

function resolveBackgroundPosition(position: ThemeDefinition["components"]["homeName"]["backgroundImagePosition"]) {
  switch (position) {
    case "top":
      return "center top";
    case "bottom":
      return "center bottom";
    case "left":
      return "left center";
    case "right":
      return "right center";
    default:
      return "center center";
  }
}

function resolveBackgroundSize(fit: ThemeDefinition["components"]["homeName"]["backgroundImageFit"]) {
  switch (fit) {
    case "contain":
      return "contain";
    case "stretch":
      return "100% 100%";
    default:
      return "cover";
  }
}

/** Letter case, shadow and outline; empty for a theme that uses none of them, so older themes render unchanged. */
function textLook(settings: TextFitSettings & TextEffectSettings): CSSProperties {
  const style: CSSProperties = {};
  if (settings.textTransform !== "none") {
    style.textTransform = settings.textTransform;
  }
  if (settings.textShadow.trim() && settings.textShadow.trim() !== "none") {
    style.textShadow = settings.textShadow;
  }
  if (settings.textStrokeWidth > 0) {
    // The stroke is centred on the letter edge and painted under the fill, so half of it shows: double it.
    style.WebkitTextStroke = `${settings.textStrokeWidth * 2}px ${settings.textStrokeColor}`;
    style.paintOrder = "stroke fill";
  }
  return style;
}

function frameStyles(
  component: Pick<
    ThemeDefinition["components"]["homeName"],
    "x" | "y" | "width" | "height" | "zIndex" | "opacity" | "visible" | "borderWidth" | "borderColor" | "borderRadius" | "shadow"
  > &
    Partial<Pick<ThemeDefinition["components"]["homeName"], "blendMode" | "backdropBlur">>
): CSSProperties {
  return {
    left: component.x,
    top: component.y,
    width: component.width,
    height: component.height,
    zIndex: component.zIndex,
    opacity: component.opacity,
    display: component.visible ? "flex" : "none",
    position: "absolute",
    border: `${component.borderWidth}px solid ${component.borderColor}`,
    borderRadius: `${component.borderRadius.map((v) => `${v}px`).join(" ")}`,
    boxShadow: component.shadow,
    overflow: "hidden",
    padding: 0,
    ...(component.blendMode && component.blendMode !== "normal" ? { mixBlendMode: component.blendMode } : {}),
    ...(component.backdropBlur ? { backdropFilter: `blur(${component.backdropBlur}px)` } : {})
  };
}

function surfaceStyles(
  component: Pick<
    ThemeDefinition["components"]["homeName"],
    | "backgroundColor"
    | "backgroundImageAssetId"
    | "backgroundImageFit"
    | "backgroundImagePosition"
    | "backgroundOverlayColor"
    | "backgroundOverlayOpacity"
  > & {
    backgroundImageMode?: "asset" | "homeTeamLogo" | "awayTeamLogo";
    fill?: FillSettings;
    tintFill?: FillSettings;
    backgroundOpacity?: number;
  },
  assets: StoredAsset[],
  theme: ThemeDefinition,
  live: NormalizedLiveState | null
): { background: CSSProperties; overlay: CSSProperties | null; opacity: number } {
  let backgroundAsset = null;
  if (component.backgroundImageMode === "homeTeamLogo") {
    backgroundAsset = resolveImageAsset("homeTeamLogo", theme.components.homeTeamLogo, theme, live, assets);
  } else if (component.backgroundImageMode === "awayTeamLogo") {
    backgroundAsset = resolveImageAsset("awayTeamLogo", theme.components.awayTeamLogo, theme, live, assets);
  } else {
    backgroundAsset = component.backgroundImageAssetId
      ? assets.find((asset) => asset.id === component.backgroundImageAssetId) ?? null
      : null;
  }

  const gradient = component.fill ? gradientCss(component.fill) : null;
  const tintGradient = component.tintFill ? gradientCss(component.tintFill) : null;
  // A gradient fill sits under the background image, as the solid colour does.
  const layers = [
    backgroundAsset
      ? { image: `url("${backgroundAsset.url}")`, size: resolveBackgroundSize(component.backgroundImageFit), position: resolveBackgroundPosition(component.backgroundImagePosition) }
      : null,
    gradient ? { image: gradient, size: "100% 100%", position: "center center" } : null
  ].filter((layer): layer is { image: string; size: string; position: string } => layer !== null);

  return {
    background: {
      backgroundColor: gradient ? "transparent" : component.backgroundColor,
      backgroundImage: layers.length ? layers.map((layer) => layer.image).join(", ") : undefined,
      backgroundSize: gradient ? layers.map((layer) => layer.size).join(", ") : backgroundAsset ? layers[0].size : undefined,
      backgroundPosition: gradient ? layers.map((layer) => layer.position).join(", ") : backgroundAsset ? layers[0].position : undefined,
      backgroundRepeat: "no-repeat"
    },
    overlay:
      component.backgroundOverlayOpacity > 0
        ? {
            background: tintGradient ?? component.backgroundOverlayColor,
            opacity: component.backgroundOverlayOpacity
          }
        : null,
    opacity: component.backgroundOpacity ?? 1
  };
}

/** The background and its tint, faded together so the content above keeps its own opacity. */
function SurfaceLayers({ surface }: { surface: ReturnType<typeof surfaceStyles> }) {
  return (
    <span className="component-surface-group" style={surface.opacity < 1 ? { opacity: surface.opacity } : undefined}>
      <span className="component-surface" style={surface.background} />
      {surface.overlay ? <span className="component-surface-overlay" style={surface.overlay} /> : null}
    </span>
  );
}

function imageStyles(component: ThemeDefinition["components"]["eventLogo"]): CSSProperties {
  return {
    ...frameStyles(component),
    display: component.visible ? "block" : "none"
  };
}

function resolveComponentPadding(component: Pick<ThemeDefinition["components"]["homeName"], "paddingX" | "paddingY">) {
  return `${component.paddingY}px ${component.paddingX}px`;
}

function resolveComponentOffset(component: Pick<ThemeDefinition["components"]["homeName"], "offsetX" | "offsetY">) {
  return {
    left: component.offsetX,
    top: component.offsetY
  } satisfies CSSProperties;
}

function resolveTextContent(theme: ThemeDefinition, componentId: ComponentId, live: NormalizedLiveState | null): string | null {
  if (!live) {
    return componentId === "breakTime" ? theme.centerSecondary.gameText || "Center Secondary" : componentId;
  }

  switch (componentId) {
    case "homeName":
      return live.displayLeftTeam.name || "HOME";
    case "homeScore":
      return String(live.displayLeftTeam.score ?? 0);
    case "awayName":
      return live.displayRightTeam.name || "AWAY";
    case "awayScore":
      return String(live.displayRightTeam.score ?? 0);
    case "gameTime":
      return formatClock(live.gameTimer.value);
    case "breakTime": {
      const mode = live.period === "BREAK" ? theme.centerSecondary.breakMode : theme.centerSecondary.gameMode;
      if (mode === "hidden") {
        return null;
      }
      if (mode === "timer") {
        return formatClock(live.breakTimer.value);
      }
      return live.period === "BREAK" ? theme.centerSecondary.breakText || "BREAK" : theme.centerSecondary.gameText || "";
    }
    default:
      return componentId;
  }
}

export function resolveCenterSecondaryPresentation(theme: ThemeDefinition, live: NormalizedLiveState | null) {
  if (!live) {
    return {
      content: theme.centerSecondary.gameText || "Center Secondary",
      variant: "staticText" as const
    };
  }

  const mode = live.period === "BREAK" ? theme.centerSecondary.breakMode : theme.centerSecondary.gameMode;
  if (mode === "hidden") {
    return {
      content: null,
      variant: "hidden" as const
    };
  }
  if (mode === "timer") {
    return {
      content: formatClock(live.breakTimer.value),
      variant: "timer" as const
    };
  }

  return {
    content: live.period === "BREAK" ? theme.centerSecondary.breakText || "BREAK" : theme.centerSecondary.gameText || "",
    variant: "staticText" as const
  };
}

function resolveImageAsset(
  componentId: ComponentId,
  component: ThemeDefinition["components"][ComponentId],
  theme: ThemeDefinition,
  live: NormalizedLiveState | null,
  assets: StoredAsset[]
) {
  const findAsset = (assetId: string | null | undefined) => (assetId ? assets.find((asset) => asset.id === assetId) ?? null : null);
  const resolveTeamLogoAsset = (teamAssetId: string | null | undefined, componentAssetId: string | null | undefined, fallbackMode: ThemeDefinition["components"]["homeTeamLogo"]["teamLogoFallbackMode"]) => {
    const registryAsset = findAsset(teamAssetId);
    if (registryAsset) {
      return registryAsset;
    }

    const slotFallbackAsset = findAsset(componentAssetId);
    const eventLogoAsset = findAsset(theme.components.eventLogo.assetId);

    switch (fallbackMode) {
      case "none":
        return null;
      case "eventLogo":
        return eventLogoAsset;
      case "slotFallbackThenEventLogo":
        return slotFallbackAsset ?? eventLogoAsset;
      case "slotFallback":
      default:
        return slotFallbackAsset;
    }
  };

  if (component.kind !== "image") {
    return null;
  }

  if (componentId === "eventLogo") {
    return findAsset(theme.components.eventLogo.assetId);
  }

  if (componentId === "homeTeamLogo") {
    const team = live?.displayLeftTeamMatch.team;
    return resolveTeamLogoAsset(team?.logoAssetId ?? team?.alternateLogoAssetId ?? null, component.assetId, component.teamLogoFallbackMode);
  }

  if (componentId === "awayTeamLogo") {
    const team = live?.displayRightTeamMatch.team;
    return resolveTeamLogoAsset(team?.logoAssetId ?? team?.alternateLogoAssetId ?? null, component.assetId, component.teamLogoFallbackMode);
  }

  return findAsset(component.assetId);
}

function mergeRects(
  first: Pick<ThemeDefinition["components"]["homeName"], "x" | "y" | "width" | "height">,
  second: Pick<ThemeDefinition["components"]["homeName"], "x" | "y" | "width" | "height"> | null
) {
  if (!second) {
    return {
      x: first.x,
      y: first.y,
      width: first.width,
      height: first.height
    };
  }

  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

function createOverlaySnapshot(live: NormalizedLiveState): OverlaySnapshot {
  const secondLeftName = Array.isArray(live.secondGame) ? live.secondGame[0]?.name ?? "" : "";
  const secondRightName = Array.isArray(live.secondGame) ? live.secondGame[1]?.name ?? "" : "";
  return {
    state: live.state,
    period: live.period,
    round: live.round,
    sourceStatus: live.sourceStatus,
    leftName: live.displayLeftTeam.name,
    rightName: live.displayRightTeam.name,
    secondLeftName,
    secondRightName,
    leftScore: Number(live.displayLeftTeam.score ?? 0),
    rightScore: Number(live.displayRightTeam.score ?? 0)
  };
}

function normalizedName(value: string) {
  return value.trim().toLowerCase();
}

function samePairUnordered(leftA: string, rightA: string, leftB: string, rightB: string) {
  return (leftA === leftB && rightA === rightB) || (leftA === rightB && rightA === leftB);
}

function winnerSideFromSnapshot(snapshot: OverlaySnapshot): "left" | "right" | null {
  if (snapshot.leftScore === snapshot.rightScore) {
    return null;
  }
  return snapshot.leftScore > snapshot.rightScore ? "left" : "right";
}

/** Where an event card sits for a team side; shared with the editor so the card can be selected and dragged. */
export function resolveEventLabelRect(
  side: "left" | "right",
  theme: ThemeDefinition,
  overlayGeneral: ThemeDefinition["teamEventOverlay"]["general"]
) {
  const logoComponent = side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
  const nameComponent = side === "left" ? theme.components.homeName : theme.components.awayName;

  if (overlayGeneral.followTarget === "logo" && logoComponent.visible) {
    const insetX = Math.max(0, logoComponent.paddingX);
    const insetY = Math.max(0, logoComponent.paddingY);
    const width = Math.max(1, logoComponent.width - insetX * 2);
    const height = Math.max(1, logoComponent.height - insetY * 2);
    return {
      x: logoComponent.x + insetX + logoComponent.offsetX,
      y: logoComponent.y + insetY + logoComponent.offsetY,
      width,
      height,
      borderRadius: logoComponent.borderRadius
    };
  }

  if (overlayGeneral.followTarget === "name" && nameComponent.visible) {
    return {
      x: nameComponent.x + nameComponent.paddingX + nameComponent.offsetX,
      y: nameComponent.y + nameComponent.paddingY + nameComponent.offsetY,
      width: Math.max(1, nameComponent.width - nameComponent.paddingX * 2),
      height: Math.max(1, nameComponent.height - nameComponent.paddingY * 2),
      borderRadius: nameComponent.borderRadius
    };
  }

  const group = mergeRects(nameComponent, logoComponent.visible ? logoComponent : null);
  const anchoredY =
    overlayGeneral.position === "above"
      ? group.y - overlayGeneral.height + overlayGeneral.offsetY
      : group.y + overlayGeneral.offsetY;

  if (overlayGeneral.placementMode === "full-panel") {
    return {
      x: group.x + overlayGeneral.offsetX,
      y: group.y + overlayGeneral.offsetY,
      width: group.width,
      height: group.height,
      borderRadius: overlayGeneral.borderRadius
    };
  }

  if (overlayGeneral.placementMode === "top-ribbon") {
    return {
      x: group.x + overlayGeneral.offsetX,
      y: anchoredY,
      width: group.width,
      height: overlayGeneral.height,
      borderRadius: overlayGeneral.borderRadius
    };
  }

  const width = Math.max(160, Math.min(group.width, Math.round(group.width * 0.76)));
  const x = group.x + Math.round((group.width - width) / 2) + overlayGeneral.offsetX;
  const y = anchoredY;
  return {
    x,
    y,
    width,
    height: overlayGeneral.height,
    borderRadius: overlayGeneral.borderRadius
  };
}

/**
 * Where a moment card sits. On the centre line it fills the line's padding box (inside its border) and only
 * shows while the line does; set Free, it uses its own box. Shared with the editor.
 */
export function resolveMomentFrame(kind: "timeout" | "gameFinished", theme: ThemeDefinition, centreLineShown: boolean) {
  const card = theme.momentOverlays[kind];
  if (card.placement === "centreLine") {
    if (!centreLineShown) {
      return null;
    }
    const line = theme.components.breakTime;
    const inset = line.borderWidth;
    return {
      following: true,
      x: line.x + inset,
      y: line.y + inset,
      width: Math.max(1, line.width - inset * 2),
      height: Math.max(1, line.height - inset * 2),
      borderRadius: line.borderRadius.map((radius) => Math.max(0, radius - inset)) as [number, number, number, number]
    };
  }
  return { following: false, x: card.x, y: card.y, width: card.width, height: card.height, borderRadius: card.borderRadius };
}

/**
 * Where the band runs: over the scoreboard's own pieces (not free pieces, so a sponsor line elsewhere on screen
 * can't stretch it), with 15% room above and below, then scaled by Band size around the scoreboard's middle.
 * Across, it covers the whole canvas, or with Sweep width on the scoreboard, the scoreboard plus Side room each side.
 */
export function transitionBandRect(theme: ThemeDefinition, onAir = false) {
  // On air, the band follows the pieces to where the placement puts them.
  const transform = onAir ? placementTransform(theme.placement) : null;
  const shown = (boxes: Array<{ visible: boolean; x: number; y: number; width: number; height: number; stayInPlace?: boolean }>) =>
    boxes.filter((box) => box.visible).map((box) => (movesWithPlacement(box) ? placeRect(box, transform) : box));
  // A theme made only of free pieces still gets a band over them.
  const builtIn = shown(Object.values(theme.components));
  const boxes = builtIn.length ? builtIn : shown(theme.freeComponents);
  const full = { left: 0, width: theme.canvas.width };
  if (!boxes.length) {
    const height = Math.round(theme.canvas.height * 0.1 * theme.transition.bandScale);
    return { top: Math.round((theme.canvas.height - height) / 2), height, ...full };
  }
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const room = Math.max(6, Math.round((bottom - top) * 0.15));
  const height = Math.round((bottom - top + room * 2) * theme.transition.bandScale);
  const across = { top: Math.round((top + bottom) / 2 - height / 2), height };
  if (theme.transition.sweepWidth !== "scoreboard") {
    return { ...across, ...full };
  }
  const xBoxes = boxes as Array<{ x: number; width: number }>;
  const leftmost = Math.min(...xBoxes.map((box) => box.x));
  const rightmost = Math.max(...xBoxes.map((box) => box.x + box.width));
  const side = Math.round((rightmost - leftmost) * theme.transition.sweepRoom);
  const left = Math.max(0, leftmost - side);
  const right = Math.min(theme.canvas.width, rightmost + side);
  return { ...across, left, width: right - left };
}

/**
 * How the contents build in on Show, once the band has passed: every shown piece except plain shapes (whose box
 * comes in with the band), in the theme's build-in order. Logos use the logo motion, the rest the content motion.
 */
export function scoreboardBuildPlan(theme: ThemeDefinition) {
  const transition = theme.transition;
  const pieces: Array<{ id: string; component: FramedPiece & { kind?: string; y?: number; height?: number } }> = [
    ...(Object.entries(theme.components) as Array<[string, FramedPiece]>),
    ...theme.freeComponents.map((component) => [component.id, component] as [string, FramedPiece])
  ].map(([id, component]) => ({ id, component }));
  const builders = pieces.filter(({ component }) => component.visible && component.kind !== "shape");
  const order = enterSequence(
    builders.map(({ id, component }) => ({ id, x: component.x, width: component.width, zIndex: component.zIndex })),
    theme.motion.enterOrder,
    theme.canvas.width
  );
  const plan: Record<string, { kind: "logo" | "content"; animation: string | undefined }> = {};
  let buildMs = 0;
  for (const { id, component } of builders) {
    const kind = component.kind === "image" ? "logo" : "content";
    const motion = kind === "logo" ? transition.logoMotion : transition.contentMotion;
    const delayMs = motion.delayMs + (order[id] ?? 0) * transition.contentGapMs;
    plan[id] = { kind, animation: motionEnter({ ...motion, delayMs }) };
    buildMs = Math.max(buildMs, motion.preset === "none" ? 0 : delayMs + motion.durationMs);
  }
  return { plan, buildMs };
}

export function OverlayRenderer({
  theme,
  live,
  assets = [],
  operatorTextValues = {},
  editable = false,
  transparentBackground = false,
  selectedComponentId,
  onSelectComponent,
  previewTimeout = null,
  reduceMotion = false,
  replayChange = null,
  entranceToken = null,
  scoreboardVisible = true,
  applyPlacement = false
}: OverlayRendererProps) {
  const overlayGeneral = theme.teamEventOverlay.general;
  const fontFaces = useMemo(() => themeFontFaces(theme, assets), [theme.fonts, assets]);
  const fontsReady = useThemeFonts(fontFaces);
  const teamSwitchMotion = reduceMotion ? withoutMotion(theme.motion.teamSwitch) : theme.motion.teamSwitch;
  const teamSwitchSwap = motionSwap(teamSwitchMotion);
  const teamSwitchMs = motionTotalMs(teamSwitchMotion);
  const centreLineMotion = reduceMotion ? withoutMotion(theme.centerSecondary.motion) : theme.centerSecondary.motion;
  const [activeConcede, setActiveConcede] = useState<{ side: "left" | "right"; eventType: "towel" | "base"; until: number; token: string } | null>(null);
  const [teamSwitchToken, setTeamSwitchToken] = useState<number | null>(null);
  const [teamSwitchPayload, setTeamSwitchPayload] = useState<{
    token: number;
    from: NormalizedLiveState;
    to: NormalizedLiveState;
  } | null>(null);
  const [centerSecondaryAnimationTick, setCenterSecondaryAnimationTick] = useState(0);
  const [centerSecondaryExitActive, setCenterSecondaryExitActive] = useState(false);
  const previousTeamEventRef = useRef<NormalizedLiveState["teamEvent"]>("none");
  const previousCenterSecondaryVariantRef = useRef<"timer" | "staticText" | "hidden" | null>(null);
  const previousCenterSecondaryPresentationRef = useRef<{ variant: "timer" | "staticText" | "hidden"; content: string } | null>(null);
  const previousSwitchSnapshotRef = useRef<OverlaySnapshot | null>(null);
  const previousSwitchLiveRef = useRef<NormalizedLiveState | null>(null);
  const lastTeamSwitchAtRef = useRef(0);
  const teamSwitchClearTimeoutRef = useRef<number | null>(null);
  // Towel animation repeat state
  const [towelAnimationTick, setTowelAnimationTick] = useState(0);
  const towelIntervalRef = useRef<number | null>(null);
  const currentTeamEvent = live?.teamEvent ?? "none";
  const completedMatch = useMemo(() => {
    if (!live || live.sourceStatus !== "ok" || live.state !== "END" || live.period !== "BREAK") {
      return null;
    }
    const snapshot = createOverlaySnapshot(live);
    const token = `${snapshot.round}|${snapshot.leftName}|${snapshot.rightName}|${snapshot.leftScore}|${snapshot.rightScore}`;
    return { token, snapshot };
  }, [live]);
  const gameFinishToken = theme.momentOverlays.gameFinished.enabled ? completedMatch?.token ?? null : null;
  // The side that lost a finished match, for team logos set to grey out on a loss.
  const finishedWinner = completedMatch ? winnerSideFromSnapshot(completedMatch.snapshot) : null;
  const loserSide = finishedWinner === "left" ? "right" : finishedWinner === "right" ? "left" : null;
  const winnerReveal = useMemo(() => {
    if (!theme.teamEventOverlay.winner.enabled || !completedMatch) {
      return null;
    }
    const winnerSide = winnerSideFromSnapshot(completedMatch.snapshot);
    if (!winnerSide) {
      return null;
    }
    return {
      side: winnerSide,
      token: `${completedMatch.token}|${winnerSide}`
    };
  }, [completedMatch, theme.teamEventOverlay.winner.enabled]);
  const majorAnimationActive = Boolean(gameFinishToken || (overlayGeneral.enabled && winnerReveal));

  useEffect(
    () => () => {
      if (teamSwitchClearTimeoutRef.current !== null) {
        clearTimeout(teamSwitchClearTimeoutRef.current);
      }
    },
    []
  );

  const breakTimeoutToken = useTimeoutToken(live, theme.momentOverlays.timeout, majorAnimationActive);

  useEffect(() => {
    if (!overlayGeneral.teamSwitchEnabled || teamSwitchMs === 0) {
      if (teamSwitchClearTimeoutRef.current !== null) {
        clearTimeout(teamSwitchClearTimeoutRef.current);
        teamSwitchClearTimeoutRef.current = null;
      }
      setTeamSwitchToken(null);
      setTeamSwitchPayload(null);
      return;
    }

    if (!live || live.sourceStatus !== "ok") {
      previousSwitchSnapshotRef.current = null;
      previousSwitchLiveRef.current = null;
      setTeamSwitchPayload(null);
      return;
    }

    const snapshot = createOverlaySnapshot(live);
    const previous = previousSwitchSnapshotRef.current;
    const previousLive = previousSwitchLiveRef.current;
    previousSwitchSnapshotRef.current = snapshot;
    previousSwitchLiveRef.current = live;
    if (!previous || !previousLive || majorAnimationActive) {
      return;
    }

    if (snapshot.state === "END") {
      return;
    }

    const leftNow = normalizedName(snapshot.leftName);
    const rightNow = normalizedName(snapshot.rightName);
    const leftPrev = normalizedName(previous.leftName);
    const rightPrev = normalizedName(previous.rightName);
    if (!leftNow || !rightNow || !leftPrev || !rightPrev) {
      return;
    }
    const mainPairUnchanged = samePairUnordered(leftNow, rightNow, leftPrev, rightPrev);
    if (mainPairUnchanged) {
      return;
    }

    const now = Date.now();
    if (now - lastTeamSwitchAtRef.current < TEAM_SWITCH_COOLDOWN_MS) {
      return;
    }
    lastTeamSwitchAtRef.current = now;

    setTeamSwitchToken(now);
    setTeamSwitchPayload({ token: now, from: previousLive, to: live });
    if (teamSwitchClearTimeoutRef.current !== null) {
      clearTimeout(teamSwitchClearTimeoutRef.current);
    }
    teamSwitchClearTimeoutRef.current = window.setTimeout(() => {
      setTeamSwitchToken((current) => (current === now ? null : current));
      setTeamSwitchPayload((current) => (current?.token === now ? null : current));
      teamSwitchClearTimeoutRef.current = null;
    }, teamSwitchMs);
  }, [live, majorAnimationActive, overlayGeneral.teamSwitchEnabled, teamSwitchMs]);

  // Repeating towel animation logic
  useEffect(() => {
    if (!live || currentTeamEvent === "none" || majorAnimationActive) {
      if (towelIntervalRef.current !== null) {
        clearInterval(towelIntervalRef.current);
        towelIntervalRef.current = null;
      }
      setTowelAnimationTick(0);
      return;
    }
    // If already running, do nothing
    if (towelIntervalRef.current !== null) return;
    // One tick per loop of the event card's motion.
    const duration = overlayGeneral.motion.durationMs || 1200;
    towelIntervalRef.current = window.setInterval(() => {
      setTowelAnimationTick((tick) => tick + 1);
    }, duration);
    // Initial tick
    setTowelAnimationTick((tick) => tick + 1);
    return () => {
      if (towelIntervalRef.current !== null) {
        clearInterval(towelIntervalRef.current);
        towelIntervalRef.current = null;
      }
    };
  }, [currentTeamEvent, live, majorAnimationActive, overlayGeneral.motion.durationMs]);

  useEffect(() => {
    if (!live || !overlayGeneral.enabled || majorAnimationActive) {
      previousTeamEventRef.current = "none";
      setActiveConcede(null);
      return;
    }

    const currentEvent = currentTeamEvent;
    previousTeamEventRef.current = currentEvent;

    if (currentEvent === "none") {
      setActiveConcede(null);
      return;
    }

    // Always keep activeConcede set while a teamEvent is active
    const isHomeEvent = currentEvent === "towel-home" || currentEvent === "base-home";
    const side =
      isHomeEvent
        ? live.sidesSwitched === 1
          ? "right"
          : "left"
        : live.sidesSwitched === 1
          ? "left"
          : "right";
    const eventType = currentEvent === "base-home" || currentEvent === "base-away" ? "base" : "towel";

    const token = `${currentEvent}:${live.round}:${live.sidesSwitched}`;
    setActiveConcede({
      side,
      eventType,
      until: 0, // not used anymore
      token
    });
  }, [currentTeamEvent, live?.round, live?.sidesSwitched, majorAnimationActive, overlayGeneral.enabled, live]);

  // Remove timeout logic: activeConcede is now persistent while teamEvent is active

  // After Show, the centre line carries the band's text for a moment before its usual content.
  const [centreLineIntro, setCentreLineIntro] = useState(false);
  const bandText = (theme.transition.bandText.trim() || theme.centerSecondary.gameText.trim() || theme.name).toUpperCase();
  const centerSecondaryPresentation = useMemo(() => {
    const usual = resolveCenterSecondaryPresentation(theme, live);
    // A centre line the theme hides stays hidden; the intro only borrows one that is showing.
    return centreLineIntro && usual.variant !== "hidden" ? { content: bandText, variant: "staticText" as const } : usual;
  }, [theme, live, centreLineIntro, bandText]);

  // Values that animate when they change in place: scores and custom text with a change motion.
  const changeWatch = useMemo(() => {
    const watched: Record<string, { value: string; motion: ChangeMotionSettings }> = {};
    if (reduceMotion) {
      return watched;
    }
    for (const id of ["homeScore", "awayScore"] as const) {
      const component = theme.components[id];
      if (component.kind === "text" && component.changeMotion.preset !== "none") {
        watched[id] = { value: resolveTextContent(theme, id, live) ?? "", motion: component.changeMotion };
      }
    }
    for (const component of theme.freeComponents) {
      if (component.kind === "text" && component.changeMotion.preset !== "none") {
        const value = component.contentMode === "operator" ? operatorTextValues[component.id] ?? component.defaultText : component.defaultText;
        watched[component.id] = { value, motion: component.changeMotion };
      }
    }
    return watched;
  }, [theme, live, operatorTextValues, reduceMotion]);
  // A team change or a side switch moves every value at once; the team switch animates that, not each value.
  const sidesKey = live ? `${normalizedName(live.displayLeftTeam.name)}|${normalizedName(live.displayRightTeam.name)}` : "";
  const [valueChanges, setValueChanges] = useState<Record<string, { tick: number; previous: string | null }>>({});
  const previousValuesRef = useRef<Record<string, string>>({});
  const previousSidesKeyRef = useRef<string | null>(null);
  const changeTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = changeTimersRef.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  // Before paint, so the new value never shows for a frame without its motion.
  useLayoutEffect(() => {
    const before = previousValuesRef.current;
    const sidesMoved = previousSidesKeyRef.current !== null && previousSidesKeyRef.current !== sidesKey;
    previousSidesKeyRef.current = sidesKey;
    previousValuesRef.current = Object.fromEntries(Object.entries(changeWatch).map(([id, entry]) => [id, entry.value]));
    for (const [id, previous] of changedValues(before, previousValuesRef.current, sidesMoved)) {
      startValueChange(id, previous, changeWatch[id].motion);
    }
  }, [changeWatch, sidesKey]);

  // Editor playback: replay the motion with a stand-in previous value.
  useLayoutEffect(() => {
    const entry = replayChange ? changeWatch[replayChange.id] : undefined;
    if (!replayChange || !entry) {
      return;
    }
    const number = Number(entry.value);
    startValueChange(replayChange.id, entry.value !== "" && Number.isFinite(number) ? String(Math.max(0, number - 1)) : entry.value, entry.motion);
    // Only a new token replays; the watched values changing must not.
  }, [replayChange?.token]);

  function startValueChange(id: string, previous: string, motion: ChangeMotionSettings) {
    setValueChanges((current) => ({ ...current, [id]: { tick: (current[id]?.tick ?? 0) + 1, previous } }));
    const timers = changeTimersRef.current;
    const existing = timers.get(id);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        setValueChanges((current) => (current[id] ? { ...current, [id]: { ...current[id], previous: null } } : current));
      }, motion.durationMs + motion.delayMs)
    );
  }

  /** The motion for a value that just changed, with the old value when the motion needs it (roll). */
  function valueChangeFor(id: string) {
    const change = valueChanges[id];
    const watched = changeWatch[id];
    const motion = change && watched ? motionChange(watched.motion) : null;
    return change && motion ? { key: `${id}:${change.tick}`, motion, previous: motion.out ? change.previous : null } : null;
  }

  // Entrances and exits. Every piece enters on mount; the operator's cue and a piece being shown enter it again.
  const framedPieces = useMemo(
    () =>
      [
        ...(Object.entries(theme.components) as Array<[string, FramedPiece]>),
        ...theme.freeComponents.map((component) => [component.id, component] as [string, FramedPiece])
      ].map(([id, component]) => ({ id, component })),
    [theme]
  );
  const enterIndex = useMemo(
    () =>
      enterSequence(
        framedPieces
          .filter(({ component }) => component.visible && component.enterMotion.preset !== "none")
          .map(({ id, component }) => ({ id, x: component.x, width: component.width, zIndex: component.zIndex })),
        theme.motion.enterOrder,
        theme.canvas.width
      ),
    [framedPieces, theme.motion.enterOrder, theme.canvas.width]
  );
  const [pieceRuns, setPieceRuns] = useState<Record<string, { run: number; staggered: boolean }>>({});
  const [exitingPieces, setExitingPieces] = useState<Record<string, true>>({});
  const previousVisibleRef = useRef<Record<string, boolean> | null>(null);
  const previousEntranceTokenRef = useRef(entranceToken);
  const exitTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = exitTimersRef.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  function replayEntrances() {
    setExitingPieces({});
    setPieceRuns((current) =>
      Object.fromEntries(framedPieces.map(({ id }) => [id, { run: (current[id]?.run ?? 0) + 1, staggered: true }]))
    );
  }

  useLayoutEffect(() => {
    if (entranceToken === previousEntranceTokenRef.current) {
      return;
    }
    previousEntranceTokenRef.current = entranceToken;
    replayEntrances();
  }, [entranceToken, framedPieces]);

  // Show / Hide.
  const transition = theme.transition;
  const buildPlan = useMemo(() => scoreboardBuildPlan(theme), [theme]);
  const plainExitMs = useMemo(
    () => Math.max(0, ...framedPieces.filter(({ component }) => component.visible).map(({ component }) => (motionExit(component.exitMotion) ? motionTotalMs(component.exitMotion) : 0))),
    [framedPieces]
  );
  const bandRect = useMemo(() => transitionBandRect(theme, applyPlacement), [theme, applyPlacement]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const { phase: scoreboardPhase, plainShowRun } = useScoreboardTransition({
    visible: scoreboardVisible,
    settings: transition,
    reduceMotion,
    buildMs: buildPlan.buildMs,
    plainExitMs,
    canvasWidth: theme.canvas.width,
    bandArea: { left: bandRect.left, width: bandRect.width },
    stageRef,
    bandRef
  });
  // A ref, not effect cleanup: settling from "building" into "shown" must not cut the intro short.
  const centreLineIntroTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const stop = () => {
      if (centreLineIntroTimerRef.current !== null) {
        clearTimeout(centreLineIntroTimerRef.current);
        centreLineIntroTimerRef.current = null;
      }
    };
    if (scoreboardPhase === "building" && transition.centreLineIntroMs > 0) {
      stop();
      setCentreLineIntro(true);
      centreLineIntroTimerRef.current = window.setTimeout(() => {
        centreLineIntroTimerRef.current = null;
        setCentreLineIntro(false);
      }, transition.centreLineIntroMs);
    } else if (scoreboardPhase === "leaving-contents" || scoreboardPhase === "hidden") {
      stop();
      setCentreLineIntro(false);
    }
  }, [scoreboardPhase]);
  useEffect(
    () => () => {
      if (centreLineIntroTimerRef.current !== null) clearTimeout(centreLineIntroTimerRef.current);
    },
    []
  );
  const previousPlainShowRunRef = useRef(plainShowRun);
  useLayoutEffect(() => {
    if (plainShowRun === previousPlainShowRunRef.current) return;
    previousPlainShowRunRef.current = plainShowRun;
    replayEntrances();
  }, [plainShowRun]);

  const visibilityKey = framedPieces.map(({ id, component }) => `${id}:${component.visible ? 1 : 0}`).join(",");
  useLayoutEffect(() => {
    const now = Object.fromEntries(framedPieces.map(({ id, component }) => [id, component.visible]));
    const before = previousVisibleRef.current;
    previousVisibleRef.current = now;
    if (!before || reduceMotion) {
      return;
    }
    for (const { id, component } of framedPieces) {
      if (before[id] === false && component.visible && component.enterMotion.preset !== "none") {
        setExitingPieces(({ [id]: _, ...rest }) => rest);
        setPieceRuns((current) => ({ ...current, [id]: { run: (current[id]?.run ?? 0) + 1, staggered: false } }));
      } else if (before[id] === true && !component.visible && component.exitMotion.preset !== "none") {
        setExitingPieces((current) => ({ ...current, [id]: true }));
        const timers = exitTimersRef.current;
        const existing = timers.get(id);
        if (existing !== undefined) {
          clearTimeout(existing);
        }
        timers.set(
          id,
          window.setTimeout(() => {
            timers.delete(id);
            setExitingPieces(({ [id]: _, ...rest }) => rest);
          }, motionTotalMs(component.exitMotion))
        );
      }
    }
    // Only a visibility flip matters here, not every theme edit.
  }, [visibilityKey]);

  /**
   * The piece's entrance or exit: the animation, a key that restarts it, and whether it is still leaving (shown
   * although hidden). While it animates, its own opacity moves to a filter so the keyframes' opacity doesn't override it.
   */
  function slotMotion(
    id: string,
    component: FramedPiece
  ): { key: string; style: CSSProperties; exiting: boolean; attrs: { "data-build"?: "logo" | "content" } } {
    const run = pieceRuns[id] ?? { run: 0, staggered: true };
    const key = `${id}:${run.run}`;
    const build = transition.enabled && !reduceMotion ? buildPlan.plan[id] : undefined;
    const attrs = build ? { "data-build": build.kind } : {};
    // Only while Show runs, so a piece's style at rest is exactly what it was before Show / Hide existed.
    const building = scoreboardPhase === "entering" || scoreboardPhase === "building";
    const buildStyle = (building && build?.animation ? { "--build-animation": build.animation } : {}) as CSSProperties;
    if (scoreboardPhase === "leaving-plain") {
      const animation = motionExit(component.exitMotion);
      return { key, style: animation ? { animation } : { visibility: "hidden" }, exiting: false, attrs };
    }
    if (reduceMotion || (component.enterMotion.preset === "none" && component.exitMotion.preset === "none")) {
      return { key, style: buildStyle, exiting: false, attrs };
    }
    const exiting = Boolean(exitingPieces[id]);
    const stagger = run.staggered ? (enterIndex[id] ?? 0) * theme.motion.enterStaggerMs : 0;
    const animation = exiting
      ? motionExit(component.exitMotion)
      : motionEnter({ ...component.enterMotion, delayMs: component.enterMotion.delayMs + stagger });
    const style: CSSProperties = animation ? { ...buildStyle, animation } : { ...buildStyle };
    if (component.opacity < 1) {
      style.opacity = 1;
      style.filter = `opacity(${component.opacity})`;
    }
    return { key, style, exiting, attrs };
  }

  // The exit timer lives in a ref: live data re-renders far more often than the exit lasts, and an effect
  // cleanup would cancel it and leave the old content stuck on screen.
  const centerSecondaryExitTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (centerSecondaryExitTimerRef.current !== null) {
        clearTimeout(centerSecondaryExitTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const previousVariant = previousCenterSecondaryVariantRef.current;
    const nextVariant = centerSecondaryPresentation.variant;
    previousCenterSecondaryVariantRef.current = nextVariant;

    if (!previousVariant || previousVariant === nextVariant) {
      if (nextVariant !== "hidden") {
        previousCenterSecondaryPresentationRef.current = centerSecondaryPresentation;
      }
      return;
    }

    if (centerSecondaryExitTimerRef.current !== null) {
      clearTimeout(centerSecondaryExitTimerRef.current);
      centerSecondaryExitTimerRef.current = null;
    }
    if (nextVariant === "hidden") {
      setCenterSecondaryExitActive(true);
      centerSecondaryExitTimerRef.current = window.setTimeout(() => {
        centerSecondaryExitTimerRef.current = null;
        setCenterSecondaryExitActive(false);
      }, centreLineMotion.preset === "none" ? 0 : centreLineMotion.durationMs);
    } else {
      setCenterSecondaryAnimationTick((current) => current + 1);
      setCenterSecondaryExitActive(false);
      previousCenterSecondaryPresentationRef.current = centerSecondaryPresentation;
    }
  }, [centerSecondaryPresentation, centreLineMotion.preset, centreLineMotion.durationMs]);

  const concedeLabel = useMemo(() => {
    const activeConcedeTheme = activeConcede?.eventType === "base" ? theme.teamEventOverlay.base : theme.teamEventOverlay.concede;
    if (!overlayGeneral.enabled || !activeConcede || !activeConcedeTheme?.enabled) {
      return null;
    }
    const rect = resolveEventLabelRect(activeConcede.side, theme, overlayGeneral);
    return {
      ...rect,
      token: activeConcede.token
    };
  }, [activeConcede, overlayGeneral, theme]);

  const winnerLabel = useMemo(() => {
    if (!overlayGeneral.enabled || !winnerReveal || !theme.teamEventOverlay.winner.enabled) {
      return null;
    }
    const rect = resolveEventLabelRect(winnerReveal.side, theme, overlayGeneral);
    return {
      ...rect,
      token: winnerReveal.token
    };
  }, [overlayGeneral, theme, winnerReveal]);

  const activeConcedeTheme = activeConcede?.eventType === "base" ? theme.teamEventOverlay.base : theme.teamEventOverlay.concede;
  const activeConcedeSurface = activeConcedeTheme
    ? surfaceStyles(
        {
          backgroundColor: activeConcedeTheme.backgroundColor,
          backgroundImageAssetId: activeConcedeTheme.backgroundImageAssetId,
          backgroundImageFit: overlayGeneral.backgroundImageFit,
          backgroundImagePosition: overlayGeneral.backgroundImagePosition,
          backgroundOverlayColor: activeConcedeTheme.backgroundOverlayColor,
          backgroundOverlayOpacity: activeConcedeTheme.backgroundOverlayOpacity,
          backgroundOpacity: activeConcedeTheme.backgroundOpacity,
          fill: activeConcedeTheme.fill,
          tintFill: activeConcedeTheme.tintFill
        },
        assets,
        theme,
        live
      )
    : null;
  const concedeText = activeConcedeTheme?.text ?? "";
  const concedeTextColor = activeConcedeTheme?.color ?? "#ffffff";
  const winnerTheme = theme.teamEventOverlay.winner;
  const winnerSurface = surfaceStyles(
    {
      backgroundColor: winnerTheme.backgroundColor,
      backgroundImageAssetId: winnerTheme.backgroundImageAssetId,
      backgroundImageFit: overlayGeneral.backgroundImageFit,
      backgroundImagePosition: overlayGeneral.backgroundImagePosition,
      backgroundOverlayColor: winnerTheme.backgroundOverlayColor,
      backgroundOverlayOpacity: winnerTheme.backgroundOverlayOpacity,
      backgroundOpacity: winnerTheme.backgroundOpacity,
      fill: winnerTheme.fill,
      tintFill: winnerTheme.tintFill
    },
    assets,
    theme,
    live
  );
  const winnerText = winnerTheme.text?.trim() || "WINNER";
  const defaultEventLabel = concedeLabel && live && currentTeamEvent !== "none" ? concedeLabel : null;
  const activeOverlayLabel = winnerLabel ?? defaultEventLabel;

  const timeoutCard = theme.momentOverlays.timeout;
  const gameFinishedCard = theme.momentOverlays.gameFinished;
  const timeoutVisible = previewTimeout
    ? timeoutCard.enabled
    : Boolean(breakTimeoutToken) && timeoutCard.enabled && live?.period === "BREAK" && !gameFinishToken;
  const gameFinishedVisible = Boolean(gameFinishToken);
  const hideCentreLineContent =
    (gameFinishedVisible && gameFinishedCard.hideCentreLineContent) || (timeoutVisible && timeoutCard.hideCentreLineContent);
  // A game finished card on the centre line keeps the line's box showing even when the line has nothing to say.
  const momentHoldsCentreLine = gameFinishedVisible && gameFinishedCard.placement === "centreLine";
  const freeMomentZIndex =
    Math.max(0, ...Object.values(theme.components).map((component) => component.zIndex), ...theme.freeComponents.map((component) => component.zIndex)) + 1;
  const momentCards = [
    { kind: "timeout" as const, card: timeoutCard, active: timeoutVisible, token: previewTimeout ?? breakTimeoutToken },
    { kind: "gameFinished" as const, card: gameFinishedCard, active: gameFinishedVisible, token: gameFinishToken }
  ].filter((entry) => entry.active);

  function renderMomentCard(entry: (typeof momentCards)[number], centreLineShown: boolean) {
    const frame = resolveMomentFrame(entry.kind, theme, centreLineShown);
    if (!frame) {
      return null;
    }
    const { card } = entry;
    const breakTime = theme.components.breakTime;
    const surface = surfaceStyles(card, assets, theme, live);
    return (
      <div
        key={`moment:${entry.kind}:${entry.token}`}
        className="moment-card"
        data-moment={entry.kind}
        style={{
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          zIndex: frame.following ? breakTime.zIndex : freeMomentZIndex,
          opacity: frame.following ? breakTime.opacity : 1,
          border: `${card.borderWidth}px solid ${card.borderColor}`,
          borderRadius: frame.borderRadius.map((v) => `${v}px`).join(" "),
          boxShadow: card.shadow,
          animation:
            entry.kind === "timeout"
              ? previewTimeout === "hold"
                ? "center-secondary-timeout-hold 220ms ease-out both"
                : `center-secondary-timeout-flash ${(card as typeof timeoutCard).durationMs}ms ease-out both`
              : "center-secondary-slide-up 220ms ease"
        }}
      >
        <SurfaceLayers surface={surface} />
        <span
          className="component-content text-content"
          style={{
            justifyContent: card.textAlign === "left" ? "flex-start" : card.textAlign === "right" ? "flex-end" : "center",
            padding: frame.following ? resolveComponentPadding(breakTime) : resolveComponentPadding(card),
            ...(frame.following ? resolveComponentOffset(breakTime) : {}),
            color: card.color,
            fontFamily: `"${card.fontFamily}", sans-serif`,
            fontSize: card.fontSize,
            fontWeight: card.fontWeight,
            letterSpacing: card.letterSpacing,
            lineHeight: frame.following ? breakTime.lineHeight : 1,
            ...textLook(card)
          }}
        >
          <FitText settings={card}>{card.text}</FitText>
        </span>
      </div>
    );
  }

  // Pieces draw in two layers: the placement layer, moved and scaled to the on-air placement, and the pinned layer for
  // pieces set to stay in place. Without a placement everything is in the first layer, untransformed.
  const placement = applyPlacement ? placementTransform(theme.placement) : null;
  const pinnedOnAir = (piece: { stayInPlace?: boolean }) => Boolean(placement) && !movesWithPlacement(piece);

  function renderBuiltIn([componentId, component]: [ComponentId, ThemeDefinition["components"][ComponentId]]) {
        const switchTarget =
          componentId === "homeName" ||
          componentId === "homeTeamLogo" ||
          componentId === "homeScore" ||
          componentId === "awayName" ||
          componentId === "awayTeamLogo" ||
          componentId === "awayScore";
        const teamSwitchActive = Boolean(
          overlayGeneral.teamSwitchEnabled &&
            teamSwitchPayload &&
            teamSwitchToken !== null &&
            teamSwitchPayload.token === teamSwitchToken &&
            switchTarget
        );
        const commonClass = editable && selectedComponentId === componentId ? "component-slot selected" : "component-slot";
        if (component.kind === "image") {
          const imageAsset = resolveImageAsset(componentId, component, theme, live, assets);
          const surface = surfaceStyles(component, assets, theme, live);
          const isTeamLogo = componentId === "homeTeamLogo" || componentId === "awayTeamLogo";
          const previousImageAsset =
            teamSwitchActive && teamSwitchPayload
              ? resolveImageAsset(componentId, component, theme, teamSwitchPayload.from, assets)
              : null;
          const nextImageAsset =
            teamSwitchActive && teamSwitchPayload
              ? resolveImageAsset(componentId, component, theme, teamSwitchPayload.to, assets)
              : null;
          const motion = slotMotion(componentId, component);
          const logoSide = componentId === "homeTeamLogo" ? "left" : componentId === "awayTeamLogo" ? "right" : null;
          const imageFilter = imageEffectFilter(component.imageEffects, logoSide !== null && logoSide === loserSide);
          return (
            <button
              key={motion.key}
              type="button"
              className={commonClass}
              style={{ ...imageStyles(component), ...motion.style, ...(motion.exiting ? { display: "block" } : {}) }}
              onClick={() => onSelectComponent?.(componentId)}
              {...motion.attrs}
            >
              <span className="component-body">
                <SurfaceLayers surface={surface} />
                {teamSwitchActive && isTeamLogo && teamSwitchPayload ? (
                  <>
                    <span
                      className="component-content image-content"
                      style={{
                        padding: resolveComponentPadding(component),
                        ...resolveComponentOffset(component),
                        filter: imageFilter,
                        animation: teamSwitchSwap?.out,
                        position: "absolute",
                        inset: 0,
                        zIndex: 2,
                        transformOrigin: "center center",
                        willChange: "transform, opacity",
                        backfaceVisibility: "hidden"
                      }}
                    >
                      {previousImageAsset ? (
                        <VisibleContentImage
                          asset={previousImageAsset}
                          alt={previousImageAsset.originalName}
                          mode={component.imageContentMode}
                          paddingPct={component.visibleContentPaddingPct}
                          fit={component.backgroundImageFit}
                          position={component.backgroundImagePosition}
                        />
                      ) : null}
                    </span>
                    <span
                      className="component-content image-content"
                      style={{
                        padding: resolveComponentPadding(component),
                        ...resolveComponentOffset(component),
                        filter: imageFilter,
                        animation: teamSwitchSwap?.in,
                        position: "absolute",
                        inset: 0,
                        zIndex: 3,
                        transformOrigin: "center center",
                        willChange: "transform, opacity",
                        backfaceVisibility: "hidden"
                      }}
                    >
                      {nextImageAsset ? (
                        <VisibleContentImage
                          asset={nextImageAsset}
                          alt={nextImageAsset.originalName}
                          mode={component.imageContentMode}
                          paddingPct={component.visibleContentPaddingPct}
                          fit={component.backgroundImageFit}
                          position={component.backgroundImagePosition}
                        />
                      ) : null}
                    </span>
                  </>
                ) : (
                  <span className="component-content image-content" style={{ padding: resolveComponentPadding(component), ...resolveComponentOffset(component), filter: imageFilter }}>
                    {imageAsset ? (
                      <VisibleContentImage
                        asset={imageAsset}
                        alt={imageAsset.originalName}
                        mode={component.imageContentMode}
                        paddingPct={component.visibleContentPaddingPct}
                        fit={component.backgroundImageFit}
                        position={component.backgroundImagePosition}
                      />
                    ) : editable ? (
                      <span>Logo</span>
                    ) : null}
                  </span>
                )}
              </span>
            </button>
          );
        }

        const surface = surfaceStyles(component, assets, theme, live);
        const baseContent = componentId === "breakTime" ? centerSecondaryPresentation.content : resolveTextContent(theme, componentId, live);

        let content = baseContent;
        let visible = component.visible && content !== null && content !== "";

        if (componentId === "breakTime" && centerSecondaryExitActive && previousCenterSecondaryPresentationRef.current) {
          content = previousCenterSecondaryPresentationRef.current.content;
          visible = component.visible && content !== null && content !== "";
        }
        if (componentId === "breakTime" && momentHoldsCentreLine) {
          visible = component.visible;
        }
        // In the editor a centre line with nothing to show stays as an outline, so it can still be found and moved.
        const ghost = editable && componentId === "breakTime" && component.visible && !visible;
        const showContent = !(componentId === "breakTime" && hideCentreLineContent);
        const previousSwitchContent =
          teamSwitchActive && teamSwitchPayload ? resolveTextContent(theme, componentId, teamSwitchPayload.from) : null;
        const nextSwitchContent =
          teamSwitchActive && teamSwitchPayload ? resolveTextContent(theme, componentId, teamSwitchPayload.to) : null;
          
        const activeVariant = componentId === "breakTime" && centerSecondaryExitActive && previousCenterSecondaryPresentationRef.current 
          ? previousCenterSecondaryPresentationRef.current.variant 
          : centerSecondaryPresentation.variant;

        const centerSecondaryStyle =
          componentId === "breakTime"
            ? activeVariant === "timer"
              ? theme.centerSecondary.timerStyle
              : activeVariant === "staticText"
                ? theme.centerSecondary.staticStyle
                : null
            : null;
        const contentKey =
          componentId === "breakTime"
            ? centerSecondaryExitActive
              ? `exit:${centerSecondaryAnimationTick}`
              : `${activeVariant}:${centerSecondaryAnimationTick}`
            : undefined;
        const contentAnimation =
          componentId === "breakTime" && centerSecondaryExitActive
            ? motionLeave(centreLineMotion)
            : componentId === "breakTime" && centerSecondaryAnimationTick > 0
              ? motionEnter(centreLineMotion)
              : undefined;
        const valueChange = valueChangeFor(componentId);
        // A clock's last seconds: counted on the game clock, or the break clock while the centre line shows it.
        const warningSeconds =
          !live ? null : componentId === "gameTime" ? live.gameTimer.value : componentId === "breakTime" && activeVariant === "timer" ? live.breakTimer.value : null;
        const warning = component.clockWarning;
        const warningActive = warningSeconds !== null && warning.belowSeconds > 0 && warningSeconds > 0 && warningSeconds <= warning.belowSeconds;
        const mainTextStyle: CSSProperties = {
          justifyContent: component.textAlign === "left" ? "flex-start" : component.textAlign === "right" ? "flex-end" : "center",
          padding: resolveComponentPadding(component),
          ...resolveComponentOffset(component),
          color: warningActive && warning.color ? warning.color : centerSecondaryStyle?.color ?? component.color,
          fontFamily: `"${centerSecondaryStyle?.fontFamily ?? component.fontFamily}", sans-serif`,
          fontSize: centerSecondaryStyle?.fontSize ?? component.fontSize,
          fontWeight: centerSecondaryStyle?.fontWeight ?? component.fontWeight,
          letterSpacing: component.letterSpacing,
          lineHeight: component.lineHeight,
          ...textLook(component)
        };

        const motion = slotMotion(componentId, component);

        return (
          <Fragment key={componentId}>
          <button
            key={motion.key}
            type="button"
            className={ghost ? `${commonClass} component-slot--ghost` : commonClass}
            style={{ ...frameStyles(component), ...(ghost ? {} : motion.style), display: visible || ghost || motion.exiting ? "flex" : "none" }}
            onClick={() => onSelectComponent?.(componentId)}
            {...motion.attrs}
          >
            {ghost ? (
              <span className="component-ghost-label" style={{ fontSize: Math.max(12, Math.min(28, Math.round(component.height * 0.42))) }}>
                Centre line · nothing to show now
              </span>
            ) : null}
            <span className="component-body" hidden={ghost}>
              <SurfaceLayers surface={surface} />
              {!showContent ? null : teamSwitchActive && teamSwitchPayload ? (
                <>
                  <span
                    className="component-content text-content"
                    style={{
                      justifyContent:
                        component.textAlign === "left" ? "flex-start" : component.textAlign === "right" ? "flex-end" : "center",
                      padding: resolveComponentPadding(component),
                      ...resolveComponentOffset(component),
                      color: centerSecondaryStyle?.color ?? component.color,
                      fontFamily: `"${centerSecondaryStyle?.fontFamily ?? component.fontFamily}", sans-serif`,
                      fontSize: centerSecondaryStyle?.fontSize ?? component.fontSize,
                      fontWeight: centerSecondaryStyle?.fontWeight ?? component.fontWeight,
                      letterSpacing: component.letterSpacing,
                      lineHeight: component.lineHeight,
                      ...textLook(component),
                      animation: teamSwitchSwap?.out,
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      transformOrigin: "center center",
                      willChange: "transform, opacity",
                      backfaceVisibility: "hidden"
                    }}
                  >
                    <FitText settings={component}>{previousSwitchContent}</FitText>
                  </span>
                  <span
                    className="component-content text-content"
                    style={{
                      justifyContent:
                        component.textAlign === "left" ? "flex-start" : component.textAlign === "right" ? "flex-end" : "center",
                      padding: resolveComponentPadding(component),
                      ...resolveComponentOffset(component),
                      color: centerSecondaryStyle?.color ?? component.color,
                      fontFamily: `"${centerSecondaryStyle?.fontFamily ?? component.fontFamily}", sans-serif`,
                      fontSize: centerSecondaryStyle?.fontSize ?? component.fontSize,
                      fontWeight: centerSecondaryStyle?.fontWeight ?? component.fontWeight,
                      letterSpacing: component.letterSpacing,
                      lineHeight: component.lineHeight,
                      ...textLook(component),
                      animation: teamSwitchSwap?.in,
                      position: "absolute",
                      inset: 0,
                      zIndex: 3,
                      transformOrigin: "center center",
                      willChange: "transform, opacity",
                      backfaceVisibility: "hidden"
                    }}
                  >
                    <FitText settings={component}>{nextSwitchContent}</FitText>
                  </span>
                </>
              ) : (
                <>
                  {valueChange?.previous ? (
                    <span
                      key={`${valueChange.key}:out`}
                      className="component-content text-content"
                      style={{ ...mainTextStyle, position: "absolute", inset: 0, animation: valueChange.motion.out ?? undefined }}
                    >
                      <FitText settings={component}>{valueChange.previous}</FitText>
                    </span>
                  ) : null}
                  <span
                    key={contentKey ?? valueChange?.key}
                    className="component-content text-content"
                    style={{ ...mainTextStyle, animation: contentAnimation ?? valueChange?.motion.in }}
                  >
                    {pulsing(<FitText settings={component}>{content}</FitText>, warningActive && warning.pulse && !reduceMotion)}
                  </span>
                </>
              )}
            </span>
          </button>
          {/* Cards on the centre line stack directly above it, exactly where its content used to be replaced. */}
          {componentId === "breakTime" ? momentCards.map((entry) => entry.card.placement === "centreLine" ? renderMomentCard(entry, visible) : null) : null}
          </Fragment>
        );
  }

  function renderFree(component: ThemeDefinition["freeComponents"][number]) {
        const commonClass = editable && selectedComponentId === component.id ? "component-slot selected" : "component-slot";
        const surface = surfaceStyles(component, assets, theme, live);

        if (component.kind === "image") {
          const imageAsset = component.assetId ? assets.find((asset) => asset.id === component.assetId) ?? null : null;
          const motion = slotMotion(component.id, component);
          return (
            <button
              key={motion.key}
              type="button"
              className={commonClass}
              style={{ ...imageStyles(component), ...motion.style, ...(motion.exiting ? { display: "block" } : {}) }}
              onClick={() => onSelectComponent?.(component.id)}
              {...motion.attrs}
            >
              <span className="component-body">
                <SurfaceLayers surface={surface} />
                <span
                  className="component-content image-content"
                  style={{ padding: resolveComponentPadding(component), ...resolveComponentOffset(component), filter: imageEffectFilter(component.imageEffects, false) }}
                >
                  {imageAsset ? (
                    <VisibleContentImage
                      asset={imageAsset}
                      alt={component.label}
                      mode={component.imageContentMode}
                      paddingPct={component.visibleContentPaddingPct}
                      fit={component.backgroundImageFit}
                      position={component.backgroundImagePosition}
                    />
                  ) : editable && !surface.background.backgroundImage ? (
                    // Placeholder only for a truly empty image piece; art painted as the background needs no label.
                    <span>{component.label}</span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        }

        if (component.kind === "shape") {
          const motion = slotMotion(component.id, component);
          const radius =
            component.shape === "pill" ? "9999px" : component.shape === "ellipse" ? "50%" : component.borderRadius.map((v) => `${v}px`).join(" ");
          return (
            <button
              key={motion.key}
              type="button"
              className={commonClass}
              style={{
                ...frameStyles(component),
                // The box is drawn by the shape body, so the slant never fights an entrance's transform.
                border: "none",
                borderRadius: 0,
                boxShadow: "none",
                overflow: "visible",
                backdropFilter: undefined,
                ...motion.style,
                display: component.visible || motion.exiting ? "block" : "none"
              }}
              onClick={() => onSelectComponent?.(component.id)}
              {...motion.attrs}
            >
              <span
                className="shape-body"
                style={{
                  border: `${component.borderWidth}px solid ${component.borderColor}`,
                  borderRadius: radius,
                  boxShadow: component.shadow,
                  backdropFilter: component.backdropBlur ? `blur(${component.backdropBlur}px)` : undefined,
                  // Positive leans the top to the right, like italic type.
                  transform: component.skewX ? `skewX(${-component.skewX}deg)` : undefined
                }}
              >
                <SurfaceLayers surface={surface} />
              </span>
            </button>
          );
        }

        const content =
          component.contentMode === "operator"
            ? operatorTextValues[component.id] ?? component.defaultText
            : component.defaultText;
        const valueChange = valueChangeFor(component.id);
        const freeTextStyle: CSSProperties = {
          justifyContent: component.textAlign === "left" ? "flex-start" : component.textAlign === "right" ? "flex-end" : "center",
          padding: resolveComponentPadding(component),
          ...resolveComponentOffset(component),
          color: component.color,
          fontFamily: `"${component.fontFamily}", sans-serif`,
          fontSize: component.fontSize,
          fontWeight: component.fontWeight,
          letterSpacing: component.letterSpacing,
          lineHeight: component.lineHeight,
          ...textLook(component),
          whiteSpace: component.multiline ? "pre-wrap" : "nowrap",
          overflow: "hidden"
        };
        const motion = slotMotion(component.id, component);
        return (
          <button
            key={motion.key}
            type="button"
            className={commonClass}
            style={{ ...frameStyles(component), ...motion.style, display: component.visible || motion.exiting ? "flex" : "none" }}
            onClick={() => onSelectComponent?.(component.id)}
            {...motion.attrs}
          >
            <span className="component-body">
              <SurfaceLayers surface={surface} />
              {valueChange?.previous ? (
                <span
                  key={`${valueChange.key}:out`}
                  className="component-content text-content"
                  style={{ ...freeTextStyle, position: "absolute", inset: 0, animation: valueChange.motion.out ?? undefined }}
                >
                  <FitText settings={component} multiline={component.multiline} textAlign={component.textAlign}>
                    {valueChange.previous}
                  </FitText>
                </span>
              ) : null}
              <span key={valueChange?.key} className="component-content text-content" style={{ ...freeTextStyle, animation: valueChange?.motion.in }}>
                <FitText settings={component} multiline={component.multiline} textAlign={component.textAlign}>
                  {content}
                </FitText>
              </span>
            </span>
          </button>
        );
  }

  function renderBuiltInLayer(pinned: boolean) {
    return (Object.entries(theme.components) as Array<[ComponentId, ThemeDefinition["components"][ComponentId]]>)
      .filter(([, component]) => pinnedOnAir(component) === pinned)
      .map(renderBuiltIn);
  }

  function renderFreeLayer(pinned: boolean) {
    return theme.freeComponents.filter((component) => pinnedOnAir(component) === pinned).map(renderFree);
  }

  return (
    <div
      className={editable ? "overlay-canvas editable" : "overlay-canvas"}
      style={{
        width: theme.canvas.width,
        height: theme.canvas.height,
        // On air, custom fonts load before the graphic shows, so viewers never see a fallback font.
        ...(!editable && !fontsReady ? { visibility: "hidden" as const } : {}),
        ...(transparentBackground ? {} : { background: theme.canvas.backgroundColor })
      }}
    >
      {editable && theme.canvas.safeArea ? <div className="safe-area" /> : null}

      <div
        ref={stageRef}
        className="scoreboard-stage"
        data-phase={scoreboardPhase}
        style={scoreboardPhase === "hidden" ? { visibility: "hidden" } : undefined}
      >
      <div
        className="placement-layer"
        style={placement ? { transform: `translate(${placement.x}px, ${placement.y}px) scale(${placement.scale})` } : undefined}
      >

      {renderBuiltInLayer(false)}
      {renderFreeLayer(false)}

      {momentCards.map((entry) => (entry.card.placement === "free" ? renderMomentCard(entry, false) : null))}

      {activeOverlayLabel ? (
        <div
          key={activeOverlayLabel.token}
          className="concede-label"
          style={{
            left: activeOverlayLabel.x,
            top: activeOverlayLabel.y,
            width: activeOverlayLabel.width,
            height: activeOverlayLabel.height,
            pointerEvents: "none",
            border: `${overlayGeneral.borderWidth}px solid ${overlayGeneral.borderColor}`,
            borderRadius: `${activeOverlayLabel.borderRadius.map((v) => `${v}px`).join(" ")}`,
            boxShadow: overlayGeneral.shadow,
            overflow: "hidden"
          }}
        >
          <div
            className="concede-label-motion"
            style={{
              animation: eventCardAnimation(overlayGeneral.motion, reduceMotion)
            }}
          >
            {winnerLabel ? <SurfaceLayers surface={winnerSurface} /> : activeConcedeSurface ? <SurfaceLayers surface={activeConcedeSurface} /> : null}
            <span
              className="component-content text-content"
              style={{
                justifyContent:
                  overlayGeneral.textAlign === "left"
                    ? "flex-start"
                    : overlayGeneral.textAlign === "right"
                      ? "flex-end"
                      : "center",
                padding: overlayGeneral.padding,
                color: winnerLabel ? winnerTheme.color : concedeTextColor,
                fontFamily: `"${overlayGeneral.fontFamily}", sans-serif`,
                fontSize: overlayGeneral.fontSize,
                fontWeight: overlayGeneral.fontWeight,
                letterSpacing: overlayGeneral.letterSpacing,
                lineHeight: 1,
                ...textLook(overlayGeneral)
              }}
            >
              <FitText settings={overlayGeneral}>{winnerLabel ? winnerText : concedeText}</FitText>
            </span>
          </div>
        </div>
      ) : null}
      </div>
      {placement ? (
        <>
          {renderBuiltInLayer(true)}
          {renderFreeLayer(true)}
        </>
      ) : null}
      </div>

      {transition.enabled && !reduceMotion ? (
        <TransitionBand
          bandRef={bandRef}
          settings={transition}
          active={scoreboardPhase === "entering" || scoreboardPhase === "leaving-wipe"}
          top={bandRect.top}
          height={bandRect.height}
          left={bandRect.left}
          width={bandRect.width}
          text={bandText}
          logoUrl={transition.bandShowLogo ? assets.find((asset) => asset.id === theme.components.eventLogo.assetId)?.url ?? null : null}
          imageUrl={transition.bandImageAssetId ? assets.find((asset) => asset.id === transition.bandImageAssetId)?.url ?? null : null}
        />
      ) : null}
    </div>
  );
}
