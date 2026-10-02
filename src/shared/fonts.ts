/**
 * Custom fonts. A theme lists its fonts as `{ assetId, family }`; text settings refer to a font by family name, as
 * they do for the built-in fonts, so renaming a font renames it everywhere it is used.
 */
import { fontFamilies, type StoredAsset, type ThemeDefinition } from "./theme.js";

/** Every object in the theme with a `fontFamily` setting. Mutating them mutates the theme. */
export function fontSettingObjects(theme: ThemeDefinition): Array<{ fontFamily: string }> {
  const objects: Array<{ fontFamily: string }> = [];
  for (const component of [...Object.values(theme.components), ...theme.freeComponents]) {
    if (component.kind === "text") objects.push(component);
  }
  objects.push(
    theme.momentOverlays.timeout,
    theme.momentOverlays.gameFinished,
    theme.teamEventOverlay.general,
    theme.centerSecondary.timerStyle,
    theme.centerSecondary.staticStyle,
    ...theme.styles.text
  );
  return objects;
}

/** How many text settings use a family. */
export function fontUsageCount(theme: ThemeDefinition, family: string): number {
  return fontSettingObjects(theme).filter((object) => object.fontFamily === family).length;
}

/** Points every text setting using `from` at `to` (a rename, or a fallback when a font is removed). */
export function replaceFontFamily(theme: ThemeDefinition, from: string, to: string) {
  for (const object of fontSettingObjects(theme)) {
    if (object.fontFamily === from) object.fontFamily = to;
  }
}

/** A family name from a font file name ("Gotham-Bold.woff2" → "Gotham Bold"), unique among built-in and taken names. */
export function familyFromFileName(fileName: string, taken: string[]): string {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/["\\]/g, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50) || "Custom font";
  const used = new Set([...fontFamilies, ...taken].map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let number = 2; ; number += 1) {
    const candidate = `${base} ${number}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** The theme's fonts that have a file to load, as family and URL. */
export function themeFontFaces(theme: Pick<ThemeDefinition, "fonts">, assets: StoredAsset[]): Array<{ family: string; url: string }> {
  return theme.fonts.flatMap((font) => {
    const asset = assets.find((candidate) => candidate.id === font.assetId);
    return asset ? [{ family: font.family, url: asset.url }] : [];
  });
}

export function isFontAsset(asset: Pick<StoredAsset, "mimeType">) {
  return asset.mimeType.startsWith("font/");
}

/** Font choices for a font menu: the built-in fonts, then the theme's own. */
export function fontOptions(theme: Pick<ThemeDefinition, "fonts">): Array<{ value: string; label: string }> {
  return [
    ...fontFamilies.map((font) => ({ value: font as string, label: font as string })),
    ...theme.fonts.filter((font) => !(fontFamilies as readonly string[]).includes(font.family)).map((font) => ({ value: font.family, label: `${font.family} (custom)` }))
  ];
}
