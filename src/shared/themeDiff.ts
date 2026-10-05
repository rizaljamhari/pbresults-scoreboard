/**
 * What changed between two versions of a theme, in the editor's words: "Left team name: font size 56 → 60". Used to
 * review a save before it reaches the live overlay, and to compare named versions.
 */
import type { ThemeDefinition } from "./theme.js";

export type ThemeChange = {
  /** Stable key for lists. */
  key: string;
  /** The piece to select on the canvas, when the change is on a piece. */
  pieceId: string | null;
  /** What changed, e.g. "Left team name", "New layer: Sponsor bar", "Theme colours". */
  subject: string;
  /** Each changed setting, e.g. "Font size: 56 → 60". */
  details: string[];
  kind: "changed" | "added" | "removed";
};

const TRANSITION_LABELS: Record<string, string> = {
  enabled: "Band sweep",
  direction: "Direction",
  sweepMs: "Sweep time",
  bandImageAssetId: "Band image",
  bandColor: "Strip colour",
  bandEdgeColor: "Edge colour",
  bandTextColor: "Band text colour",
  bandText: "Band text",
  bandFontFamily: "Band font",
  bandShowLogo: "Event logo on the band",
  motionBlur: "Motion blur",
  contentGapMs: "Gap between contents",
  contentsStart: "Contents start",
  centreLineIntroMs: "Centre line intro"
};

const FIELD_LABELS: Record<string, string> = {
  fontFamily: "Font",
  fontSize: "Font size",
  fontWeight: "Weight",
  color: "Text colour",
  backgroundColor: "Fill",
  borderColor: "Border colour",
  borderWidth: "Border width",
  borderRadius: "Corners",
  opacity: "Opacity",
  stayInPlace: "Stay in place on air",
  zIndex: "Layer order",
  shadow: "Shadow",
  textShadow: "Text shadow",
  textStrokeWidth: "Outline",
  textStrokeColor: "Outline colour",
  letterSpacing: "Letter spacing",
  lineHeight: "Line height",
  textAlign: "Alignment",
  textTransform: "Case",
  textFit: "Long text",
  textFitMinScale: "Smallest size",
  defaultText: "Text",
  text: "Text",
  label: "Name",
  contentMode: "Who sets the text",
  assetId: "Image",
  backgroundImageAssetId: "Background image",
  backgroundImageMode: "Background image",
  backgroundImageFit: "Background fit",
  backgroundImagePosition: "Background anchor",
  backgroundOverlayColor: "Tint",
  backgroundOverlayOpacity: "Tint strength",
  backgroundOpacity: "Background opacity",
  fill: "Fill",
  tintFill: "Tint",
  paddingX: "Padding",
  paddingY: "Padding",
  offsetX: "Content offset",
  offsetY: "Content offset",
  enterMotion: "Entrance",
  exitMotion: "Exit",
  changeMotion: "Change animation",
  clockWarning: "Last seconds",
  imageEffects: "Image effects",
  blendMode: "Blend",
  backdropBlur: "Backdrop blur",
  skewX: "Slant",
  shape: "Shape",
  motion: "Motion",
  placement: "Placement",
  enabled: "Switched on",
  teamLogoFallbackMode: "When the team has no logo",
  imageContentMode: "Fit to visible pixels",
  visibleContentPaddingPct: "Breathing room",
  multiline: "Line breaks",
  maxLength: "Max characters"
};

/** Fields shown together: position and size read as one change each. */
const COMBINED: Array<{ fields: [string, string]; label: string }> = [
  { fields: ["x", "y"], label: "Position" },
  { fields: ["width", "height"], label: "Size" }
];

/** Internal or derived fields that never need reviewing on their own. */
const IGNORED = new Set(["id", "kind", "design", "updatedAt", "versions", "builtin", "archived"]);

const MAX_DETAILS = 6;

function humanize(field: string) {
  const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "string") return value.length > 28 ? `“${value.slice(0, 27)}…”` : /^#|^\d/.test(value) ? value : `“${value}”`;
  return "";
}

/** "Font size: 56 → 60" for simple values; "Shadow changed" for structured ones. */
function describe(label: string, before: unknown, after: unknown) {
  const from = format(before);
  const to = format(after);
  return from && to ? `${label}: ${from} → ${to}` : `${label} changed`;
}

function objectDetails(before: Record<string, unknown>, after: Record<string, unknown>, extra: (field: string) => string | null = () => null) {
  const details: string[] = [];
  const handled = new Set<string>();
  if (before.visible !== after.visible && typeof after.visible === "boolean") {
    details.push(after.visible ? "Shown" : "Hidden");
  }
  handled.add("visible");
  for (const { fields, label } of COMBINED) {
    const [a, b] = fields;
    if (a in after && (!same(before[a], after[a]) || !same(before[b], after[b]))) {
      details.push(`${label}: ${format(before[a])}, ${format(before[b])} → ${format(after[a])}, ${format(after[b])}`);
    }
    handled.add(a);
    handled.add(b);
  }
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const labelsDone = new Set<string>();
  for (const field of fields) {
    if (handled.has(field) || IGNORED.has(field) || same(before[field], after[field])) continue;
    const special = extra(field);
    if (special) {
      details.push(special);
      continue;
    }
    const label = FIELD_LABELS[field] ?? humanize(field);
    // Paired fields (padding X and Y) report once.
    if (labelsDone.has(label)) continue;
    labelsDone.add(label);
    details.push(describe(label, before[field], after[field]));
  }
  return details;
}

function styleLinkDetails(before: ThemeDefinition, after: ThemeDefinition, beforeObject: Record<string, unknown>, afterObject: Record<string, unknown>) {
  const details: string[] = [];
  const pick = (object: Record<string, unknown>) => (object.design ?? {}) as { textStyleId?: string | null; surfaceStyleId?: string | null };
  const name = (theme: ThemeDefinition, id: string | null | undefined) =>
    id ? [...theme.styles.text, ...theme.styles.surface].find((style) => style.id === id)?.name ?? "a removed style" : "none";
  const b = pick(beforeObject);
  const a = pick(afterObject);
  if ((b.textStyleId ?? null) !== (a.textStyleId ?? null)) details.push(`Text style: ${name(before, b.textStyleId)} → ${name(after, a.textStyleId)}`);
  if ((b.surfaceStyleId ?? null) !== (a.surfaceStyleId ?? null)) details.push(`Surface style: ${name(before, b.surfaceStyleId)} → ${name(after, a.surfaceStyleId)}`);
  return details;
}

function capped(details: string[]) {
  return details.length > MAX_DETAILS ? [...details.slice(0, MAX_DETAILS - 1), `and ${details.length - (MAX_DETAILS - 1)} more`] : details;
}

/** Items of a list matched by id: what was added, removed and changed. */
function listChanges<T extends { id: string; name: string }>(
  before: T[],
  after: T[],
  subject: string,
  key: string
): ThemeChange | null {
  const details: string[] = [];
  for (const item of after) {
    const prior = before.find((candidate) => candidate.id === item.id);
    if (!prior) details.push(`Added “${item.name}”`);
    else if (!same(prior, item)) details.push(prior.name !== item.name ? `Renamed “${prior.name}” → “${item.name}”` : `Changed “${item.name}”`);
  }
  for (const item of before) {
    if (!after.some((candidate) => candidate.id === item.id)) details.push(`Removed “${item.name}”`);
  }
  return details.length ? { key, pieceId: null, subject, details: capped(details), kind: "changed" } : null;
}

/**
 * The changes from `before` to `after`, piece by piece. `pieceName` names a piece the way the editor does.
 */
export function diffThemes(before: ThemeDefinition, after: ThemeDefinition, pieceName: (id: string, label: string) => string): ThemeChange[] {
  const changes: ThemeChange[] = [];
  const push = (change: Omit<ThemeChange, "details"> & { details: string[] }) => {
    if (change.details.length) changes.push({ ...change, details: capped(change.details) });
  };
  const record = (value: unknown) => value as Record<string, unknown>;

  const themeDetails: string[] = [];
  if (before.name !== after.name) themeDetails.push(describe("Name", before.name, after.name));
  if (before.description !== after.description) themeDetails.push("Description changed");
  themeDetails.push(...objectDetails(record(before.canvas), record(after.canvas)).map((detail) => detail.replace(/^Background color/, "Canvas background")));
  push({ key: "theme", pieceId: null, subject: "Theme", details: themeDetails, kind: "changed" });

  for (const id of Object.keys(after.components) as Array<keyof ThemeDefinition["components"]>) {
    const b = record(before.components[id]);
    const a = record(after.components[id]);
    push({
      key: `component:${id}`,
      pieceId: id,
      subject: pieceName(id, id),
      details: [...styleLinkDetails(before, after, b, a), ...objectDetails(b, a)],
      kind: "changed"
    });
  }

  for (const component of after.freeComponents) {
    const prior = before.freeComponents.find((candidate) => candidate.id === component.id);
    if (!prior) {
      changes.push({ key: `free:${component.id}`, pieceId: component.id, subject: `New layer: ${component.label}`, details: [], kind: "added" });
      continue;
    }
    push({
      key: `free:${component.id}`,
      pieceId: component.id,
      subject: pieceName(component.id, component.label),
      details: [...styleLinkDetails(before, after, record(prior), record(component)), ...objectDetails(record(prior), record(component))],
      kind: "changed"
    });
  }
  for (const component of before.freeComponents) {
    if (!after.freeComponents.some((candidate) => candidate.id === component.id)) {
      changes.push({ key: `free:${component.id}`, pieceId: null, subject: `Removed layer: ${component.label}`, details: [], kind: "removed" });
    }
  }

  push({
    key: "centre-line",
    pieceId: "breakTime",
    subject: "Centre line settings",
    details: objectDetails(record(before.centerSecondary), record(after.centerSecondary), (field) =>
      field === "timerStyle" ? "Break clock type changed" : field === "staticStyle" ? "Text type changed" : null
    ),
    kind: "changed"
  });
  for (const kind of ["timeout", "gameFinished"] as const) {
    const b = record(before.momentOverlays[kind]);
    const a = record(after.momentOverlays[kind]);
    push({
      key: `moment:${kind}`,
      pieceId: null,
      subject: kind === "timeout" ? "Timeout card" : "Game finished card",
      details: [...styleLinkDetails(before, after, b, a), ...objectDetails(b, a)],
      kind: "changed"
    });
  }
  const eventNames = { general: "Event cards (all)", concede: "Towel card", base: "Base card", winner: "Winner card" } as const;
  for (const kind of ["general", "concede", "base", "winner"] as const) {
    const b = record(before.teamEventOverlay[kind]);
    const a = record(after.teamEventOverlay[kind]);
    push({ key: `event:${kind}`, pieceId: null, subject: eventNames[kind], details: [...styleLinkDetails(before, after, b, a), ...objectDetails(b, a)], kind: "changed" });
  }

  const motionDetails: string[] = [];
  if (!same(before.motion.teamSwitch, after.motion.teamSwitch)) motionDetails.push("Team switch changed");
  if (before.motion.enterStaggerMs !== after.motion.enterStaggerMs) motionDetails.push(describe("Build-in gap", before.motion.enterStaggerMs, after.motion.enterStaggerMs));
  if (before.motion.enterOrder !== after.motion.enterOrder) motionDetails.push(describe("Build-in order", before.motion.enterOrder, after.motion.enterOrder));
  push({ key: "motion", pieceId: null, subject: "Motion", details: motionDetails, kind: "changed" });

  const placementDetails: string[] = [];
  if (before.placement.enabled !== after.placement.enabled) placementDetails.push(after.placement.enabled ? "Placed on air" : "Shown as designed");
  if (after.placement.enabled) {
    if (before.placement.scale !== after.placement.scale) {
      placementDetails.push(`Size: ${Math.round(before.placement.scale * 100)}% → ${Math.round(after.placement.scale * 100)}% of the design`);
    }
    if (before.placement.offsetX !== after.placement.offsetX || before.placement.offsetY !== after.placement.offsetY) placementDetails.push("Moved");
  }
  push({ key: "placement", pieceId: null, subject: "On-air placement", details: placementDetails, kind: "changed" });

  const transitionBefore = record(before.transition);
  const transitionAfter = record(after.transition);
  push({
    key: "transition",
    pieceId: null,
    subject: "Show and hide",
    details: objectDetails(transitionBefore, transitionAfter, (field) => {
      if (field === "contentMotion" || field === "logoMotion") return field === "logoMotion" ? "Logos motion changed" : "Contents motion changed";
      if (field === "direction") {
        const way = (value: unknown) => (value === "left-to-right" ? "Left to right" : "Right to left");
        return `Direction: ${way(transitionBefore.direction)} → ${way(transitionAfter.direction)}`;
      }
      if (field === "sweepWidth") {
        const width = (value: unknown) => (value === "scoreboard" ? "Scoreboard only" : "Full screen");
        return `Sweep width: ${width(transitionBefore.sweepWidth)} → ${width(transitionAfter.sweepWidth)}`;
      }
      if (field === "sweepRoom") return `Side room: ${Math.round(Number(transitionBefore.sweepRoom) * 1000) / 10}% → ${Math.round(Number(transitionAfter.sweepRoom) * 1000) / 10}%`;
      if (field === "bandScale") return `Band size: ${Math.round(Number(transitionBefore.bandScale) * 100)}% → ${Math.round(Number(transitionAfter.bandScale) * 100)}%`;
      const label = TRANSITION_LABELS[field];
      return label ? describe(label, transitionBefore[field], transitionAfter[field]) : null;
    }),
    kind: "changed"
  });

  for (const change of [
    listChanges(before.tokens.colors, after.tokens.colors, "Theme colours", "tokens"),
    listChanges(before.styles.text, after.styles.text, "Text styles", "text-styles"),
    listChanges(before.styles.surface, after.styles.surface, "Surface styles", "surface-styles"),
    listChanges(
      before.fonts.map((font) => ({ ...font, id: font.assetId, name: font.family })),
      after.fonts.map((font) => ({ ...font, id: font.assetId, name: font.family })),
      "Fonts",
      "fonts"
    )
  ]) {
    if (change) changes.push(change);
  }

  return changes;
}
