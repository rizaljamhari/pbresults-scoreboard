import { describe, expect, it } from "vitest";
import type { VisibleContentAnalysis } from "../shared/theme";
import { isUnpaddedFullFrame, resolveVisibleContentViewport } from "./visibleContentGeometry";

const analysis: VisibleContentAnalysis = {
  analyzerVersion: 1,
  status: "ready",
  sourceWidth: 100,
  sourceHeight: 80,
  x: 10,
  y: 20,
  width: 40,
  height: 20,
  alphaThreshold: 8
};

describe("visible content geometry", () => {
  it("adds proportional padding around the visible rectangle", () => {
    expect(resolveVisibleContentViewport(analysis, 10, "contain", "center")).toEqual({
      viewBox: "6 18 48 24",
      preserveAspectRatio: "xMidYMid meet"
    });
  });

  it.each([
    ["contain", "top", "xMidYMin meet"],
    ["cover", "right", "xMaxYMid slice"],
    ["stretch", "bottom", "none"]
  ] as const)("maps %s and %s to SVG alignment", (fit, position, expected) => {
    expect(resolveVisibleContentViewport(analysis, 0, fit, position)?.preserveAspectRatio).toBe(expected);
  });

  it("rejects bounds outside the source raster", () => {
    expect(
      resolveVisibleContentViewport({ ...analysis, x: 90, width: 20 }, 0, "contain", "center")
    ).toBeNull();
  });

  it("recognizes an unpadded full-frame analysis", () => {
    const fullFrame: VisibleContentAnalysis = {
      ...analysis,
      x: 0,
      y: 0,
      width: analysis.sourceWidth,
      height: analysis.sourceHeight
    };

    expect(isUnpaddedFullFrame(fullFrame, 0)).toBe(true);
    expect(isUnpaddedFullFrame(fullFrame, 5)).toBe(false);
  });
});
