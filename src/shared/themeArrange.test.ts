import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import type { ThemeDefinition } from "./theme";
import { alignPieces, distributePieces, matchSize, mirrorCounterpartId, mirroredX, setGapBetween } from "./themeArrange";

function themeWith(boxes: Record<"homeName" | "homeScore" | "awayName", [number, number, number, number]>): ThemeDefinition {
  const theme = structuredClone(builtinThemes[0]);
  for (const [id, [x, y, width, height]] of Object.entries(boxes)) {
    Object.assign(theme.components[id as keyof typeof boxes], { x, y, width, height });
  }
  return theme;
}

const ids = ["homeName", "homeScore", "awayName"];

describe("alignPieces", () => {
  it("aligns to the selection's edges and centre", () => {
    const theme = themeWith({ homeName: [100, 50, 200, 40], homeScore: [400, 80, 60, 60], awayName: [700, 20, 200, 40] });
    alignPieces(theme, ids, "left");
    expect(ids.map((id) => theme.components[id as "homeName"].x)).toEqual([100, 100, 100]);

    alignPieces(theme, ids, "bottom");
    expect(ids.map((id) => theme.components[id as "homeName"].y + theme.components[id as "homeName"].height)).toEqual([140, 140, 140]);
  });

  it("uses the frame as the reference for a single piece", () => {
    const theme = themeWith({ homeName: [100, 50, 200, 40], homeScore: [0, 0, 1, 1], awayName: [0, 0, 1, 1] });
    alignPieces(theme, ["homeName"], "centerX");
    expect(theme.components.homeName.x).toBe((theme.canvas.width - 200) / 2);
  });

  it("can align a group to the frame instead of the selection", () => {
    const theme = themeWith({ homeName: [100, 50, 200, 40], homeScore: [400, 80, 60, 60], awayName: [700, 20, 200, 40] });
    alignPieces(theme, ids, "right", "frame");
    expect(theme.components.awayName.x).toBe(theme.canvas.width - 200);
    expect(theme.components.homeScore.x).toBe(theme.canvas.width - 60);
  });
});

describe("distributePieces", () => {
  it("makes the gaps equal and keeps the outer pieces in place", () => {
    const theme = themeWith({ homeName: [0, 0, 100, 10], homeScore: [150, 0, 50, 10], awayName: [400, 0, 100, 10] });
    distributePieces(theme, ids, "x");
    // span 0..500, occupied 250, two gaps of 125
    expect(theme.components.homeName.x).toBe(0);
    expect(theme.components.homeScore.x).toBe(225);
    expect(theme.components.awayName.x).toBe(400);
  });

  it("needs at least three pieces", () => {
    const theme = themeWith({ homeName: [0, 0, 100, 10], homeScore: [150, 0, 50, 10], awayName: [400, 0, 100, 10] });
    distributePieces(theme, ["homeName", "homeScore"], "x");
    expect(theme.components.homeScore.x).toBe(150);
  });
});

describe("setGapBetween", () => {
  it("lays pieces out with an exact gap from the first one", () => {
    const theme = themeWith({ homeName: [10, 0, 100, 10], homeScore: [300, 0, 50, 10], awayName: [500, 0, 100, 10] });
    setGapBetween(theme, ids, "x", 8);
    expect([theme.components.homeName.x, theme.components.homeScore.x, theme.components.awayName.x]).toEqual([10, 118, 176]);
  });
});

describe("matchSize", () => {
  it("copies the first piece's size to the others", () => {
    const theme = themeWith({ homeName: [0, 0, 240, 60], homeScore: [0, 0, 80, 40], awayName: [0, 0, 200, 50] });
    matchSize(theme, ids, "width");
    expect([theme.components.homeScore.width, theme.components.awayName.width]).toEqual([240, 240]);
    expect(theme.components.homeScore.height).toBe(40);
  });
});

describe("mirroring", () => {
  it("pairs left and right team pieces both ways", () => {
    expect(mirrorCounterpartId("homeName")).toBe("awayName");
    expect(mirrorCounterpartId("awayTeamLogo")).toBe("homeTeamLogo");
    expect(mirrorCounterpartId("gameTime")).toBeNull();
  });

  it("reflects a box across the frame centre", () => {
    expect(mirroredX(1920, 100, 400)).toBe(1420);
  });
});
