import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import type { ThemeDefinition } from "../../shared/theme";
import { filterAndSortThemes } from "./themeAdminUtils";

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
