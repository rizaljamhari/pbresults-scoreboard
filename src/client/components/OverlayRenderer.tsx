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

  if (component.kind !== "image") {
    return null;
  }

  if (componentId === "eventLogo") {
    return findAsset(theme.components.eventLogo.assetId);
  }

  if (componentId === "homeTeamLogo") {
    const team = live?.displayLeftTeamMatch.team;
    return findAsset(team?.logoAssetId ?? team?.alternateLogoAssetId ?? component.assetId);
  }

  if (componentId === "awayTeamLogo") {
    const team = live?.displayRightTeamMatch.team;
    return findAsset(team?.logoAssetId ?? team?.alternateLogoAssetId ?? component.assetId);
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
  const [activeConcede, setActiveConcede] = useState<{ side: "left" | "right"; until: number; token: string } | null>(null);
  const [centerSecondaryAnimationTick, setCenterSecondaryAnimationTick] = useState(0);
  const previousTowelEventRef = useRef<NormalizedLiveState["towelEvent"]>("none");
  const previousCenterSecondaryVariantRef = useRef<"timer" | "staticText" | "hidden" | null>(null);

  useEffect(() => {
    if (!live || !theme.concedeState.enabled) {
      previousTowelEventRef.current = "none";
      return;
    }

    const currentEvent = live.towelEvent;
    const previousEvent = previousTowelEventRef.current;
    previousTowelEventRef.current = currentEvent;

    if (currentEvent === "none" || currentEvent === previousEvent) {
      return;
    }

    const side =
      currentEvent === "home"
        ? live.sidesSwitched === 1
          ? "right"
          : "left"
        : live.sidesSwitched === 1
          ? "left"
          : "right";

    const token = `${currentEvent}:${live.round}:${live.sidesSwitched}:${Date.now()}`;
    setActiveConcede({
      side,
      until: Date.now() + theme.concedeState.durationMs,
      token
    });
  }, [live, theme.concedeState.durationMs, theme.concedeState.enabled]);

  useEffect(() => {
    if (!activeConcede) {
      return;
    }
    const remainingMs = Math.max(0, activeConcede.until - Date.now());
    const timeoutId = window.setTimeout(() => {
      setActiveConcede((current) => (current?.token === activeConcede.token ? null : current));
    }, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeConcede]);

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
    if (!theme.concedeState.enabled || !activeConcede) {
      return null;
    }

    const nameComponent = activeConcede.side === "left" ? theme.components.homeName : theme.components.awayName;
    const logoComponent = activeConcede.side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
    const group = mergeRects(nameComponent, logoComponent.visible ? logoComponent : null);

    if (theme.concedeState.placementMode === "full-panel") {
      return {
        x: group.x + theme.concedeState.offsetX,
        y: group.y + theme.concedeState.offsetY,
        width: group.width,
        height: group.height,
        token: activeConcede.token
      };
    }

    if (theme.concedeState.placementMode === "top-ribbon") {
      return {
        x: group.x + theme.concedeState.offsetX,
        y: group.y + theme.concedeState.offsetY,
        width: group.width,
        height: theme.concedeState.height,
        token: activeConcede.token
      };
    }

    const width = Math.max(160, Math.min(group.width, Math.round(group.width * 0.76)));
    const x = group.x + Math.round((group.width - width) / 2) + theme.concedeState.offsetX;
    const y = group.y + Math.round((group.height - theme.concedeState.height) / 2) + theme.concedeState.offsetY;

    return {
      x,
      y,
      width,
      height: theme.concedeState.height,
      token: activeConcede.token
    };
  }, [activeConcede, theme]);

  const concedeSurface = surfaceStyles(theme.concedeState, assets);

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

      {concedeLabel ? (
        <div
          key={concedeLabel.token}
          className="concede-label"
          style={{
            left: concedeLabel.x,
            top: concedeLabel.y,
            width: concedeLabel.width,
            height: concedeLabel.height,
            border: `${theme.concedeState.borderWidth}px solid ${theme.concedeState.borderColor}`,
            borderRadius: theme.concedeState.borderRadius,
            boxShadow: theme.concedeState.shadow,
            animation:
              theme.concedeState.animationPreset === "none"
                ? undefined
                : `${
                    theme.concedeState.animationPreset === "slide-horizontal"
                      ? "concede-slide-horizontal"
                      : "concede-slide-vertical"
                  } ${theme.concedeState.durationMs}ms ease forwards`
          }}
        >
          <span className="component-surface" style={concedeSurface.background} />
          {concedeSurface.overlay ? <span className="component-surface-overlay" style={concedeSurface.overlay} /> : null}
          <span
            className="component-content text-content"
            style={{
              justifyContent:
                theme.concedeState.textAlign === "left"
                  ? "flex-start"
                  : theme.concedeState.textAlign === "right"
                    ? "flex-end"
                    : "center",
              padding: theme.concedeState.padding,
              color: theme.concedeState.color,
              fontFamily: `"${theme.concedeState.fontFamily}", sans-serif`,
              fontSize: theme.concedeState.fontSize,
              fontWeight: theme.concedeState.fontWeight,
              letterSpacing: theme.concedeState.letterSpacing,
              lineHeight: 1
            }}
          >
            {theme.concedeState.text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
