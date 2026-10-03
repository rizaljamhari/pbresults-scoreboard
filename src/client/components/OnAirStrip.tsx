import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Monitor, RectangleHorizontal } from "lucide-react";
import type { NormalizedLiveState, StoredAsset, ThemeDefinition } from "../../shared/theme";
import { OverlayRenderer } from "./OverlayRenderer";
import { ScaledCanvasFrame } from "./ScaledCanvasFrame";
import { Button, Chip, Dot, Grow } from "./admin/kit";
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

const FEED_STATUS: Record<NormalizedLiveState["sourceStatus"], string> = {
  ok: "Live",
  error: "Unreachable",
  paused: "Paused",
  idle: "Waiting"
};

/**
 * What vMix shows, drawn by the same renderer the overlay uses, with the raw feed underneath so the two can be
 * compared. "Scoreboard" crops to the band the theme actually occupies so names, scores and operator text are
 * readable; "Full frame" shows the whole 1920 × 1080.
 */
export function OnAirStrip({
  theme,
  live,
  assets,
  operatorTextValues,
  reduceMotion = false,
  entranceToken = null,
  scoreboardVisible = true,
  markers,
  summary,
  overlayStatus = null,
  rehearsalLabel = null
}: {
  theme: ThemeDefinition | null;
  live: NormalizedLiveState | null;
  assets: StoredAsset[];
  operatorTextValues: Record<string, string>;
  /** Mirrors the operator's Reduce motion switch, so the strip matches vMix. */
  reduceMotion?: boolean;
  /** Mirrors the operator's Play entrance. */
  entranceToken?: number | null;
  /** Mirrors the operator's Show / Hide, transition included. */
  scoreboardVisible?: boolean;
  markers: StripMarker[];
  /** The raw feed in one line: names and scores as the feed sends them, clock, state and period. */
  summary: ReactNode;
  /** Whether the page vMix loads is connected and current; opens the overlay pages list. */
  overlayStatus?: { level: "ok" | "info" | "warning" | "critical"; label: string; onOpen: () => void } | null;
  /** While rehearsing, what the strip (and vMix) shows is a test case, not the feed. */
  rehearsalLabel?: string | null;
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
        {theme ? (
          // The theme name is the heading; the red dot is the tally light, so the section reads as on air.
          <h2 id="on-air-title" className="ad-title ad-strip-title" title="Theme on air">
            <Dot tone="tally" flat />
            {theme.name}
          </h2>
        ) : (
          <h2 id="on-air-title" className="ad-title ad-strip-title">
            <Chip tone="critical">No theme on air</Chip>
          </h2>
        )}
        {rehearsalLabel ? (
          <Chip tone="rehearsal">
            <Dot tone="rehearsal" flat />
            {rehearsalLabel}
          </Chip>
        ) : null}
        {overlayStatus ? (
          <button type="button" className="ad-strip-overlay" onClick={overlayStatus.onOpen} title="Show the pages showing the overlay">
            <Chip tone={overlayStatus.level === "ok" ? "ok" : overlayStatus.level === "info" ? "quiet" : overlayStatus.level}>
              <Dot tone={overlayStatus.level === "ok" ? "live" : overlayStatus.level === "info" ? undefined : overlayStatus.level} flat />
              {overlayStatus.label}
            </Chip>
          </button>
        ) : null}
        <Grow />
        <PreviewMenu view={view} onView={setView} backdrop={backdrop} onBackdrop={setBackdrop} theme={theme} />
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
                <OverlayRenderer theme={theme} live={live} assets={assets} operatorTextValues={operatorTextValues} reduceMotion={reduceMotion} entranceToken={entranceToken} scoreboardVisible={scoreboardVisible} transparentBackground />
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
              <OverlayRenderer theme={theme} live={live} assets={assets} operatorTextValues={operatorTextValues} reduceMotion={reduceMotion} entranceToken={entranceToken} scoreboardVisible={scoreboardVisible} transparentBackground />
            </ScaledCanvasFrame>
          </div>
        )}
        {theme && !scoreboardVisible ? (
          // An empty preview should never look like a fault.
          <p className="ad-strip-hidden" role="status">
            Scoreboard hidden · press <kbd className="ad-kbd">H</kbd> to show
          </p>
        ) : null}
      </div>

      <div className="ad-strip-feed">
        <span className="ad-strip-feed-k">Feed</span>
        {live && live.sourceStatus !== "ok" ? (
          <Chip tone={live.sourceStatus === "error" ? "critical" : "warning"}>
            <Dot tone={live.sourceStatus === "error" ? "critical" : "warning"} flat />
            {FEED_STATUS[live.sourceStatus]}
          </Chip>
        ) : null}
        <span className="ad-strip-feed-v">{summary}</span>
      </div>
    </section>
  );
}

/** How the preview is drawn: what part of the frame, and on what backdrop. Remembered on this computer. */
function PreviewMenu({
  view,
  onView,
  backdrop,
  onBackdrop,
  theme
}: {
  view: View;
  onView: (view: View) => void;
  backdrop: Backdrop;
  onBackdrop: (backdrop: Backdrop) => void;
  theme: ThemeDefinition | null;
}) {
  const backdrops: Array<{ value: Backdrop; label: string; hint?: string }> = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "theme", label: "Theme background", hint: theme ? `${theme.canvas.backgroundColor}, what vMix keys out` : undefined }
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="sm" title="How the preview is drawn">
          {view === "band" ? <RectangleHorizontal aria-hidden /> : <Monitor aria-hidden />}
          Preview
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ad-scope ad-pop" align="end" sideOffset={6}>
          <DropdownMenu.Label className="ad-menu-label">Show</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={view} onValueChange={(value) => onView(value as View)}>
            <PreviewChoice value="band" icon={<RectangleHorizontal aria-hidden />} label="Scoreboard" hint="The part the scoreboard uses" />
            <PreviewChoice value="frame" icon={<Monitor aria-hidden />} label="Full frame" hint="The whole frame" />
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="ad-menu-sep" />
          <DropdownMenu.Label className="ad-menu-label">Backdrop</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={backdrop} onValueChange={(value) => onBackdrop(value as Backdrop)}>
            {backdrops.map((option) => (
              <PreviewChoice
                key={option.value}
                value={option.value}
                icon={
                  <span
                    className={`ad-backdrop ad-backdrop--${option.value}`}
                    style={option.value === "theme" && theme ? { background: theme.canvas.backgroundColor } : undefined}
                    aria-hidden
                  />
                }
                label={option.label}
                hint={option.hint}
              />
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PreviewChoice({ value, icon, label, hint }: { value: string; icon: ReactNode; label: string; hint?: string }) {
  return (
    <DropdownMenu.RadioItem value={value} className="ad-menu-item" title={hint}>
      {icon}
      {label}
      <DropdownMenu.ItemIndicator className="ad-menu-end">
        <Check aria-hidden />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}
