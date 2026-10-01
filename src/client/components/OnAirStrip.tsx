import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Copy, ArrowUpRight, Monitor, RectangleHorizontal } from "lucide-react";
import type { NormalizedLiveState, StoredAsset, ThemeDefinition } from "../../shared/theme";
import { OverlayRenderer } from "./OverlayRenderer";
import { ScaledCanvasFrame } from "./ScaledCanvasFrame";
import { Chip, Dot, Grow, IconButton, Segmented } from "./admin/kit";
import { scoreboardBand, teamSideRect } from "../pages/operationsStrip";

type View = "band" | "frame";
type Backdrop = "light" | "dark" | "theme";

export type StripMarker = { side: "left" | "right"; tone: "warning" | "critical"; label: string };

const VIEW_KEY = "pbresults.operations.stripView";
const BACKDROP_KEY = "pbresults.operations.stripBackdrop";
// Keeps Team names in view on a laptop; Full frame is there for detail.
const MAX_BAND_HEIGHT = 240;

// Light by default in both admin themes: most scoreboards use dark, semi-transparent panels that vanish on dark.
function readBackdrop(): Backdrop {
  try {
    const stored = window.localStorage.getItem(BACKDROP_KEY);
    return stored === "dark" || stored === "theme" ? stored : "light";
  } catch {
    return "light";
  }
}

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "frame" ? "frame" : "band";
  } catch {
    return "band";
  }
}

/**
 * What vMix shows, drawn by the same renderer the overlay uses. "Scoreboard" crops to the band the theme actually
 * occupies so names, scores and operator text are readable; "Full frame" shows the whole 1920 × 1080.
 */
export function OnAirStrip({
  theme,
  live,
  assets,
  operatorTextValues,
  markers,
  summary,
  overlayUrl,
  onCopyUrl,
  overlayStatus = null
}: {
  theme: ThemeDefinition | null;
  live: NormalizedLiveState | null;
  assets: StoredAsset[];
  operatorTextValues: Record<string, string>;
  markers: StripMarker[];
  summary: ReactNode;
  overlayUrl: string;
  onCopyUrl: () => void;
  /** Whether the page vMix loads is connected and current; opens the overlay pages list. */
  overlayStatus?: { level: "ok" | "info" | "warning" | "critical"; label: string; onOpen: () => void } | null;
}) {
  const [view, setView] = useState<View>(readView);
  const [backdrop, setBackdrop] = useState<Backdrop>(readBackdrop);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch {
      // The choice still holds for this visit.
    }
  }, [view]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BACKDROP_KEY, backdrop);
    } catch {
      // The choice still holds for this visit.
    }
  }, [backdrop]);

  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => setStageWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, Boolean(theme)]);

  const band = theme ? scoreboardBand(theme) : null;
  const scale = band && stageWidth ? Math.min(stageWidth / band.width, MAX_BAND_HEIGHT / band.height) : 0;

  return (
    <section className="ad-surface ad-strip" aria-labelledby="on-air-title">
      <div className="ad-strip-head">
        <h2 id="on-air-title" className="ad-title">
          On air
        </h2>
        {theme ? (
          <Chip tone="air">
            <Dot tone="tally" flat />
            {theme.name}
          </Chip>
        ) : (
          <Chip tone="critical">No theme on air</Chip>
        )}
        {overlayStatus ? (
          <button type="button" className="ad-strip-overlay" onClick={overlayStatus.onOpen} title="Show the pages showing the overlay">
            <Chip tone={overlayStatus.level === "ok" ? "ok" : overlayStatus.level === "info" ? "quiet" : overlayStatus.level}>
              <Dot tone={overlayStatus.level === "ok" ? "live" : overlayStatus.level === "info" ? undefined : overlayStatus.level} flat />
              {overlayStatus.label}
            </Chip>
          </button>
        ) : null}
        <span className="ad-strip-meta">{summary}</span>
        <Grow />
        <Segmented
          label="Preview"
          value={view}
          onChange={setView}
          options={[
            { value: "band", label: <><RectangleHorizontal aria-hidden />Scoreboard</>, title: "Only the part of the frame the scoreboard uses" },
            { value: "frame", label: <><Monitor aria-hidden />Full frame</>, title: "The whole 1920 × 1080 frame" }
          ]}
        />
        <div className="ad-backdrops" role="radiogroup" aria-label="Backdrop behind the graphics">
          {(
            [
              { value: "light", label: "Light backdrop" },
              { value: "dark", label: "Dark backdrop" },
              { value: "theme", label: theme ? `Theme background (${theme.canvas.backgroundColor}), what vMix keys out` : "Theme background" }
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={backdrop === option.value}
              aria-label={option.label}
              title={option.label}
              className={`ad-backdrop ad-backdrop--${option.value}`}
              style={option.value === "theme" && theme ? { background: theme.canvas.backgroundColor } : undefined}
              onClick={() => setBackdrop(option.value)}
            />
          ))}
        </div>
        <span className="ad-tb-sep" />
        <a className="ad-icon-btn" href={overlayUrl} target="_blank" rel="noreferrer" aria-label="Open the live overlay" title="Open the live overlay">
          <ArrowUpRight />
        </a>
        <IconButton label="Copy the vMix URL" onClick={onCopyUrl}>
          <Copy />
        </IconButton>
      </div>

      <div
        className={`ad-strip-stage ad-strip-stage--${backdrop}`}
        style={backdrop === "theme" && theme ? { background: theme.canvas.backgroundColor } : undefined}
        ref={stageRef}
      >
        {!theme ? (
          <p className="ad-hint ad-strip-empty">Nothing is on air. Put a theme on air from Themes.</p>
        ) : view === "band" && band ? (
          scale > 0 ? (
            <div className="ad-strip-band" style={{ width: band.width * scale, height: band.height * scale }}>
              <div
                className="ad-strip-canvas"
                style={{
                  width: theme.canvas.width,
                  height: theme.canvas.height,
                  transform: `translate(${-band.x * scale}px, ${-band.y * scale}px) scale(${scale})`
                }}
                aria-hidden
              >
                <OverlayRenderer theme={theme} live={live} assets={assets} operatorTextValues={operatorTextValues} transparentBackground />
              </div>
              {markers.map((marker) => {
                const rect = teamSideRect(theme, marker.side);
                if (!rect) return null;
                return (
                  <span
                    key={marker.side}
                    className={`ad-strip-mark is-${marker.tone}`}
                    style={{
                      left: `${((rect.x - band.x) / band.width) * 100}%`,
                      top: `${((rect.y - band.y) / band.height) * 100}%`,
                      width: `${(rect.width / band.width) * 100}%`,
                      height: `${(rect.height / band.height) * 100}%`
                    }}
                  >
                    <em>{marker.label}</em>
                  </span>
                );
              })}
            </div>
          ) : null
        ) : (
          <div className="ad-strip-frame">
            <ScaledCanvasFrame width={theme.canvas.width} height={theme.canvas.height} className="ad-strip-frame-box" innerClassName="ad-strip-frame-stage" mode="width">
              <OverlayRenderer theme={theme} live={live} assets={assets} operatorTextValues={operatorTextValues} transparentBackground />
            </ScaledCanvasFrame>
          </div>
        )}
        {theme ? (
          <span className="ad-strip-live">
            <Dot tone={live?.sourceStatus === "ok" ? "live" : live?.sourceStatus === "error" ? "critical" : "warning"} flat />
            {live?.sourceStatus === "ok" ? "Live" : live?.sourceStatus === "error" ? "Feed unreachable" : live?.sourceStatus === "paused" ? "Paused" : "Waiting"}
          </span>
        ) : null}
      </div>
    </section>
  );
}
