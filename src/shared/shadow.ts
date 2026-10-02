/**
 * Box and text shadows are stored as CSS strings (the theme schema's `shadow` and `textShadow`). The editor reads
 * them into layers it can show as controls and writes them back; anything it can't read stays as custom CSS.
 */

export type ShadowLayer = {
  x: number;
  y: number;
  blur: number;
  /** Box shadows only. */
  spread: number;
  color: string;
  /** Box shadows only. */
  inset: boolean;
};

export type ShadowKind = "box" | "text";

export const emptyShadowLayer: ShadowLayer = { x: 0, y: 4, blur: 12, spread: 0, color: "#00000080", inset: false };

function hexByte(value: number) {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

/** Reads a colour into #rrggbbaa, or null when it isn't one the editor can show. */
export function parseShadowColor(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}ff`;
  }
  if (/^#[0-9a-f]{4}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}${text[4]}${text[4]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(text)) {
    return `${text}ff`;
  }
  if (/^#[0-9a-f]{8}$/.test(text)) {
    return text;
  }
  if (text === "black") return "#000000ff";
  if (text === "white") return "#ffffffff";
  if (text === "transparent") return "#00000000";
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) {
    const alphaText = rgb[4];
    const alpha = alphaText === undefined ? 1 : alphaText.endsWith("%") ? Number.parseFloat(alphaText) / 100 : Number.parseFloat(alphaText);
    return `#${hexByte(Number(rgb[1]))}${hexByte(Number(rgb[2]))}${hexByte(Number(rgb[3]))}${hexByte(alpha * 255)}`;
  }
  return null;
}

/** Splits on commas that are not inside a colour function. */
function splitLayers(value: string) {
  const layers: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      layers.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  layers.push(current);
  return layers.map((layer) => layer.trim());
}

function parseLength(token: string): number | null {
  const match = /^(-?\d*\.?\d+)(px)?$/.exec(token);
  if (!match || (match[2] === undefined && Number(match[1]) !== 0)) {
    return null;
  }
  return Number(match[1]);
}

/**
 * Reads a CSS shadow into layers. `[]` means no shadow; null means the editor can't show it (other units,
 * variables, named colours) and should keep it as custom CSS.
 */
export function parseShadow(value: string, kind: ShadowKind): ShadowLayer[] | null {
  const text = value.trim();
  if (text === "" || text.toLowerCase() === "none") {
    return [];
  }
  const layers: ShadowLayer[] = [];
  for (const layerText of splitLayers(text)) {
    // Keep colour functions whole while splitting on spaces.
    const tokens = layerText.match(/[a-z]+\([^)]*\)|\S+/gi) ?? [];
    let inset = false;
    let color: string | null = null;
    const lengths: number[] = [];
    for (const token of tokens) {
      if (token.toLowerCase() === "inset") {
        if (kind === "text" || inset) return null;
        inset = true;
        continue;
      }
      const length = parseLength(token);
      if (length !== null) {
        lengths.push(length);
        continue;
      }
      if (color !== null) return null;
      color = parseShadowColor(token);
      if (color === null) return null;
    }
    const maxLengths = kind === "box" ? 4 : 3;
    if (lengths.length < 2 || lengths.length > maxLengths || (lengths[2] ?? 0) < 0) {
      return null;
    }
    layers.push({
      x: lengths[0],
      y: lengths[1],
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      // CSS uses the text colour when none is given; black is the usual intent and keeps the picker meaningful.
      color: color ?? "#000000ff",
      inset
    });
  }
  return layers;
}

/** #rrggbbff written as #rrggbb. */
function shortColor(color: string) {
  return color.length === 9 && color.toLowerCase().endsWith("ff") ? color.slice(0, 7) : color;
}

function px(value: number) {
  return value === 0 ? "0" : `${Math.round(value * 100) / 100}px`;
}

/** Writes layers back as CSS; no layers is "none". */
export function serializeShadow(layers: ShadowLayer[], kind: ShadowKind): string {
  if (layers.length === 0) {
    return "none";
  }
  return layers
    .map((layer) => {
      const parts = [px(layer.x), px(layer.y), px(layer.blur)];
      if (kind === "box") {
        parts.push(px(layer.spread));
      }
      const color = shortColor(layer.color);
      return `${kind === "box" && layer.inset ? "inset " : ""}${parts.join(" ")} ${color}`;
    })
    .join(", ");
}

export type ShadowPreset = { id: string; label: string; layers: ShadowLayer[] };

const layer = (x: number, y: number, blur: number, spread: number, color: string, inset = false): ShadowLayer => ({ x, y, blur, spread, color, inset });

export const boxShadowPresets: ShadowPreset[] = [
  { id: "none", label: "None", layers: [] },
  { id: "soft", label: "Soft", layers: [layer(0, 4, 16, 0, "#00000059")] },
  { id: "lifted", label: "Lifted", layers: [layer(0, 2, 4, 0, "#00000040"), layer(0, 12, 28, -4, "#00000066")] },
  { id: "hard", label: "Hard drop", layers: [layer(6, 6, 0, 0, "#000000cc")] },
  { id: "glow", label: "Glow", layers: [layer(0, 0, 24, 2, "#ffffff80")] }
];

export const textShadowPresets: ShadowPreset[] = [
  { id: "none", label: "None", layers: [] },
  { id: "soft", label: "Soft", layers: [layer(0, 2, 6, 0, "#00000099")] },
  { id: "halo", label: "Halo", layers: [layer(0, 0, 4, 0, "#000000e6"), layer(0, 0, 12, 0, "#00000099")] },
  { id: "hard", label: "Hard drop", layers: [layer(3, 3, 0, 0, "#000000e6")] },
  { id: "glow", label: "Glow", layers: [layer(0, 0, 14, 0, "#ffffffb3")] }
];

/** The preset these layers match exactly, if any. */
export function matchShadowPreset(layers: ShadowLayer[], kind: ShadowKind, presets: ShadowPreset[]): string | null {
  const css = serializeShadow(layers, kind);
  return presets.find((preset) => serializeShadow(preset.layers, kind) === css)?.id ?? null;
}

/**
 * A text-style shadow (x y blur colour, layered) as a CSS `filter` chain of `drop-shadow()`s, which follow an image's
 * visible pixels rather than its box. Null for no shadow or one the editor can't read.
 */
export function dropShadowFilter(css: string): string | null {
  const layers = parseShadow(css, "text");
  if (!layers || layers.length === 0) {
    return null;
  }
  return layers.map((layer) => `drop-shadow(${px(layer.x)} ${px(layer.y)} ${px(layer.blur)} ${shortColor(layer.color)})`).join(" ");
}
