import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { themeSchema, type ThemeDefinition } from "./theme";

/** A theme as saved before moment cards existed: timeout and game finished lived inside centerSecondary. */
function legacyOf(theme: ThemeDefinition, overrides: { breakMode?: string; gameFinished?: boolean; timeout?: Record<string, unknown> } = {}) {
  const legacy = structuredClone(theme) as Record<string, unknown> & ThemeDefinition;
  delete (legacy as Partial<ThemeDefinition>).momentOverlays;
  const timeout = theme.momentOverlays.timeout;
  Object.assign(legacy.centerSecondary, {
    breakMode: overrides.breakMode ?? theme.centerSecondary.breakMode,
    gameFinished: { enabled: overrides.gameFinished ?? true },
    timeout: {
      enabled: timeout.enabled,
      text: timeout.text,
      durationMs: timeout.durationMs,
      minIncreaseSeconds: timeout.minIncreaseSeconds,
      backgroundColor: timeout.backgroundColor,
      color: timeout.color,
      fontFamily: timeout.fontFamily,
      fontSize: timeout.fontSize,
      fontWeight: timeout.fontWeight,
      letterSpacing: timeout.letterSpacing,
      ...overrides.timeout
    }
  });
  return legacy;
}

describe("moment overlay migration", () => {
  it.each(builtinThemes.map((theme) => [theme.name, theme] as const))(
    "turns the legacy settings of %s into the cards the built-in ships with",
    (_name, theme) => {
      const parsed = themeSchema.parse(legacyOf(theme));
      expect(parsed.momentOverlays).toEqual(theme.momentOverlays);
    }
  );

  it("drops the legacy fields from the centre line", () => {
    const parsed = themeSchema.parse(legacyOf(builtinThemes[0])) as ThemeDefinition & { centerSecondary: Record<string, unknown> };
    expect(parsed.centerSecondary).not.toHaveProperty("timeout");
    expect(parsed.centerSecondary).not.toHaveProperty("gameFinished");
  });

  it("follows the centre line, covering it for a timeout and replacing it for game finished", () => {
    const parsed = themeSchema.parse(legacyOf(builtinThemes[0]));
    const line = parsed.components.breakTime;
    for (const card of [parsed.momentOverlays.timeout, parsed.momentOverlays.gameFinished]) {
      expect(card.placement).toBe("centreLine");
      expect({ x: card.x, y: card.y, width: card.width, height: card.height }).toEqual({
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height
      });
    }
    expect(parsed.momentOverlays.timeout.hideCentreLineContent).toBe(false);
    expect(parsed.momentOverlays.gameFinished.hideCentreLineContent).toBe(true);
    expect(parsed.momentOverlays.gameFinished.backgroundColor).toBe("#00000000");
  });

  it("keeps switched-off moments switched off", () => {
    const parsed = themeSchema.parse(legacyOf(builtinThemes[0], { gameFinished: false, timeout: { enabled: false } }));
    expect(parsed.momentOverlays.gameFinished.enabled).toBe(false);
    expect(parsed.momentOverlays.timeout.enabled).toBe(false);
  });

  it("styles game finished like the break text when breaks show text", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.centerSecondary.staticStyle = { fontFamily: "Oswald", fontSize: 19, fontWeight: 500, color: "#123456" };
    const finished = themeSchema.parse(legacyOf(theme, { breakMode: "staticText" })).momentOverlays.gameFinished;
    expect([finished.fontFamily, finished.fontSize, finished.fontWeight, finished.color]).toEqual(["Oswald", 19, 500, "#123456"]);
  });

  it("styles game finished like the centre line piece when breaks are hidden", () => {
    const theme = structuredClone(builtinThemes[0]);
    const line = theme.components.breakTime;
    const finished = themeSchema.parse(legacyOf(theme, { breakMode: "hidden" })).momentOverlays.gameFinished;
    expect([finished.fontFamily, finished.fontSize, finished.fontWeight, finished.color]).toEqual([line.fontFamily, line.fontSize, line.fontWeight, line.color]);
  });

  it("gives a theme with no centre line settings at all the old defaults", () => {
    const legacy = structuredClone(builtinThemes[0]) as Partial<ThemeDefinition>;
    delete legacy.momentOverlays;
    delete legacy.centerSecondary;
    const moments = themeSchema.parse(legacy).momentOverlays;
    expect(moments.timeout).toMatchObject({ enabled: true, text: "TIMEOUT", durationMs: 1200, minIncreaseSeconds: 45, backgroundColor: "#b3261ecc", fontSize: 28 });
    expect(moments.gameFinished).toMatchObject({ enabled: true, text: "GAME FINISHED", color: "#f6f1e8", fontSize: 28 });
  });

  it("leaves already migrated themes alone", () => {
    const theme = structuredClone(builtinThemes[1]);
    theme.momentOverlays.timeout.placement = "free";
    theme.momentOverlays.timeout.x = 12;
    const once = themeSchema.parse(theme);
    expect(themeSchema.parse(once)).toEqual(once);
    expect(once.momentOverlays.timeout).toMatchObject({ placement: "free", x: 12 });
  });
});
