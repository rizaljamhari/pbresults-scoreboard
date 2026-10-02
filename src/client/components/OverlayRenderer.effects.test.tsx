import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { normalizeLiveState } from "../../shared/normalize";
import { dropShadowFilter } from "../../shared/shadow";
import { themeSchema, type ThemeDefinition } from "../../shared/theme";
import { imageEffectFilter, OverlayRenderer } from "./OverlayRenderer";

const effects = (extra: Partial<ThemeDefinition["components"]["eventLogo"]["imageEffects"]> = {}) => ({
  shadow: "none",
  grayscale: 0,
  dim: 0,
  when: "always" as const,
  ...extra
});

describe("image effects", () => {
  it("turns a layered shadow into drop-shadow filters", () => {
    expect(dropShadowFilter("0 4px 8px #00000080, 2px 2px 0 #ff0000")).toBe("drop-shadow(0 4px 8px #00000080) drop-shadow(2px 2px 0 #ff0000)");
    expect(dropShadowFilter("none")).toBeNull();
  });

  it("greys out always, or only for the side that lost", () => {
    expect(imageEffectFilter(effects(), false)).toBeUndefined();
    expect(imageEffectFilter(effects({ grayscale: 1, dim: 0.4 }), false)).toBe("grayscale(1) brightness(0.6)");
    expect(imageEffectFilter(effects({ grayscale: 1, when: "lost" }), false)).toBeUndefined();
    expect(imageEffectFilter(effects({ grayscale: 1, when: "lost", shadow: "0 2px 4px #000" }), true)).toBe("drop-shadow(0 2px 4px #000000) grayscale(1)");
  });

  it("greys out the losing team's logo once the match is over", () => {
    const theme = structuredClone(builtinThemes[0]);
    for (const id of ["homeTeamLogo", "awayTeamLogo"] as const) {
      theme.components[id].visible = true;
      theme.components[id].imageEffects = effects({ grayscale: 1, when: "lost" });
    }
    const finished = normalizeLiveState(
      { state: "END", period: "BREAK", round: 3, mainGame: [{ name: "Left", score: 1 }, { name: "Right", score: 4 }] },
      { sourceStatus: "ok", fetchedAt: "2026-10-02T05:00:00.000Z", errorMessage: null }
    );
    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={finished} />);
    expect(markup.match(/filter:grayscale\(1\)/g)).toHaveLength(1);
    // The greyed logo sits in the left logo's slot: the right team won 4–1.
    const before = markup.slice(0, markup.indexOf("filter:grayscale(1)"));
    const { x, y } = theme.components.homeTeamLogo;
    expect(before.lastIndexOf(`left:${x}px;top:${y}px`)).toBeGreaterThan(before.lastIndexOf("</button>"));
  });
});

describe("blend and blur", () => {
  it("are off for older themes", () => {
    const stored = structuredClone(builtinThemes[0]) as unknown as Record<string, any>;
    delete stored.components.homeName.blendMode;
    delete stored.components.eventLogo.imageEffects;
    const theme = themeSchema.parse(stored);
    expect(theme.components.homeName).toMatchObject({ blendMode: "normal", backdropBlur: 0 });
    expect(theme.components.eventLogo.imageEffects).toEqual(effects());
  });

  it("set the blend mode and backdrop blur on the piece", () => {
    const theme = structuredClone(builtinThemes[0]);
    Object.assign(theme.components.homeName, { blendMode: "screen", backdropBlur: 8 });
    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={null} />);
    expect(markup).toContain("mix-blend-mode:screen;backdrop-filter:blur(8px)");
  });
});
