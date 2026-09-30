import type { ComponentId, ThemeDefinition } from "./theme.js";
import { getThemeComponent, type ThemeComponent } from "./themeComponents.js";

export type AlignEdge = "left" | "centerX" | "right" | "top" | "middle" | "bottom";
export type ArrangeReference = "selection" | "frame";
export type Axis = "x" | "y";

/** Left/right counterparts on a scoreboard; the mirror tools and the mirror guide use these. */
export const mirroredComponentPairs: Array<[ComponentId, ComponentId]> = [
  ["homeTeamLogo", "awayTeamLogo"],
  ["homeName", "awayName"],
  ["homeScore", "awayScore"]
];

export function mirrorCounterpartId(id: string): ComponentId | null {
  for (const [left, right] of mirroredComponentPairs) {
    if (id === left) {
      return right;
    }
    if (id === right) {
      return left;
    }
  }
  return null;
}

/** Where a piece of this box would sit if reflected across the frame's vertical centre line. */
export function mirroredX(frameWidth: number, x: number, width: number) {
  return frameWidth - x - width;
}

type Entry = { id: string; component: ThemeComponent };

function resolve(draft: ThemeDefinition, ids: string[]): Entry[] {
  return ids
    .map((id) => ({ id, component: getThemeComponent(draft, id) }))
    .filter((entry): entry is Entry => Boolean(entry.component));
}

function bounds(entries: Entry[]) {
  const left = Math.min(...entries.map(({ component }) => component.x));
  const top = Math.min(...entries.map(({ component }) => component.y));
  const right = Math.max(...entries.map(({ component }) => component.x + component.width));
  const bottom = Math.max(...entries.map(({ component }) => component.y + component.height));
  return { left, top, right, bottom };
}

/**
 * Aligns pieces to an edge or centre line. With one piece, or with reference "frame", the frame is the reference;
 * otherwise the selection's bounding box is.
 */
export function alignPieces(draft: ThemeDefinition, ids: string[], edge: AlignEdge, reference: ArrangeReference = "selection") {
  const entries = resolve(draft, ids);
  if (entries.length === 0) {
    return;
  }
  const box =
    reference === "frame" || entries.length === 1
      ? { left: 0, top: 0, right: draft.canvas.width, bottom: draft.canvas.height }
      : bounds(entries);

  for (const { component } of entries) {
    switch (edge) {
      case "left":
        component.x = box.left;
        break;
      case "right":
        component.x = box.right - component.width;
        break;
      case "centerX":
        component.x = Math.round((box.left + box.right) / 2 - component.width / 2);
        break;
      case "top":
        component.y = box.top;
        break;
      case "bottom":
        component.y = box.bottom - component.height;
        break;
      case "middle":
        component.y = Math.round((box.top + box.bottom) / 2 - component.height / 2);
        break;
    }
  }
}

/** Equal gaps between three or more pieces; the first and last pieces along the axis stay put. */
export function distributePieces(draft: ThemeDefinition, ids: string[], axis: Axis) {
  const entries = resolve(draft, ids);
  if (entries.length < 3) {
    return;
  }
  const position = axis === "x" ? "x" : "y";
  const size = axis === "x" ? "width" : "height";
  const sorted = [...entries].sort((a, b) => a.component[position] - b.component[position]);
  const first = sorted[0].component;
  const last = sorted[sorted.length - 1].component;
  const span = last[position] + last[size] - first[position];
  const occupied = sorted.reduce((total, { component }) => total + component[size], 0);
  const gap = (span - occupied) / (sorted.length - 1);

  let cursor = first[position] + first[size] + gap;
  for (const { component } of sorted.slice(1, -1)) {
    component[position] = Math.round(cursor);
    cursor += component[size] + gap;
  }
}

/** Lays pieces out along an axis with an exact gap, starting from the first piece's current position. */
export function setGapBetween(draft: ThemeDefinition, ids: string[], axis: Axis, gap: number) {
  const entries = resolve(draft, ids);
  if (entries.length < 2) {
    return;
  }
  const position = axis === "x" ? "x" : "y";
  const size = axis === "x" ? "width" : "height";
  const sorted = [...entries].sort((a, b) => a.component[position] - b.component[position]);
  let cursor = sorted[0].component[position];
  for (const { component } of sorted) {
    component[position] = Math.round(cursor);
    cursor += component[size] + gap;
  }
}

/** Gives every selected piece the width or height of the reference piece (the first id). */
export function matchSize(draft: ThemeDefinition, ids: string[], dimension: "width" | "height") {
  const entries = resolve(draft, ids);
  if (entries.length < 2) {
    return;
  }
  const target = entries[0].component[dimension];
  for (const { component } of entries.slice(1)) {
    component[dimension] = target;
  }
}
