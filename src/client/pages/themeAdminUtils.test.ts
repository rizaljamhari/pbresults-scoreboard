import { describe, expect, it } from "vitest";
import type { ThemeDefinition } from "../../shared/theme";
import { filterAndSortThemes } from "./themeAdminUtils";

function makeTheme(overrides: Partial<ThemeDefinition>): ThemeDefinition {
  return {
    id: overrides.id ?? "theme-1",
    name: overrides.name ?? "Theme",
    description: overrides.description ?? "Description",
    builtin: overrides.builtin ?? false,
    canvas: overrides.canvas ?? {
      width: 1920,
      height: 1080,
      backgroundColor: "#00000000",
      transparentPreview: true,
      safeArea: true
    },
    components: overrides.components as ThemeDefinition["components"],
    concedeState: overrides.concedeState as ThemeDefinition["concedeState"],
    centerSecondary: overrides.centerSecondary as ThemeDefinition["centerSecondary"]
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
