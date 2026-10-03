import type { PlacementSettings, ThemeDefinition } from "./theme.js";

/**
 * On-air placement: the design is moved and scaled as one piece, so designers can build the scoreboard big and
 * readable in the middle of the canvas while it shows smaller and in its real spot on air. Nothing in the design
 * changes; the overlay draws it through this transform.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type PlacementTransform = { scale: number; x: number; y: number };

export const placementPresetValues = ["top-centre", "bottom-centre", "top-left", "top-right"] as const;
export type PlacementPreset = (typeof placementPresetValues)[number];

export const placementPresetLabels: Record<PlacementPreset, string> = {
  "top-centre": "Top centre",
  "bottom-centre": "Bottom centre",
  "top-left": "Top left",
  "top-right": "Top right"
};

/** Room between a preset placement and the edge of the frame, as a share of the frame height. */
const PRESET_MARGIN = 0.03;
/** How wide the scoreboard is on air when placement is first switched on, as a share of the frame width. */
export const DEFAULT_PLACEMENT_WIDTH = 0.45;

/** The transform to draw the design through, or null when the design shows exactly as built. */
export function placementTransform(placement: PlacementSettings | undefined): PlacementTransform | null {
  if (!placement?.enabled) return null;
  if (placement.scale === 1 && placement.offsetX === 0 && placement.offsetY === 0) return null;
  return { scale: placement.scale, x: placement.offsetX, y: placement.offsetY };
}

export function placeRect(rect: Rect, transform: PlacementTransform | null): Rect {
  if (!transform) return rect;
  return {
    x: rect.x * transform.scale + transform.x,
    y: rect.y * transform.scale + transform.y,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale
  };
}

type Piece = { visible: boolean; x: number; y: number; width: number; height: number; stayInPlace?: boolean };

/** Every piece in the theme, built in and added. */
function allPieces(theme: ThemeDefinition): Piece[] {
  return [...Object.values(theme.components), ...theme.freeComponents];
}

/** Whether this piece moves with the placement; pieces set to stay in place keep their designed spot. */
export function movesWithPlacement(piece: { stayInPlace?: boolean }) {
  return !piece.stayInPlace;
}

/** Where a piece shows on air. */
export function placedPieceRect(theme: ThemeDefinition, piece: Piece): Rect {
  return movesWithPlacement(piece) ? placeRect(piece, placementTransform(theme.placement)) : piece;
}

/** The box around every shown piece that moves with the placement, as designed. Null when there is none. */
export function designBounds(theme: ThemeDefinition): Rect | null {
  const boxes = allPieces(theme).filter((piece) => piece.visible && movesWithPlacement(piece) && piece.width > 0 && piece.height > 0);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Where the design lands on air: the dotted frame in the editor. */
export function placementFrame(theme: ThemeDefinition): Rect | null {
  const bounds = designBounds(theme);
  if (!bounds) return null;
  return placeRect(bounds, placementTransform(theme.placement));
}

/** The placement that puts the design at a preset spot, `widthShare` of the frame wide (never larger than designed). */
export function presetPlacement(theme: ThemeDefinition, preset: PlacementPreset, widthShare: number): Pick<PlacementSettings, "scale" | "offsetX" | "offsetY"> {
  const bounds = designBounds(theme);
  const { width: W, height: H } = theme.canvas;
  if (!bounds) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = roundScale(Math.min(1, Math.max(0.05, (W * widthShare) / bounds.width)));
  return { scale, ...offsetsFor(bounds, scale, preset, W, H) };
}

/** The placement with a new size, keeping the frame's top-left corner where it is. */
export function resizedPlacement(theme: ThemeDefinition, scale: number): Pick<PlacementSettings, "scale" | "offsetX" | "offsetY"> {
  const bounds = designBounds(theme);
  const next = roundScale(Math.min(1, Math.max(0.05, scale)));
  if (!bounds) return { scale: next, offsetX: theme.placement.offsetX, offsetY: theme.placement.offsetY };
  const left = bounds.x * theme.placement.scale + theme.placement.offsetX;
  const top = bounds.y * theme.placement.scale + theme.placement.offsetY;
  return { scale: next, offsetX: Math.round(left - bounds.x * next), offsetY: Math.round(top - bounds.y * next) };
}

function offsetsFor(bounds: Rect, scale: number, preset: PlacementPreset, W: number, H: number) {
  const margin = Math.round(H * PRESET_MARGIN);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  const left = preset === "top-left" ? margin : preset === "top-right" ? W - margin - width : (W - width) / 2;
  const top = preset === "bottom-centre" ? H - margin - height : margin;
  return { offsetX: Math.round(left - bounds.x * scale), offsetY: Math.round(top - bounds.y * scale) };
}

function roundScale(scale: number) {
  return Math.round(scale * 1000) / 1000;
}

/** Pieces whose border or outline is too thin to see on air once scaled down, by name. */
export function thinOnAir(theme: ThemeDefinition, nameOf: (id: string, label: string) => string): string[] {
  const transform = placementTransform(theme.placement);
  if (!transform || transform.scale >= 1) return [];
  const entries: Array<[string, Piece & { borderWidth: number; textStrokeWidth?: number; label?: string }]> = [
    ...(Object.entries(theme.components) as Array<[string, Piece & { borderWidth: number; textStrokeWidth?: number }]>),
    ...theme.freeComponents.map((piece) => [piece.id, piece] as [string, Piece & { borderWidth: number; textStrokeWidth?: number; label?: string }])
  ];
  return entries
    .filter(([, piece]) => piece.visible && movesWithPlacement(piece))
    .filter(([, piece]) => {
      const border = piece.borderWidth * transform.scale;
      const stroke = (piece.textStrokeWidth ?? 0) * transform.scale;
      return (border > 0 && border < 1) || (stroke > 0 && stroke < 0.5);
    })
    .map(([id, piece]) => nameOf(id, piece.label ?? id));
}
