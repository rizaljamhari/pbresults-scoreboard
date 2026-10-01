import type { ThemeDefinition } from "../../shared/theme";
import { listThemeComponentEntries } from "../../shared/themeComponents";

export type ThemeKindFilter = "all" | "builtin" | "custom";
export type ThemeSort = "nameAsc" | "nameDesc";

export function filterAndSortThemes(
  themes: ThemeDefinition[],
  search: string,
  kindFilter: ThemeKindFilter,
  sortBy: ThemeSort
): ThemeDefinition[] {
  const query = search.trim().toLowerCase();
  const base = [...themes].filter((theme) => {
    if (kindFilter === "builtin" && !theme.builtin) {
      return false;
    }
    if (kindFilter === "custom" && theme.builtin) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [theme.name, theme.description, theme.id].some((value) => value.toLowerCase().includes(query));
  });

  base.sort((left, right) => {
    return sortBy === "nameAsc"
      ? left.name.localeCompare(right.name)
      : right.name.localeCompare(left.name);
  });

  return base;
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
