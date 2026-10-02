import type { ThemeDefinition } from "../../shared/theme";
import { listThemeComponentEntries } from "../../shared/themeComponents";

export type ThemeSort = "recent" | "nameAsc" | "nameDesc";

export type ThemeSections = {
  /** The theme on air, shown on its own; a built-in only appears here. */
  onAir: ThemeDefinition | null;
  /** The event's own themes, archived ones excluded. */
  active: ThemeDefinition[];
  archived: ThemeDefinition[];
  /** Built-in themes: starting points for new themes, not listed. */
  templates: ThemeDefinition[];
};

function compareThemes(left: ThemeDefinition, right: ThemeDefinition, sortBy: ThemeSort) {
  if (sortBy === "recent") {
    // Newest edit first; themes never saved since edit times were tracked go last, by name.
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : -Infinity;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : -Infinity;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.name.localeCompare(right.name);
  }
  return sortBy === "nameAsc" ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name);
}

/** Splits themes into what the theme list shows: on air, the event's themes, the archive, and the templates. */
export function organizeThemes(themes: ThemeDefinition[], search: string, sortBy: ThemeSort, onAirId: string | null): ThemeSections {
  const query = search.trim().toLowerCase();
  const matches = (theme: ThemeDefinition) => !query || [theme.acronym, theme.name, theme.description].some((value) => value.toLowerCase().includes(query));
  const sorted = [...themes].sort((left, right) => compareThemes(left, right, sortBy));
  const onAirTheme = sorted.find((theme) => theme.id === onAirId) ?? null;
  const listed = sorted.filter((theme) => !theme.builtin && theme.id !== onAirId && matches(theme));
  return {
    onAir: onAirTheme && matches(onAirTheme) ? onAirTheme : null,
    active: listed.filter((theme) => !theme.archived),
    archived: listed.filter((theme) => theme.archived),
    templates: sorted.filter((theme) => theme.builtin).sort((left, right) => left.name.localeCompare(right.name))
  };
}

/** "Edited 3 days ago", short and in the product's words; null when the time is unknown. */
export function formatEdited(updatedAt: string | null, now = Date.now()): string | null {
  if (!updatedAt) {
    return null;
  }
  const time = Date.parse(updatedAt);
  if (Number.isNaN(time)) {
    return null;
  }
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "Edited yesterday" : `Edited ${days} days ago`;
  return `Edited ${new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * The part of the frame a theme actually draws on: every visible piece, kept inside the frame. Thumbnails
 * crop to this so the scoreboard fills the preview instead of floating in an empty 1920 × 1080 frame.
 */
export function themeContentBounds(theme: ThemeDefinition): Box {
  const frame = { x: 0, y: 0, width: theme.canvas.width, height: theme.canvas.height };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { component } of listThemeComponentEntries(theme)) {
    if (!component.visible || component.opacity <= 0) {
      continue;
    }
    left = Math.min(left, Math.max(0, component.x));
    top = Math.min(top, Math.max(0, component.y));
    right = Math.max(right, Math.min(frame.width, component.x + component.width));
    bottom = Math.max(bottom, Math.min(frame.height, component.y + component.height));
  }
  if (!(right > left && bottom > top)) {
    return frame;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Scale and offset that fit `content` inside a `box` of the given size, centred, with padding, never enlarged. */
export function fitContent(content: Box, boxWidth: number, boxHeight: number, padding: number) {
  const scale = Math.min(1, Math.max(0.01, (boxWidth - padding * 2) / content.width), Math.max(0.01, (boxHeight - padding * 2) / content.height));
  return {
    scale,
    x: Math.round((boxWidth - content.width * scale) / 2 - content.x * scale),
    y: Math.round((boxHeight - content.height * scale) / 2 - content.y * scale)
  };
}

export type ServerThemeOutcome = "apply" | "keep" | "conflict";

/**
 * What the editor does with a freshly fetched server copy of the theme it has open. Without unsaved edits, or when
 * the server already matches the draft, it takes the server copy. With unsaved edits it keeps the draft while the
 * server copy is still the one the editor loaded, and reports a conflict only when someone really changed it.
 * All three themes must be in the same (canvas-clamped) form.
 */
export function reconcileServerTheme(
  current: ThemeDefinition | null,
  baseline: ThemeDefinition | null,
  next: ThemeDefinition
): ServerThemeOutcome {
  if (!current || !baseline) {
    return "apply";
  }
  const same = (left: ThemeDefinition, right: ThemeDefinition) => JSON.stringify(left) === JSON.stringify(right);
  if (same(current, baseline) || same(current, next)) {
    return "apply";
  }
  return same(next, baseline) ? "keep" : "conflict";
}
