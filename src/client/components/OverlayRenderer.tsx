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
    borderRadius: component.borderRadius,
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
  >,
  assets: StoredAsset[]
): { background: CSSProperties; overlay: CSSProperties | null } {
  const backgroundAsset = component.backgroundImageAssetId
    ? assets.find((asset) => asset.id === component.backgroundImageAssetId)
    : null;

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

function mergedBackgroundStyles(base: CSSProperties, assetUrl: string | null, fit: ThemeDefinition["components"]["homeName"]["backgroundImageFit"], position: ThemeDefinition["components"]["homeName"]["backgroundImagePosition"]): CSSProperties {
  if (!assetUrl) {
    return base;
  }

  return {
    ...base,
    backgroundImage: `url("${assetUrl}")`,
    backgroundSize: resolveBackgroundSize(fit),
    backgroundPosition: resolveBackgroundPosition(position),
    backgroundRepeat: "no-repeat"
  };
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
  const [centerSecondaryAnimationTick, setCenterSecondaryAnimationTick] = useState(0);
  const previousTeamEventRef = useRef<NormalizedLiveState["teamEvent"]>("none");
  const previousCenterSecondaryVariantRef = useRef<"timer" | "staticText" | "hidden" | null>(null);
  // Towel animation repeat state
  const [towelAnimationTick, setTowelAnimationTick] = useState(0);
  const towelIntervalRef = useRef<number | null>(null);
  const currentTeamEvent = live?.teamEvent ?? "none";
  // Repeating towel animation logic
  useEffect(() => {
    if (!live || currentTeamEvent === "none") {
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
  }, [currentTeamEvent, live, overlayGeneral.durationMs]);

  useEffect(() => {
    if (!live || !overlayGeneral.enabled) {
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
  }, [currentTeamEvent, live?.round, live?.sidesSwitched, overlayGeneral.enabled, live]);

  // Remove timeout logic: activeConcede is now persistent while teamEvent is active

  const centerSecondaryPresentation = useMemo(() => resolveCenterSecondaryPresentation(theme, live), [theme, live]);

  useEffect(() => {
    const previousVariant = previousCenterSecondaryVariantRef.current;
    const nextVariant = centerSecondaryPresentation.variant;
    previousCenterSecondaryVariantRef.current = nextVariant;

    if (!previousVariant || previousVariant === nextVariant) {
      return;
    }

    if ((previousVariant === "timer" && nextVariant === "staticText") || (previousVariant === "staticText" && nextVariant === "timer")) {
      setCenterSecondaryAnimationTick((current) => current + 1);
    }
  }, [centerSecondaryPresentation.variant]);

  const concedeLabel = useMemo(() => {
    if (!overlayGeneral.enabled || !activeConcede) {
      return null;
    }

    const logoComponent = activeConcede.side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
    if (overlayGeneral.followLogoSize && logoComponent.visible) {
      const inset = Math.max(0, logoComponent.padding);
      const width = Math.max(1, logoComponent.width - inset * 2);
      const height = Math.max(1, logoComponent.height - inset * 2);
      return {
        x: logoComponent.x + inset,
        y: logoComponent.y + inset,
        width,
        height,
        token: activeConcede.token
      };
    }

    const nameComponent = activeConcede.side === "left" ? theme.components.homeName : theme.components.awayName;
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
        token: activeConcede.token
      };
    }

    if (overlayGeneral.placementMode === "top-ribbon") {
      return {
        x: group.x + overlayGeneral.offsetX,
        y: anchoredY,
        width: group.width,
        height: overlayGeneral.height,
        token: activeConcede.token
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
      token: activeConcede.token
    };
  }, [activeConcede, overlayGeneral, theme]);

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
        assets
      )
    : null;
  const concedeText = activeConcedeTheme?.text ?? "";
  const concedeTextColor = activeConcedeTheme?.color ?? "#ffffff";

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
        const commonClass = editable && selectedComponentId === componentId ? "component-slot selected" : "component-slot";
        if (component.kind === "image") {
          const imageAsset = resolveImageAsset(componentId, component, theme, live, assets);
          const surface = surfaceStyles(component, assets);
          const isTeamLogo = componentId === "homeTeamLogo" || componentId === "awayTeamLogo";
          const backgroundSurface = isTeamLogo
            ? mergedBackgroundStyles(
                surface.background,
                imageAsset?.url ?? null,
                component.backgroundImageFit,
                component.backgroundImagePosition
              )
            : surface.background;
          return (
            <button
              key={componentId}
              type="button"
              className={commonClass}
              style={imageStyles(component)}
              onClick={() => onSelectComponent?.(componentId)}
            >
              <span className="component-surface" style={backgroundSurface} />
              {surface.overlay ? (
                <span className="component-surface-overlay" style={surface.overlay ?? undefined} />
              ) : null}
              <span className="component-content image-content" style={{ padding: component.padding }}>
                {!isTeamLogo && imageAsset ? (
                  <img
                    alt={imageAsset.originalName}
                    src={imageAsset.url}
                    className="event-logo-image"
                    style={{
                      objectFit: resolveObjectFit(component.backgroundImageFit),
                      objectPosition: resolveBackgroundPosition(component.backgroundImagePosition)
                    }}
                  />
                ) : editable && !imageAsset ? (
                  <span>Logo</span>
                ) : null}
              </span>
            </button>
          );
        }

        const surface = surfaceStyles(component, assets);
        const content = componentId === "breakTime" ? centerSecondaryPresentation.content : resolveTextContent(theme, componentId, live);
        const visible = component.visible && content !== null && content !== "";
        const centerSecondaryStyle =
          componentId === "breakTime"
            ? centerSecondaryPresentation.variant === "timer"
              ? theme.centerSecondary.timerStyle
              : centerSecondaryPresentation.variant === "staticText"
                ? theme.centerSecondary.staticStyle
                : null
            : null;
        const centerSecondaryAnimationName =
          componentId === "breakTime"
            ? theme.centerSecondary.transition.animation === "fade"
              ? "center-secondary-fade"
              : theme.centerSecondary.transition.animation === "slide-up"
                ? "center-secondary-slide-up"
                : "none"
            : "none";

        return (
          <button
            key={componentId}
            type="button"
            className={commonClass}
            style={{ ...frameStyles(component), display: visible ? "flex" : "none" }}
            onClick={() => onSelectComponent?.(componentId)}
          >
            <span className="component-surface" style={surface.background} />
            {surface.overlay ? <span className="component-surface-overlay" style={surface.overlay} /> : null}
            <span
              key={componentId === "breakTime" ? `${centerSecondaryPresentation.variant}:${centerSecondaryAnimationTick}` : undefined}
              className="component-content text-content"
              style={{
                justifyContent:
                  component.textAlign === "left" ? "flex-start" : component.textAlign === "right" ? "flex-end" : "center",
                padding: component.padding,
                color: centerSecondaryStyle?.color ?? component.color,
                fontFamily: `"${centerSecondaryStyle?.fontFamily ?? component.fontFamily}", sans-serif`,
                fontSize: centerSecondaryStyle?.fontSize ?? component.fontSize,
                fontWeight: centerSecondaryStyle?.fontWeight ?? component.fontWeight,
                letterSpacing: component.letterSpacing,
                lineHeight: component.lineHeight,
                animation:
                  componentId === "breakTime" &&
                  centerSecondaryAnimationTick > 0 &&
                  centerSecondaryAnimationName !== "none"
                    ? `${centerSecondaryAnimationName} ${theme.centerSecondary.transition.durationMs}ms ease`
                    : undefined
              }}
            >
              {content}
            </span>
          </button>
        );
      })}

      {concedeLabel && live && currentTeamEvent !== "none" ? (
        <div
          key={concedeLabel.token}
          className="concede-label"
          style={{
            left: concedeLabel.x,
            top: concedeLabel.y,
            width: concedeLabel.width,
            height: concedeLabel.height,
            border: `${overlayGeneral.borderWidth}px solid ${overlayGeneral.borderColor}`,
            borderRadius: overlayGeneral.borderRadius,
            boxShadow: overlayGeneral.shadow
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
            <span className="component-surface" style={activeConcedeSurface?.background} />
            {activeConcedeSurface?.overlay ? <span className="component-surface-overlay" style={activeConcedeSurface.overlay} /> : null}
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
                color: concedeTextColor,
                fontFamily: `"${overlayGeneral.fontFamily}", sans-serif`,
                fontSize: overlayGeneral.fontSize,
                fontWeight: overlayGeneral.fontWeight,
                letterSpacing: overlayGeneral.letterSpacing,
                lineHeight: 1
              }}
            >
              {concedeText}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
