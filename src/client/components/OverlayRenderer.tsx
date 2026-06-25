import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatClock } from "../../shared/normalize";
import type { NormalizedLiveState, StoredAsset, ThemeDefinition, ComponentId } from "../../shared/theme";

type OverlayRendererProps = {
  theme: ThemeDefinition;
  live: NormalizedLiveState | null;
  assets?: StoredAsset[];
  editable?: boolean;
  selectedComponentId?: ComponentId | null;
  onSelectComponent?: (id: ComponentId) => void;
};

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

const TEAM_SWITCH_ANIMATION_MS = 600;
const TEAM_SWITCH_COOLDOWN_MS = 2200;
const BREAK_TIMEOUT_DEFAULT_THRESHOLD_SECONDS = 45;

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

function resolveObjectFit(fit: ThemeDefinition["components"]["homeName"]["backgroundImageFit"]) {
  switch (fit) {
    case "contain":
      return "contain";
    case "stretch":
      return "fill";
    default:
      return "cover";
  }
}

function frameStyles(component: ThemeDefinition["components"][ComponentId]): CSSProperties {
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
    padding: 0
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
  > & { backgroundImageMode?: "asset" | "homeTeamLogo" | "awayTeamLogo" },
  assets: StoredAsset[],
  theme: ThemeDefinition,
  live: NormalizedLiveState | null
): { background: CSSProperties; overlay: CSSProperties | null } {
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

  return {
    background: {
      backgroundColor: component.backgroundColor,
      backgroundImage: backgroundAsset ? `url("${backgroundAsset.url}")` : undefined,
      backgroundSize: backgroundAsset ? resolveBackgroundSize(component.backgroundImageFit) : undefined,
      backgroundPosition: backgroundAsset ? resolveBackgroundPosition(component.backgroundImagePosition) : undefined,
      backgroundRepeat: "no-repeat"
    },
    overlay:
      component.backgroundOverlayOpacity > 0
        ? {
            background: component.backgroundOverlayColor,
            opacity: component.backgroundOverlayOpacity
          }
        : null
  };
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

function resolveCenterSecondaryPresentation(theme: ThemeDefinition, live: NormalizedLiveState | null) {
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

function resolveEventLabelRect(
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

export function OverlayRenderer({
  theme,
  live,
  assets = [],
  editable = false,
  selectedComponentId,
  onSelectComponent
}: OverlayRendererProps) {
  const overlayGeneral = theme.teamEventOverlay.general;
  const [activeConcede, setActiveConcede] = useState<{ side: "left" | "right"; eventType: "towel" | "base"; until: number; token: string } | null>(null);
  const [teamSwitchToken, setTeamSwitchToken] = useState<number | null>(null);
  const [teamSwitchPayload, setTeamSwitchPayload] = useState<{
    token: number;
    from: NormalizedLiveState;
    to: NormalizedLiveState;
  } | null>(null);
  const [breakTimeoutToken, setBreakTimeoutToken] = useState<number | null>(null);
  const [centerSecondaryAnimationTick, setCenterSecondaryAnimationTick] = useState(0);
  const [centerSecondaryExitActive, setCenterSecondaryExitActive] = useState(false);
  const previousTeamEventRef = useRef<NormalizedLiveState["teamEvent"]>("none");
  const previousCenterSecondaryVariantRef = useRef<"timer" | "staticText" | "hidden" | null>(null);
  const previousCenterSecondaryPresentationRef = useRef<{ variant: "timer" | "staticText" | "hidden"; content: string } | null>(null);
  const previousSwitchSnapshotRef = useRef<OverlaySnapshot | null>(null);
  const previousSwitchLiveRef = useRef<NormalizedLiveState | null>(null);
  const lastTeamSwitchAtRef = useRef(0);
  const teamSwitchClearTimeoutRef = useRef<number | null>(null);
  const previousBreakLiveRef = useRef<NormalizedLiveState | null>(null);
  const breakTimeoutClearTimeoutRef = useRef<number | null>(null);
  // Towel animation repeat state
  const [towelAnimationTick, setTowelAnimationTick] = useState(0);
  const towelIntervalRef = useRef<number | null>(null);
  const currentTeamEvent = live?.teamEvent ?? "none";
  const finishState = useMemo(() => {
    if (!theme.centerSecondary.gameFinished.enabled || !live || live.sourceStatus !== "ok" || live.state !== "END" || live.period !== "BREAK") {
      return null;
    }
    const snapshot = createOverlaySnapshot(live);
    const token = `${snapshot.round}|${snapshot.leftName}|${snapshot.rightName}|${snapshot.leftScore}|${snapshot.rightScore}`;
    return { token, snapshot };
  }, [live, theme.centerSecondary.gameFinished.enabled]);
  const gameFinishToken = finishState?.token ?? null;
  const winnerReveal = useMemo(() => {
    if (!finishState) {
      return null;
    }
    const winnerSide = winnerSideFromSnapshot(finishState.snapshot);
    if (!winnerSide) {
      return null;
    }
    return {
      side: winnerSide,
      token: `${finishState.token}|${winnerSide}`
    };
  }, [finishState]);
  const majorAnimationActive = Boolean(gameFinishToken || winnerReveal);

  useEffect(
    () => () => {
      if (teamSwitchClearTimeoutRef.current !== null) {
        clearTimeout(teamSwitchClearTimeoutRef.current);
      }
      if (breakTimeoutClearTimeoutRef.current !== null) {
        clearTimeout(breakTimeoutClearTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!theme.centerSecondary.timeout.enabled) {
      previousBreakLiveRef.current = live;
      if (breakTimeoutClearTimeoutRef.current !== null) {
        clearTimeout(breakTimeoutClearTimeoutRef.current);
        breakTimeoutClearTimeoutRef.current = null;
      }
      setBreakTimeoutToken(null);
      return;
    }

    if (!live || live.sourceStatus !== "ok") {
      previousBreakLiveRef.current = live;
      return;
    }

    const previous = previousBreakLiveRef.current;
    previousBreakLiveRef.current = live;

    if (!previous || majorAnimationActive || !theme.centerSecondary.timeout.enabled) {
      return;
    }

    const inBreakNow = live.period === "BREAK" && live.state !== "END";
    const wasInBreak = previous.period === "BREAK" && previous.state !== "END";
    if (!inBreakNow || !wasInBreak) {
      return;
    }

    if (previous.breakTimer.value <= 10) {
      return;
    }

    const increase = live.breakTimer.value - previous.breakTimer.value;
    const threshold = theme.centerSecondary.timeout.minIncreaseSeconds || BREAK_TIMEOUT_DEFAULT_THRESHOLD_SECONDS;
    if (increase < threshold || live.breakTimer.value < threshold) {
      return;
    }

    const token = Date.now();
    setBreakTimeoutToken(token);
    if (breakTimeoutClearTimeoutRef.current !== null) {
      clearTimeout(breakTimeoutClearTimeoutRef.current);
    }
    breakTimeoutClearTimeoutRef.current = window.setTimeout(() => {
      setBreakTimeoutToken((current) => (current === token ? null : current));
      breakTimeoutClearTimeoutRef.current = null;
    }, theme.centerSecondary.timeout.durationMs);
  }, [live, majorAnimationActive, theme.centerSecondary.timeout]);

  useEffect(() => {
    if (!overlayGeneral.teamSwitchEnabled) {
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
    }, TEAM_SWITCH_ANIMATION_MS);
  }, [live, majorAnimationActive, overlayGeneral.teamSwitchEnabled]);

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
    // Animation duration: match teamEventOverlay.durationMs or use a default
    const duration = overlayGeneral.durationMs || 1200;
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
  }, [currentTeamEvent, live, majorAnimationActive, overlayGeneral.durationMs]);

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

  const centerSecondaryPresentation = useMemo(() => resolveCenterSecondaryPresentation(theme, live), [theme, live]);

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

    if (nextVariant === "hidden") {
      setCenterSecondaryExitActive(true);
      const timerId = setTimeout(() => {
        setCenterSecondaryExitActive(false);
      }, theme.centerSecondary.transition.durationMs);
      return () => clearTimeout(timerId);
    } else {
      setCenterSecondaryAnimationTick((current) => current + 1);
      setCenterSecondaryExitActive(false);
      previousCenterSecondaryPresentationRef.current = centerSecondaryPresentation;
    }
  }, [centerSecondaryPresentation, theme.centerSecondary.transition.durationMs]);

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
          backgroundOverlayOpacity: activeConcedeTheme.backgroundOverlayOpacity
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
      backgroundOverlayOpacity: winnerTheme.backgroundOverlayOpacity
    },
    assets,
    theme,
    live
  );
  const winnerText = winnerTheme.text?.trim() || "WINNER";
  const defaultEventLabel = concedeLabel && live && currentTeamEvent !== "none" ? concedeLabel : null;
  const activeOverlayLabel = winnerLabel ?? defaultEventLabel;

  return (
    <div
      className={editable ? "overlay-canvas editable" : "overlay-canvas"}
      style={{
        width: theme.canvas.width,
        height: theme.canvas.height,
        background: theme.canvas.backgroundColor
      }}
    >
      {editable && theme.canvas.safeArea ? <div className="safe-area" /> : null}

      {(
        Object.entries(theme.components) as Array<[ComponentId, ThemeDefinition["components"][ComponentId]]>
      ).map(([componentId, component]) => {
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
          const backgroundSurface = surface.background;
          const previousImageAsset =
            teamSwitchActive && teamSwitchPayload
              ? resolveImageAsset(componentId, component, theme, teamSwitchPayload.from, assets)
              : null;
          const nextImageAsset =
            teamSwitchActive && teamSwitchPayload
              ? resolveImageAsset(componentId, component, theme, teamSwitchPayload.to, assets)
              : null;
          return (
            <button
              key={componentId}
              type="button"
              className={commonClass}
              style={imageStyles(component)}
              onClick={() => onSelectComponent?.(componentId)}
            >
              <span className="component-body">
                <span className="component-surface" style={backgroundSurface} />
                {surface.overlay ? <span className="component-surface-overlay" style={surface.overlay ?? undefined} /> : null}
                {teamSwitchActive && isTeamLogo && teamSwitchPayload ? (
                  <>
                    <span
                      className="component-content image-content"
                      style={{
                        padding: resolveComponentPadding(component),
                        ...resolveComponentOffset(component),
                        animation: `overlay-team-switch-out ${TEAM_SWITCH_ANIMATION_MS}ms cubic-bezier(0.42, 0, 1, 1) both`,
                        position: "absolute",
                        inset: 0,
                        zIndex: 2,
                        transformOrigin: "center center",
                        willChange: "transform, opacity",
                        backfaceVisibility: "hidden"
                      }}
                    >
                      {previousImageAsset ? (
                        <img
                          alt={previousImageAsset.originalName}
                          src={previousImageAsset.url}
                          className="event-logo-image"
                          style={{
                            objectFit: resolveObjectFit(component.backgroundImageFit),
                            objectPosition: resolveBackgroundPosition(component.backgroundImagePosition)
                          }}
                        />
                      ) : null}
                    </span>
                    <span
                      className="component-content image-content"
                      style={{
                        padding: resolveComponentPadding(component),
                        ...resolveComponentOffset(component),
                        animation: `overlay-team-switch-in ${TEAM_SWITCH_ANIMATION_MS}ms cubic-bezier(0, 0, 0.2, 1) both`,
                        position: "absolute",
                        inset: 0,
                        zIndex: 3,
                        transformOrigin: "center center",
                        willChange: "transform, opacity",
                        backfaceVisibility: "hidden"
                      }}
                    >
                      {nextImageAsset ? (
                        <img
                          alt={nextImageAsset.originalName}
                          src={nextImageAsset.url}
                          className="event-logo-image"
                          style={{
                            objectFit: resolveObjectFit(component.backgroundImageFit),
                            objectPosition: resolveBackgroundPosition(component.backgroundImagePosition)
                          }}
                        />
                      ) : null}
                    </span>
                  </>
                ) : (
                  <span className="component-content image-content" style={{ padding: resolveComponentPadding(component), ...resolveComponentOffset(component) }}>
                    {imageAsset ? (
                      <img
                        alt={imageAsset.originalName}
                        src={imageAsset.url}
                        className="event-logo-image"
                        style={{
                          objectFit: resolveObjectFit(component.backgroundImageFit),
                          objectPosition: resolveBackgroundPosition(component.backgroundImagePosition)
                        }}
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
        const isGameFinishSecondaryOverlay = componentId === "breakTime" && Boolean(gameFinishToken);
        
        let content = isGameFinishSecondaryOverlay ? "GAME FINISHED" : baseContent;
        let visible = component.visible && content !== null && content !== "";

        if (componentId === "breakTime" && centerSecondaryExitActive && previousCenterSecondaryPresentationRef.current) {
          content = previousCenterSecondaryPresentationRef.current.content;
          visible = component.visible && content !== null && content !== "";
        }

        const showBreakTimeoutOverlay =
          componentId === "breakTime" &&
          Boolean(breakTimeoutToken) &&
          theme.centerSecondary.timeout.enabled &&
          live?.period === "BREAK" &&
          !isGameFinishSecondaryOverlay;
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
        const centerSecondaryAnimationName =
          componentId === "breakTime"
            ? theme.centerSecondary.transition.animation === "fade"
              ? "center-secondary-fade"
              : theme.centerSecondary.transition.animation === "slide-up"
                ? "center-secondary-slide-up"
                : theme.centerSecondary.transition.animation === "slide-left"
                  ? "center-secondary-slide-left"
                  : theme.centerSecondary.transition.animation === "slide-right"
                    ? "center-secondary-slide-right"
                    : "none"
            : "none";
        const contentKey =
          componentId === "breakTime"
            ? isGameFinishSecondaryOverlay
              ? `game-finish:${gameFinishToken}`
              : centerSecondaryExitActive
                ? `exit:${centerSecondaryAnimationTick}`
                : `${activeVariant}:${centerSecondaryAnimationTick}`
            : undefined;
        const contentAnimation =
          isGameFinishSecondaryOverlay
            ? "center-secondary-slide-up 220ms ease"
            : componentId === "breakTime" && centerSecondaryExitActive && centerSecondaryAnimationName !== "none"
              ? `${centerSecondaryAnimationName} ${theme.centerSecondary.transition.durationMs}ms ease reverse`
              : componentId === "breakTime" &&
                  centerSecondaryAnimationTick > 0 &&
                  centerSecondaryAnimationName !== "none"
                ? `${centerSecondaryAnimationName} ${theme.centerSecondary.transition.durationMs}ms ease`
                : undefined;

        return (
          <button
            key={componentId}
            type="button"
            className={commonClass}
            style={{ ...frameStyles(component), display: visible ? "flex" : "none" }}
            onClick={() => onSelectComponent?.(componentId)}
          >
            <span className="component-body">
              <span className="component-surface" style={surface.background} />
              {surface.overlay ? <span className="component-surface-overlay" style={surface.overlay} /> : null}
              {teamSwitchActive && teamSwitchPayload ? (
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
                      animation: `overlay-team-switch-out ${TEAM_SWITCH_ANIMATION_MS}ms cubic-bezier(0.42, 0, 1, 1) both`,
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      transformOrigin: "center center",
                      willChange: "transform, opacity",
                      backfaceVisibility: "hidden"
                    }}
                  >
                    {previousSwitchContent}
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
                      animation: `overlay-team-switch-in ${TEAM_SWITCH_ANIMATION_MS}ms cubic-bezier(0, 0, 0.2, 1) both`,
                      position: "absolute",
                      inset: 0,
                      zIndex: 3,
                      transformOrigin: "center center",
                      willChange: "transform, opacity",
                      backfaceVisibility: "hidden"
                    }}
                  >
                    {nextSwitchContent}
                  </span>
                </>
              ) : (
                <span
                  key={contentKey}
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
                    animation: contentAnimation
                  }}
                >
                  {content}
                </span>
              )}
              {showBreakTimeoutOverlay ? (
                <span
                  key={`break-timeout:${breakTimeoutToken}`}
                  className="component-content text-content center-secondary-timeout-overlay"
                  style={{
                    justifyContent:
                      component.textAlign === "left" ? "flex-start" : component.textAlign === "right" ? "flex-end" : "center",
                    padding: resolveComponentPadding(component),
                    ...resolveComponentOffset(component),
                    background: theme.centerSecondary.timeout.backgroundColor,
                    color: theme.centerSecondary.timeout.color,
                    fontFamily: `"${theme.centerSecondary.timeout.fontFamily}", sans-serif`,
                    fontSize: theme.centerSecondary.timeout.fontSize,
                    fontWeight: theme.centerSecondary.timeout.fontWeight,
                    letterSpacing: theme.centerSecondary.timeout.letterSpacing,
                    lineHeight: component.lineHeight,
                    animation: `center-secondary-timeout-flash ${theme.centerSecondary.timeout.durationMs}ms ease-out both`,
                    zIndex: 5
                  }}
                >
                  {theme.centerSecondary.timeout.text}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}

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
              animation:
                overlayGeneral.animationPreset === "none"
                  ? undefined
                  : `${
                      overlayGeneral.animationPreset === "slide-horizontal"
                        ? "concede-slide-horizontal"
                        : "concede-slide-vertical"
                    } ${overlayGeneral.durationMs}ms ease-in-out infinite alternate`
            }}
          >
            <span className="component-surface" style={winnerLabel ? winnerSurface.background : activeConcedeSurface?.background} />
            {winnerLabel ? (
              winnerSurface.overlay ? <span className="component-surface-overlay" style={winnerSurface.overlay} /> : null
            ) : activeConcedeSurface?.overlay ? (
              <span className="component-surface-overlay" style={activeConcedeSurface.overlay} />
            ) : null}
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
                lineHeight: 1
              }}
            >
              {winnerLabel ? winnerText : concedeText}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
