import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { normalizeLiveState } from "../../shared/normalize";
import { freeShapeComponentSchema, themeSchema, type ThemeDefinition } from "../../shared/theme";
import { diffThemes } from "../../shared/themeDiff";
import { OverlayRenderer, scoreboardBuildPlan, transitionBandRect } from "./OverlayRenderer";
import { bandSweepFrames, darkerShade, releaseSweep } from "./scoreboardTransition";

const live = normalizeLiveState(
  { state: "RUNNING", period: "GAME", round: 1, gameTimer: { value: 300, state: 2 }, mainGame: [{ name: "Left", score: 1 }, { name: "Right", score: 0 }] },
  { sourceStatus: "ok", fetchedAt: "2026-10-03T05:00:00.000Z", errorMessage: null }
);

function render(adjust: (theme: ThemeDefinition) => void = () => undefined, options: { visible?: boolean; reduceMotion?: boolean } = {}) {
  const theme = structuredClone(builtinThemes[0]);
  adjust(theme);
  return renderToStaticMarkup(
    <OverlayRenderer theme={theme} live={live} scoreboardVisible={options.visible ?? true} reduceMotion={options.reduceMotion ?? false} />
  );
}

/** The opening tag of the slot that holds `text`. */
function slotTag(markup: string, text: string) {
  const at = markup.indexOf(`>${text}<`);
  const start = markup.lastIndexOf("<button", at);
  return markup.slice(start, markup.indexOf(">", start));
}

/** Where the div that opens at `from` closes, counting nested divs. */
function closingDiv(markup: string, from: number) {
  let depth = 0;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = markup.lastIndexOf("<div", from);
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return match.index;
  }
  return -1;
}

const plate = () =>
  freeShapeComponentSchema.parse({
    kind: "shape",
    id: "free-plate",
    label: "Plate",
    x: 100,
    y: 100,
    width: 300,
    height: 40,
    zIndex: 1,
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
    shadow: "none"
  });

describe("show and hide transition", () => {
  it("defaults to the broadcast sweep: left to right, 800 ms, a red strip, a dark edge, fade-in contents and popping logos", () => {
    const stored = structuredClone(builtinThemes[0]) as unknown as Record<string, unknown>;
    delete stored.transition;
    const theme = themeSchema.parse(stored);
    expect(theme.transition).toMatchObject({
      enabled: true,
      direction: "left-to-right",
      sweepMs: 800,
      bandColor: "#b3121f",
      bandEdgeColor: "#111111",
      motionBlur: true,
      contentMotion: { preset: "fade", durationMs: 220 },
      logoMotion: { preset: "pop-in", durationMs: 420 },
      contentGapMs: 60,
      centreLineIntroMs: 1500,
      bandScale: 1,
      sweepWidth: "full",
      sweepRoom: 0.175
    });
  });

  it("starts on air with the band waiting off screen", () => {
    const markup = render();
    expect(markup).toContain('class="scoreboard-stage" data-phase="shown"');
    expect(markup).toMatch(/class="transition-band" style="[^"]*display:none/);
  });

  it("stays hidden when the overlay loads while the operator has the scoreboard hidden", () => {
    const markup = render(undefined, { visible: false });
    expect(markup).toContain('class="scoreboard-stage" data-phase="hidden" style="visibility:hidden"');
  });

  it("builds text and logos in after the band, in build-in order, and leaves plain shapes to come in with it", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.freeComponents.push(plate());
    const { plan, buildMs } = scoreboardBuildPlan(theme);
    expect(plan.homeName).toEqual({ kind: "content", animation: expect.stringMatching(/^motion-fade 220ms ease-out/) });
    expect(plan.homeTeamLogo?.kind).toBe("logo");
    expect(plan.homeTeamLogo?.animation).toMatch(/^motion-pop-in 420ms ease-out \d+ms both$/);
    expect(plan["free-plate"]).toBeUndefined();
    expect(buildMs).toBeGreaterThan(420);

    const markup = render((draft) => draft.freeComponents.push(plate()));
    expect(slotTag(markup, "Left")).toContain('data-build="content"');
    // At rest no piece carries the build animation, so loading looks exactly as before.
    expect(markup).not.toContain("--build-animation");
  });

  it("uses the band text, or the centre line's game text when it is empty", () => {
    expect(render((theme) => (theme.transition.bandText = "Grand final"))).toContain(">GRAND FINAL<");
    expect(render((theme) => (theme.centerSecondary.gameText = "Series one"))).toContain(">SERIES ONE<");
  });

  it("has no band and no build when the sweep is off or motion is reduced", () => {
    for (const markup of [render((theme) => (theme.transition.enabled = false)), render(undefined, { reduceMotion: true })]) {
      expect(markup).not.toContain("transition-band");
      expect(markup).not.toContain("data-build");
    }
  });

  it("sends the edge block in last, and keeps the scoreboard's clip on its trailing side", () => {
    const full = { left: 0, width: 1920 };
    const { layers, stage, edgeWidth } = bandSweepFrames("left-to-right", full, 1920);
    expect(edgeWidth).toBe(192);
    // Text and strip start just off the left; the edge starts further back, so it uncovers last.
    expect(layers.text.frames[0]).toEqual({ transform: "translateX(-100%)" });
    expect(layers.strip.frames[0]).toEqual({ transform: "translateX(-1920px)" });
    expect(layers.edge.frames).toEqual([{ transform: "translateX(-1728px)" }, { transform: "translateX(1920px)" }]);
    // The clip's right inset is the canvas minus the edge's trailing side, ending at nothing.
    expect(stage).toEqual([{ clipPath: "inset(0 3648px 0 0)" }, { clipPath: "inset(0 0px 0 0)" }]);

    const mirrored = bandSweepFrames("right-to-left", full, 1920);
    expect(mirrored.layers.edge.frames).toEqual([{ transform: "translateX(3456px)" }, { transform: "translateX(-192px)" }]);
    expect(mirrored.stage).toEqual([{ clipPath: "inset(0 0 0 3648px)" }, { clipPath: "inset(0 0 0 0px)" }]);
  });

  it("keeps a scoreboard-wide sweep, and its clip, inside the scoreboard's area", () => {
    const area = { left: 500, width: 920 };
    const { layers, stage, edgeWidth } = bandSweepFrames("left-to-right", area, 1920);
    expect(edgeWidth).toBe(92);
    // The layers move within the band's own area, which is placed at left 500.
    expect(layers.edge.frames).toEqual([{ transform: "translateX(-828px)" }, { transform: "translateX(920px)" }]);
    // The clip's edge sits at 500 + the edge's left side, and ends at the area's right side.
    expect(stage).toEqual([{ clipPath: "inset(0 2248px 0 0)" }, { clipPath: "inset(0 500px 0 0)" }]);

    const theme = structuredClone(builtinThemes[0]);
    theme.transition.sweepWidth = "scoreboard";
    const built = Object.values(theme.components).filter((piece) => piece.visible);
    const leftmost = Math.min(...built.map((piece) => piece.x));
    const rightmost = Math.max(...built.map((piece) => piece.x + piece.width));
    const side = Math.round((rightmost - leftmost) * 0.175);
    const rect = transitionBandRect(theme);
    expect(rect.left).toBe(Math.max(0, leftmost - side));
    expect(rect.left + rect.width).toBe(Math.min(1920, rightmost + side));
    expect(transitionBandRect({ ...theme, transition: { ...theme.transition, sweepWidth: "full" } })).toMatchObject({ left: 0, width: 1920 });

    // Side room 0 runs the sweep exactly from the leftmost piece to the rightmost.
    theme.transition.sweepRoom = 0;
    expect(transitionBandRect(theme)).toMatchObject({ left: leftmost, width: rightmost - leftmost });
  });

  it("hides the band before its layers let go, so it never shows standing still after a sweep", () => {
    const band = { style: { display: "block" } };
    const seen: string[] = [];
    const layer = { cancel: () => seen.push(band.style.display) };
    releaseSweep({ animations: [layer, layer, layer], stage: { cancel: () => seen.push(`stage:${band.style.display}`) } }, band);
    expect(seen).toEqual(["none", "none", "none", "stage:none"]);
  });

  it("sizes the band to the scoreboard's own pieces, not free pieces elsewhere, scaled by Band size", () => {
    const theme = structuredClone(builtinThemes[0]);
    const built = Object.values(theme.components).filter((piece) => piece.visible);
    const top = Math.min(...built.map((piece) => piece.y));
    const bottom = Math.max(...built.map((piece) => piece.y + piece.height));
    const room = Math.max(6, Math.round((bottom - top) * 0.15));
    const plain = transitionBandRect(theme);
    expect(plain.height).toBe(bottom - top + room * 2);
    expect(plain.top).toBe(Math.round((top + bottom) / 2 - plain.height / 2));

    // A sponsor line near the bottom of the screen does not stretch it.
    theme.freeComponents.push({ ...plate(), y: 1000, height: 40 });
    expect(transitionBandRect(theme)).toEqual(plain);

    // Band size grows it around the scoreboard's middle.
    theme.transition.bandScale = 1.5;
    const bigger = transitionBandRect(theme);
    expect(bigger.height).toBe(Math.round(plain.height * 1.5));
    expect(bigger.top + bigger.height / 2).toBeCloseTo(plain.top + plain.height / 2, 0);
  });

  it("draws the design at its on-air placement only where asked, and keeps pinned pieces where designed", () => {
    const placedTheme = structuredClone(builtinThemes[0]);
    Object.assign(placedTheme.placement, { enabled: true, scale: 0.5, offsetX: 480, offsetY: 10 });
    placedTheme.freeComponents.push({ ...plate(), stayInPlace: true });
    const onAir = renderToStaticMarkup(<OverlayRenderer theme={placedTheme} live={live} applyPlacement />);
    expect(onAir).toContain('class="placement-layer" style="transform:translate(480px, 10px) scale(0.5)"');
    // The pinned plate is drawn after the placement layer closes, so it is not moved or scaled.
    const layerStart = onAir.indexOf('class="placement-layer"');
    expect(onAir.indexOf('class="shape-body"')).toBeGreaterThan(closingDiv(onAir, layerStart));

    // The editor's Design view and thumbnails leave it out.
    expect(renderToStaticMarkup(<OverlayRenderer theme={placedTheme} live={live} />)).toContain('<div class="placement-layer">');

    // The band follows the pieces to their on-air spot.
    const designBand = transitionBandRect(placedTheme);
    const onAirBand = transitionBandRect(placedTheme, true);
    expect(Math.abs(onAirBand.height - designBand.height * 0.5)).toBeLessThanOrEqual(1);
  });

  it("darkens the strip colour for its tail", () => {
    expect(darkerShade("#b3121f")).toBe("#51080e");
    expect(darkerShade("#fff")).toBe("#737373");
    expect(darkerShade("#b3121fcc")).toBe("#51080ecc");
    expect(darkerShade("transparent")).toBe("transparent");
  });

  it("lists show and hide changes when the theme is reviewed before saving", () => {
    const before = structuredClone(builtinThemes[0]);
    const after = structuredClone(before);
    after.transition.sweepMs = 1200;
    after.transition.direction = "right-to-left";
    const change = diffThemes(before, after, (_, label) => label).find((entry) => entry.subject === "Show and hide");
    expect(change?.details).toEqual(["Direction: Left to right → Right to left", "Sweep time: 800 → 1200"]);
  });
});
