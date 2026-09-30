import type { ThemeDefinition } from "../../shared/theme";
import { listThemeComponentEntries } from "../../shared/themeComponents";
import { resolveEventLabelRect } from "../components/OverlayRenderer";

export type Rect = { x: number; y: number; width: number; height: number };

const BAND_PADDING = 24;

function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

function placed(component: { x: number; y: number; width: number; height: number; offsetX?: number; offsetY?: number }): Rect {
  return { x: component.x + (component.offsetX ?? 0), y: component.y + (component.offsetY ?? 0), width: component.width, height: component.height };
}

/**
 * The part of the frame the scoreboard occupies: every visible piece plus where towel, base and winner cards can
 * appear on either side, with a little breathing room. It does not change when an event fires, so the strip on
 * Operations never jumps; it falls back to the whole frame for a theme with nothing visible.
 */
export function scoreboardBand(theme: ThemeDefinition): Rect {
  const frame = { x: 0, y: 0, width: theme.canvas.width, height: theme.canvas.height };
  const rects = listThemeComponentEntries(theme)
    .filter(({ component }) => component.visible && component.width > 0 && component.height > 0)
    .map(({ component }) => placed(component));
  const general = theme.teamEventOverlay.general;
  if (general.enabled) {
    rects.push(resolveEventLabelRect("left", theme, general), resolveEventLabelRect("right", theme, general));
  }
  const content = union(rects);
  if (!content) return frame;
  const x = Math.max(0, Math.floor(content.x - BAND_PADDING));
  const y = Math.max(0, Math.floor(content.y - BAND_PADDING));
  const right = Math.min(frame.width, Math.ceil(content.x + content.width + BAND_PADDING));
  const bottom = Math.min(frame.height, Math.ceil(content.y + content.height + BAND_PADDING));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** Where one side's team name and logo sit on air, to point at them when that side has no team yet. */
export function teamSideRect(theme: ThemeDefinition, side: "left" | "right"): Rect | null {
  const name = side === "left" ? theme.components.homeName : theme.components.awayName;
  const logo = side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
  return union([name, logo].filter((component) => component.visible).map(placed));
}
