import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import type { ThemeDefinition } from "../../shared/theme";
import { filterAndSortThemes, fitContent, themeContentBounds } from "./themeAdminUtils";

function makeTheme(overrides: Partial<ThemeDefinition>): ThemeDefinition {
  return {
    ...structuredClone(builtinThemes[0]),
    id: "theme-1",
    name: "Theme",
    description: "Description",
    builtin: false,
    ...overrides
  };
}

describe("filterAndSortThemes", () => {
  const themes: ThemeDefinition[] = [
    makeTheme({ id: "builtin-classic", name: "Classic", description: "Built in theme", builtin: true }),
    makeTheme({ id: "custom-alpha", name: "Alpha Custom", description: "Custom competitive", builtin: false }),
    makeTheme({ id: "custom-bravo", name: "Bravo Custom", description: "Second custom", builtin: false })
  ];

  it("filters by kind", () => {
    expect(filterAndSortThemes(themes, "", "builtin", "nameAsc").map((theme) => theme.id)).toEqual(["builtin-classic"]);
    expect(filterAndSortThemes(themes, "", "custom", "nameAsc").map((theme) => theme.id)).toEqual([
      "custom-alpha",
      "custom-bravo"
    ]);
  });

  it("filters by search over name and description", () => {
    expect(filterAndSortThemes(themes, "competitive", "all", "nameAsc").map((theme) => theme.id)).toEqual(["custom-alpha"]);
    expect(filterAndSortThemes(themes, "classic", "all", "nameAsc").map((theme) => theme.id)).toEqual(["builtin-classic"]);
  });

  it("sorts by name direction", () => {
    expect(filterAndSortThemes(themes, "", "all", "nameAsc").map((theme) => theme.name)).toEqual([
      "Alpha Custom",
      "Bravo Custom",
      "Classic"
    ]);
    expect(filterAndSortThemes(themes, "", "all", "nameDesc").map((theme) => theme.name)).toEqual([
      "Classic",
      "Bravo Custom",
      "Alpha Custom"
    ]);
  });
});

describe("theme thumbnail crop", () => {
  it("covers every visible piece and ignores hidden ones", () => {
    const theme = structuredClone(builtinThemes[0]);
    for (const component of Object.values(theme.components)) {
      component.visible = false;
    }
    theme.freeComponents = [];
    Object.assign(theme.components.homeName, { visible: true, opacity: 1, x: 100, y: 50, width: 200, height: 40 });
    Object.assign(theme.components.awayName, { visible: true, opacity: 1, x: 500, y: 60, width: 100, height: 60 });
    expect(themeContentBounds(theme)).toEqual({ x: 100, y: 50, width: 500, height: 70 });
  });

  it("keeps the crop inside the frame", () => {
    const theme = structuredClone(builtinThemes[0]);
    Object.assign(theme.components.homeName, { visible: true, x: -50, y: -20 });
    const bounds = themeContentBounds(theme);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
  });

  it("falls back to the whole frame when nothing is visible", () => {
    const theme = structuredClone(builtinThemes[0]);
    for (const component of Object.values(theme.components)) {
      component.visible = false;
    }
    theme.freeComponents = [];
    expect(themeContentBounds(theme)).toEqual({ x: 0, y: 0, width: theme.canvas.width, height: theme.canvas.height });
  });

  it("centres the content in the box, fitting the tighter side", () => {
    expect(fitContent({ x: 100, y: 50, width: 1000, height: 100 }, 320, 140, 10)).toEqual({ scale: 0.3, x: -20, y: 40 });
  });
});
