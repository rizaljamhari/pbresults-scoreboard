/**
 * Gradient fills for surfaces. A surface's `fill` is either solid (its `backgroundColor`, as before) or a linear or
 * radial gradient; `tintFill` does the same for the tint over a background image.
 */

export const fillTypeValues = ["solid", "linear", "radial"] as const;
export type FillType = (typeof fillTypeValues)[number];

export type GradientStop = { color: string; position: number };

export type FillSettings = {
  type: FillType;
  /** Linear only, in degrees: 0 runs bottom to top, 90 left to right, 180 top to bottom. */
  angle: number;
  stops: GradientStop[];
};

export const fillTypeLabels: Record<FillType, string> = {
  solid: "Solid",
  linear: "Linear",
  radial: "Radial"
};

export const defaultFill: FillSettings = {
  type: "solid",
  angle: 180,
  stops: [
    { color: "#000000", position: 0 },
    { color: "#00000000", position: 1 }
  ]
};

function percent(position: number) {
  return `${Math.round(Math.min(1, Math.max(0, position)) * 1000) / 10}%`;
}

/** The CSS gradient for a fill, or null when it is solid. Stops are sorted, so they can be edited in any order. */
export function gradientCss(fill: FillSettings): string | null {
  if (fill.type === "solid" || fill.stops.length < 2) {
    return null;
  }
  const stops = [...fill.stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => `${stop.color} ${percent(stop.position)}`)
    .join(", ");
  return fill.type === "linear" ? `linear-gradient(${Math.round(fill.angle)}deg, ${stops})` : `radial-gradient(circle at center, ${stops})`;
}

/** A starting gradient from a solid colour: the colour fading to transparent. */
export function gradientFromColor(color: string): GradientStop[] {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  const base = hex ? `#${hex[1]}` : "#000000";
  return [
    { color: hex ? `${base}${hex[2] ?? "ff"}` : color, position: 0 },
    { color: `${base}00`, position: 1 }
  ];
}
