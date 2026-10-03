import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { designBounds, placeRect, placementFrame, placementTransform, presetPlacement, resizedPlacement, thinOnAir } from "./placement";
import { themeSchema } from "./theme";
import { diffThemes } from "./themeDiff";

function theme() {
  return structuredClone(builtinThemes[0]);
}

describe("on-air placement", () => {
  it("is off for older themes and leaves the design exactly as built", () => {
    const stored = theme() as unknown as Record<string, unknown>;
    delete stored.placement;
    const parsed = themeSchema.parse(stored);
    expect(parsed.placement).toEqual({ enabled: false, scale: 1, offsetX: 0, offsetY: 0 });
    expect(parsed.components.homeName.stayInPlace).toBe(false);
    expect(placementTransform(parsed.placement)).toBeNull();
    expect(placementTransform({ enabled: true, scale: 1, offsetX: 0, offsetY: 0 })).toBeNull();
  });

  it("moves and scales a rectangle as one piece", () => {
    expect(placeRect({ x: 100, y: 200, width: 400, height: 100 }, { scale: 0.5, x: 10, y: 20 })).toEqual({ x: 60, y: 120, width: 200, height: 50 });
  });

  it("puts the design at the top centre, 45% of the frame wide", () => {
    const draft = theme();
    Object.assign(draft.placement, { enabled: true, ...presetPlacement(draft, "top-centre", 0.45) });
    const frame = placementFrame(draft)!;
    expect(frame.width / draft.canvas.width).toBeCloseTo(0.45, 2);
    expect(frame.x + frame.width / 2).toBeCloseTo(draft.canvas.width / 2, 0);
    expect(frame.y).toBeCloseTo(Math.round(draft.canvas.height * 0.03), 0);
  });

  it("never makes the design bigger than built", () => {
    const draft = theme();
    expect(presetPlacement(draft, "top-left", 5).scale).toBe(1);
  });

  it("resizes from the frame's top-left corner", () => {
    const draft = theme();
    Object.assign(draft.placement, { enabled: true, ...presetPlacement(draft, "bottom-centre", 0.6) });
    const before = placementFrame(draft)!;
    Object.assign(draft.placement, resizedPlacement(draft, draft.placement.scale / 2));
    const after = placementFrame(draft)!;
    // Offsets are whole pixels, so allow a pixel of rounding.
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.width - before.width / 2)).toBeLessThanOrEqual(1);
  });

  it("leaves pieces set to stay in place out of the frame", () => {
    const draft = theme();
    const all = designBounds(draft)!;
    const pinned = Object.values(draft.components).filter((piece) => piece.visible).sort((a, b) => a.x - b.x)[0];
    pinned.stayInPlace = true;
    expect(designBounds(draft)!.x).toBeGreaterThanOrEqual(all.x);
  });

  it("warns about borders that go under a pixel on air", () => {
    const draft = theme();
    draft.components.homeName.borderWidth = 1;
    Object.assign(draft.placement, { enabled: true, scale: 0.4, offsetX: 0, offsetY: 0 });
    expect(thinOnAir(draft, (id) => id)).toContain("homeName");
    draft.components.homeName.borderWidth = 4;
    expect(thinOnAir(draft, (id) => id)).not.toContain("homeName");
  });

  it("lists placement changes when the theme is reviewed before saving", () => {
    const before = theme();
    const after = structuredClone(before);
    Object.assign(after.placement, { enabled: true, scale: 0.5, offsetX: 300, offsetY: 20 });
    const change = diffThemes(before, after, (_, label) => label).find((entry) => entry.subject === "On-air placement");
    expect(change?.details).toEqual(["Placed on air", "Size: 100% → 50% of the design", "Moved"]);
  });
});
