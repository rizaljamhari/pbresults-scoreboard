/**
 * Theme colours and styles, "bind and bake" (docs/theme-design-system-proposal.md §3.1). Objects keep concrete
 * values, so the renderer, exports and older app versions never need the token table; their `design` record says
 * which colour or style a value came from. The editor runs every change through `reconcileDesign` (a manual edit
 * unbinds a colour or becomes an override) and then `bakeDesign` (bound values follow their colour or style).
 */
import { randomUuid } from "./randomId.js";
import type { ColorToken, DesignBinding, SurfaceStyle, TextStyle, ThemeDefinition } from "./theme.js";

/** Colour fields that can be bound to a theme colour. */
export const bindableColorFields = ["color", "backgroundColor", "borderColor", "backgroundOverlayColor", "textStrokeColor"] as const;

/** Fields a text style sets. Objects without a field (e.g. lineHeight on cards) just skip it. */
export const textStyleFields = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "color",
  "textTransform",
  "textFit",
  "textFitMinScale",
  "textShadow",
  "textStrokeWidth",
  "textStrokeColor"
] as const;

/** Fields a surface style sets. */
export const surfaceStyleFields = ["backgroundColor", "fill", "borderColor", "borderWidth", "borderRadius", "shadow", "backdropBlur"] as const;

type Styled = Record<string, unknown> & { design: DesignBinding };

export type StyledEntry = {
  /** Stable address, e.g. "component:homeName", "free:<id>", "moment:timeout", "event:general". */
  key: string;
  /** The piece id for pieces (selectable on the canvas); null for cards. */
  pieceId: string | null;
  label: string;
  object: Styled;
  /** Whether text styles apply (text pieces, cards with type). */
  takesText: boolean;
  /** Whether surface styles apply (pieces and moment cards). */
  takesSurface: boolean;
};

/** Every object in the theme that can use theme colours or styles. Mutating `object` mutates the theme. */
export function styledObjects(theme: ThemeDefinition): StyledEntry[] {
  const entries: StyledEntry[] = [];
  for (const [id, component] of Object.entries(theme.components)) {
    entries.push({ key: `component:${id}`, pieceId: id, label: id, object: component as unknown as Styled, takesText: component.kind === "text", takesSurface: true });
  }
  for (const component of theme.freeComponents) {
    entries.push({ key: `free:${component.id}`, pieceId: component.id, label: component.label, object: component as unknown as Styled, takesText: component.kind === "text", takesSurface: true });
  }
  for (const kind of ["timeout", "gameFinished"] as const) {
    entries.push({ key: `moment:${kind}`, pieceId: null, label: kind === "timeout" ? "Timeout card" : "Game finished card", object: theme.momentOverlays[kind] as unknown as Styled, takesText: true, takesSurface: true });
  }
  entries.push({ key: "event:general", pieceId: null, label: "Event cards", object: theme.teamEventOverlay.general as unknown as Styled, takesText: true, takesSurface: false });
  for (const kind of ["concede", "base", "winner"] as const) {
    entries.push({ key: `event:${kind}`, pieceId: null, label: `${kind} card`, object: theme.teamEventOverlay[kind] as unknown as Styled, takesText: false, takesSurface: false });
  }
  return entries;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Notices manual edits between two versions of a theme: a bound colour changed by hand is unbound, and a styled
 * field changed by hand becomes an override (or stops being one when it is set back to the style's value). Picking
 * a colour or style in the same change counts as binding, not as an edit. Returns a new theme.
 */
export function reconcileDesign(previous: ThemeDefinition, next: ThemeDefinition): ThemeDefinition {
  const result = clone(next);
  // A style's bound colour typed by hand is unbound, as on objects.
  const priorStyles = new Map([...previous.styles.text, ...previous.styles.surface].map((style) => [style.id, style as unknown as Record<string, unknown>]));
  for (const style of [...result.styles.text, ...result.styles.surface]) {
    const prior = priorStyles.get(style.id) as (Record<string, unknown> & { tokenBindings: Record<string, string> }) | undefined;
    for (const [field, tokenId] of Object.entries(style.tokenBindings)) {
      const record = style as unknown as Record<string, unknown>;
      if (prior && prior.tokenBindings[field] === tokenId && !same(record[field], prior[field])) {
        delete style.tokenBindings[field];
      }
    }
  }
  const before = new Map(styledObjects(previous).map((entry) => [entry.key, entry.object]));
  for (const entry of styledObjects(result)) {
    const prior = before.get(entry.key);
    if (!prior) {
      continue;
    }
    const object = entry.object;
    const design = object.design;
    const priorDesign = prior.design;

    for (const field of bindableColorFields) {
      const tokenId = design.tokenBindings[field];
      if (tokenId && tokenId === priorDesign.tokenBindings[field] && !same(object[field], prior[field])) {
        delete design.tokenBindings[field];
      }
    }

    const track = (styleId: string | null, priorStyleId: string | null, fields: readonly string[], style: Record<string, unknown> | undefined) => {
      if (styleId !== priorStyleId) {
        // A newly chosen style starts clean, unless the change set the overrides too (a pasted style).
        if (same(design.overrides, priorDesign.overrides)) {
          design.overrides = design.overrides.filter((field) => !fields.includes(field));
        }
        return;
      }
      if (!styleId || !style) {
        return;
      }
      for (const field of fields) {
        if (!(field in object) || same(object[field], prior[field])) {
          continue;
        }
        const overridden = !same(object[field], style[field]) || Boolean(design.tokenBindings[field]);
        const listed = design.overrides.includes(field);
        if (overridden && !listed) {
          design.overrides.push(field);
        } else if (!overridden && listed) {
          design.overrides = design.overrides.filter((item) => item !== field);
        }
      }
    };
    track(design.textStyleId, priorDesign.textStyleId, textStyleFields, result.styles.text.find((style) => style.id === design.textStyleId));
    track(design.surfaceStyleId, priorDesign.surfaceStyleId, surfaceStyleFields, result.styles.surface.find((style) => style.id === design.surfaceStyleId));
  }
  return result;
}

function applyTokens(target: Record<string, unknown>, bindings: Record<string, string>, tokens: ColorToken[]) {
  for (const [field, tokenId] of Object.entries(bindings)) {
    const token = tokens.find((candidate) => candidate.id === tokenId);
    if (token && field in target) {
      target[field] = token.value;
    }
  }
}

/** Writes theme colours into styles, then styles and colours into every bound object. Returns a new theme. */
export function bakeDesign(theme: ThemeDefinition): ThemeDefinition {
  const result = clone(theme);
  const tokens = result.tokens.colors;
  for (const style of [...result.styles.text, ...result.styles.surface]) {
    applyTokens(style as unknown as Record<string, unknown>, style.tokenBindings, tokens);
  }
  for (const entry of styledObjects(result)) {
    const object = entry.object;
    const design = object.design;
    const apply = (styleId: string | null, fields: readonly string[], styles: Array<TextStyle | SurfaceStyle>) => {
      const style = styleId ? (styles.find((candidate) => candidate.id === styleId) as unknown as Record<string, unknown> | undefined) : undefined;
      if (!style) {
        return;
      }
      for (const field of fields) {
        if (field in object && field in style && !design.overrides.includes(field)) {
          object[field] = clone(style[field]);
        }
      }
    };
    if (entry.takesText) apply(design.textStyleId, textStyleFields, result.styles.text);
    if (entry.takesSurface) apply(design.surfaceStyleId, surfaceStyleFields, result.styles.surface);
    applyTokens(object, design.tokenBindings, tokens);
  }
  return result;
}

/** What uses each theme colour and style, for "where used" and safe deletes. */
export function designUsage(theme: ThemeDefinition) {
  const usage = new Map<string, StyledEntry[]>();
  const add = (id: string, entry: StyledEntry) => usage.set(id, [...(usage.get(id) ?? []), entry]);
  for (const entry of styledObjects(theme)) {
    const design = entry.object.design;
    for (const tokenId of new Set(Object.values(design.tokenBindings))) add(tokenId, entry);
    if (design.textStyleId) add(design.textStyleId, entry);
    if (design.surfaceStyleId) add(design.surfaceStyleId, entry);
  }
  const styleTokens = [...theme.styles.text, ...theme.styles.surface];
  return {
    entries: (id: string) => usage.get(id) ?? [],
    /** Styles that use a colour count too. */
    styleCount: (tokenId: string) => styleTokens.filter((style) => Object.values(style.tokenBindings).includes(tokenId)).length
  };
}

/** Removes a colour or style; everything that used it keeps its current values and is unbound. */
export function removeDesignItem(theme: ThemeDefinition, id: string): ThemeDefinition {
  const result = clone(theme);
  result.tokens.colors = result.tokens.colors.filter((token) => token.id !== id);
  result.styles.text = result.styles.text.filter((style) => style.id !== id);
  result.styles.surface = result.styles.surface.filter((style) => style.id !== id);
  const unbind = (bindings: Record<string, string>) => {
    for (const [field, tokenId] of Object.entries(bindings)) if (tokenId === id) delete bindings[field];
  };
  for (const style of [...result.styles.text, ...result.styles.surface]) unbind(style.tokenBindings);
  for (const entry of styledObjects(result)) {
    const design = entry.object.design;
    unbind(design.tokenBindings);
    if (design.textStyleId === id) {
      design.textStyleId = null;
      design.overrides = design.overrides.filter((field) => !(textStyleFields as readonly string[]).includes(field));
    }
    if (design.surfaceStyleId === id) {
      design.surfaceStyleId = null;
      design.overrides = design.overrides.filter((field) => !(surfaceStyleFields as readonly string[]).includes(field));
    }
  }
  return result;
}

export function createDesignId(prefix: "color" | "text" | "surface") {
  return `${prefix}-${randomUuid().slice(0, 8)}`;
}

/** A style's values taken from an object, e.g. "Save as new style" from the selected piece. */
export function captureStyle<T extends TextStyle | SurfaceStyle>(base: T, source: Record<string, unknown>, fields: readonly string[]): T {
  const result = clone(base) as Record<string, unknown>;
  for (const field of fields) {
    if (field in source && field in result) {
      result[field] = clone(source[field]);
    }
  }
  return result as T;
}

/** Style fields copied by Copy style: type, box, effects and motion, plus where they come from. Not content or position. */
export const copyableStyleFields = [
  ...new Set<string>([
    ...textStyleFields,
    ...surfaceStyleFields,
    "textAlign",
    "opacity",
    "tintFill",
    "backgroundOverlayColor",
    "backgroundOverlayOpacity",
    "backgroundOpacity",
    "paddingX",
    "paddingY",
    "blendMode",
    "imageEffects",
    "enterMotion",
    "exitMotion",
    "changeMotion",
    "design"
  ])
];

/** The copyable style of an object. */
export function copyStyle(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(copyableStyleFields.filter((field) => field in source).map((field) => [field, clone(source[field])]));
}

/** Applies a copied style to an object, field by field where the object has the field. */
export function pasteStyle(target: Record<string, unknown>, style: Record<string, unknown>) {
  for (const [field, value] of Object.entries(style)) {
    if (field in target) {
      target[field] = clone(value);
    }
  }
}

/** Distinct opaque-enough colours already in the theme, as a starting palette. */
export function paletteFromColors(colors: string[]): ColorToken[] {
  const names = ["Primary", "Accent", "Ink", "Surface", "Muted", "Highlight", "Extra 1", "Extra 2"];
  return [...new Set(colors.map((color) => color.toLowerCase()))].slice(0, names.length).map((value, index) => ({
    id: createDesignId("color"),
    name: names[index],
    value
  }));
}
