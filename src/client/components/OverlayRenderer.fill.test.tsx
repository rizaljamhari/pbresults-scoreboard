import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { gradientCss, gradientFromColor } from "../../shared/fill";
import { normalizeLiveState } from "../../shared/normalize";
import { freeShapeComponentSchema, themeSchema, type ThemeDefinition } from "../../shared/theme";
import { OverlayRenderer } from "./OverlayRenderer";

const live = normalizeLiveState(
  { state: "RUNNING", period: "GAME", round: 1, gameTimer: { value: 300, state: 2 }, mainGame: [{ name: "Left", score: 1 }, { name: "Right", score: 0 }] },
  { sourceStatus: "ok", fetchedAt: "2026-10-02T05:00:00.000Z", errorMessage: null }
);

function render(adjust: (theme: ThemeDefinition) => void) {
  const theme = structuredClone(builtinThemes[0]);
  adjust(theme);
  return renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} />);
}

const shape = (extra: Record<string, unknown> = {}) =>
  freeShapeComponentSchema.parse({
    kind: "shape",
    id: "free-bar",
    label: "Bar",
    x: 100,
    y: 100,
    width: 300,
    height: 40,
    zIndex: 9,
    visible: true,
    opacity: 1,
    backgroundColor: "#123456",
    borderColor: "#00000000",
    borderWidth: 0,
    borderRadius: [0, 0, 0, 0],
    paddingX: 0,
    paddingY: 0,
    offsetX: 0,
    offsetY: 0,
    shadow: "none",
    ...extra
  });

describe("gradient css", () => {
  it("is null for a solid fill, and sorts stops for linear and radial", () => {
    const stops = [
      { color: "#ffffff", position: 1 },
      { color: "#000000", position: 0 }
    ];
    expect(gradientCss({ type: "solid", angle: 90, stops })).toBeNull();
    expect(gradientCss({ type: "linear", angle: 90, stops })).toBe("linear-gradient(90deg, #000000 0%, #ffffff 100%)");
    expect(gradientCss({ type: "radial", angle: 90, stops })).toBe("radial-gradient(circle at center, #000000 0%, #ffffff 100%)");
  });

  it("starts a gradient from the solid colour fading out", () => {
    expect(gradientFromColor("#2a2724f2")).toEqual([
      { color: "#2a2724f2", position: 0 },
      { color: "#2a272400", position: 1 }
    ]);
  });
});

describe("fills in the overlay", () => {
  it("leave older themes solid", () => {
    const stored = structuredClone(builtinThemes[0]) as unknown as Record<string, any>;
    delete stored.components.homeName.fill;
    delete stored.momentOverlays.timeout.fill;
    delete stored.teamEventOverlay.concede.tintFill;
    const theme = themeSchema.parse(stored);
    expect(theme.components.homeName.fill.type).toBe("solid");
    expect(theme.momentOverlays.timeout.fill.type).toBe("solid");
    expect(theme.teamEventOverlay.concede.tintFill.type).toBe("solid");
    expect(render(() => undefined)).not.toContain("gradient(");
  });

  it("paints a gradient fill and a gradient tint", () => {
    const markup = render((theme) => {
      Object.assign(theme.components.homeName, {
        backgroundOverlayOpacity: 0.5,
        fill: { type: "linear", angle: 90, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }] },
        tintFill: { type: "radial", angle: 0, stops: [{ color: "#000000", position: 0 }, { color: "#00000000", position: 1 }] }
      });
    });
    expect(markup).toContain("background-color:transparent;background-image:linear-gradient(90deg, #ff0000 0%, #0000ff 100%)");
    expect(markup).toContain("background:radial-gradient(circle at center, #000000 0%, #00000000 100%);opacity:0.5");
  });
});

describe("shape layer", () => {
  it("draws a slanted pill with its fill inside the slot", () => {
    const markup = render((theme) => {
      theme.freeComponents.push(shape({ shape: "pill", skewX: 12, borderWidth: 2, borderColor: "#ffffff" }));
    });
    expect(markup).toContain('class="shape-body"');
    expect(markup).toContain("border:2px solid #ffffff;border-radius:9999px");
    expect(markup).toContain("transform:skewX(-12deg)");
    expect(markup).toContain("background-color:#123456");
  });

  it("keeps an unslanted rectangle's own corners and no transform", () => {
    const markup = render((theme) => {
      theme.freeComponents.push(shape({ borderRadius: [4, 4, 0, 0] }));
    });
    expect(markup).toContain("border-radius:4px 4px 0px 0px");
    expect(markup).not.toContain("skewX");
  });
});
