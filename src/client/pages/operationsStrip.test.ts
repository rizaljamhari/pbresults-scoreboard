import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import type { ThemeDefinition } from "../../shared/theme";
import { scoreboardBand, teamSideRect } from "./operationsStrip";

function theme(): ThemeDefinition {
  return structuredClone(builtinThemes[0]);
}

describe("scoreboardBand", () => {
  it("covers every visible piece and stays inside the frame", () => {
    const t = theme();
    const band = scoreboardBand(t);
    for (const component of Object.values(t.components)) {
      if (!component.visible) continue;
      expect(component.x + component.offsetX).toBeGreaterThanOrEqual(band.x);
      expect(component.y + component.offsetY).toBeGreaterThanOrEqual(band.y);
      expect(component.x + component.offsetX + component.width).toBeLessThanOrEqual(band.x + band.width);
      expect(component.y + component.offsetY + component.height).toBeLessThanOrEqual(band.y + band.height);
    }
    expect(band.x).toBeGreaterThanOrEqual(0);
    expect(band.y).toBeGreaterThanOrEqual(0);
    expect(band.x + band.width).toBeLessThanOrEqual(t.canvas.width);
    expect(band.y + band.height).toBeLessThanOrEqual(t.canvas.height);
  });

  it("is much shorter than the frame for a scoreboard bar", () => {
    const t = theme();
    expect(scoreboardBand(t).height).toBeLessThan(t.canvas.height / 2);
  });

  it("ignores hidden pieces", () => {
    const t = theme();
    const before = scoreboardBand(t);
    t.freeComponents.push({ ...structuredClone(t.components.homeName), id: "free-far", label: "Far", visible: false, x: 10, y: 1000 } as never);
    expect(scoreboardBand(t)).toEqual(before);
  });

  it("falls back to the whole frame when nothing is visible", () => {
    const t = theme();
    for (const component of Object.values(t.components)) component.visible = false;
    t.freeComponents = [];
    t.teamEventOverlay.general.enabled = false;
    expect(scoreboardBand(t)).toEqual({ x: 0, y: 0, width: t.canvas.width, height: t.canvas.height });
  });
});

describe("teamSideRect", () => {
  it("joins the side's name and logo", () => {
    const t = theme();
    t.components.homeTeamLogo.visible = true;
    const rect = teamSideRect(t, "left")!;
    expect(rect.x).toBeLessThanOrEqual(Math.min(t.components.homeName.x, t.components.homeTeamLogo.x));
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(t.components.homeName.x + t.components.homeName.width);
  });

  it("returns nothing when both are hidden", () => {
    const t = theme();
    t.components.awayName.visible = false;
    t.components.awayTeamLogo.visible = false;
    expect(teamSideRect(t, "right")).toBeNull();
  });
});
