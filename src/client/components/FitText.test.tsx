import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { normalizeLiveState } from "../../shared/normalize";
import { themeSchema } from "../../shared/theme";
import { fitTextToBox } from "./FitText";
import { OverlayRenderer } from "./OverlayRenderer";

/** A stand-in element whose text is `naturalWidth` px wide at 100px and scales linearly with font size. */
function fakeText(naturalWidthAt100: number, boxWidth: number, baseSize = 100) {
  const style = { fontSize: "" };
  const size = () => (style.fontSize ? Number.parseFloat(style.fontSize) : baseSize);
  const element = {
    style,
    get scrollWidth() {
      return (naturalWidthAt100 * size()) / 100;
    },
    get clientWidth() {
      return Math.min(boxWidth, this.scrollWidth);
    },
    scrollHeight: 10,
    clientHeight: 10
  };
  return element as unknown as HTMLElement;
}

describe("fitTextToBox", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubBaseSize(px: number) {
    vi.stubGlobal("getComputedStyle", () => ({ fontSize: `${px}px` }));
  }

  it("leaves text that already fits at its own size", () => {
    stubBaseSize(100);
    const element = fakeText(300, 400);
    fitTextToBox(element, 0.6, false);
    expect(element.style.fontSize).toBe("");
  });

  it("shrinks long text until it fits the box, a pixel short of the edge", () => {
    stubBaseSize(100);
    const element = fakeText(500, 400);
    fitTextToBox(element, 0.6, false);
    expect(Number.parseFloat(element.style.fontSize)).toBeCloseTo(79.8, 5);
    expect(element.scrollWidth).toBeLessThan(400);
  });

  it("never goes below the smallest size", () => {
    stubBaseSize(100);
    const element = fakeText(1000, 400);
    fitTextToBox(element, 0.6, false);
    expect(Number.parseFloat(element.style.fontSize)).toBeCloseTo(60, 5);
  });

  it("starts every fit from the parent's size, not one left over from the last fit", () => {
    const parent = {} as HTMLElement;
    const element = Object.assign(fakeText(500, 400), { parentElement: parent });
    // The element itself still reports its shrunk size, as it does mid-transition when Windows asks for less motion.
    vi.stubGlobal("getComputedStyle", (target: HTMLElement) => ({ fontSize: target === parent ? "100px" : "79.8px" }));
    fitTextToBox(element, 0.6, false);
    fitTextToBox(element, 0.6, false);
    expect(Number.parseFloat(element.style.fontSize)).toBeCloseTo(79.8, 5);
  });
});

describe("text fit in the overlay", () => {
  const live = normalizeLiveState(
    { state: "PLAY", period: "GAME", round: 1, mainGame: [{ name: "Seattle Uprising Legacy Squad", score: 1 }, { name: "RT", score: 0 }] },
    { sourceStatus: "ok", fetchedAt: "2026-10-02T05:00:00.000Z", errorMessage: null }
  );

  it("parses a theme saved before text fit existed as cut-off text with no case change", () => {
    const stored = structuredClone(builtinThemes[0]) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    for (const key of ["textTransform", "textFit", "textFitMinScale"]) {
      delete stored.components.homeName[key];
      delete stored.momentOverlays.timeout[key];
      delete stored.teamEventOverlay.general[key];
    }
    const theme = themeSchema.parse(stored);
    expect(theme.components.homeName).toMatchObject({ textTransform: "none", textFit: "clip", textFitMinScale: 0.6 });
    expect(theme.momentOverlays.timeout.textFit).toBe("clip");
    expect(theme.teamEventOverlay.general.textFit).toBe("clip");
  });

  it("renders cut-off text exactly as before", () => {
    const theme = structuredClone(builtinThemes[0]);
    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} />);
    expect(markup).not.toContain("text-fit");
    expect(markup).not.toContain("text-transform");
  });

  it("wraps long text for ellipsis and shrink, and applies the letter case", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.components.homeName.textFit = "shrink";
    theme.components.homeName.textTransform = "uppercase";
    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} />);
    expect(markup).toContain('class="text-fit"');
    expect(markup).toContain("text-transform:uppercase");
  });
});

describe("text effects in the overlay", () => {
  const live = normalizeLiveState(
    { state: "PLAY", period: "GAME", round: 1, mainGame: [{ name: "Left", score: 1 }, { name: "Right", score: 0 }] },
    { sourceStatus: "ok", fetchedAt: "2026-10-02T05:00:00.000Z", errorMessage: null }
  );

  it("adds no shadow or outline styles by default", () => {
    const markup = renderToStaticMarkup(<OverlayRenderer theme={structuredClone(builtinThemes[0])} live={live} />);
    expect(markup).not.toContain("text-shadow");
    expect(markup).not.toContain("text-stroke");
  });

  it("draws the text shadow and an outline outside the letters", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.components.homeScore.textShadow = "0 2px 6px #00000099";
    theme.components.homeScore.textStrokeWidth = 2;
    theme.components.homeScore.textStrokeColor = "#112233";
    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} />);
    expect(markup).toContain("text-shadow:0 2px 6px #00000099");
    expect(markup).toContain("-webkit-text-stroke:4px #112233");
    expect(markup).toContain("paint-order:stroke fill");
  });
});
