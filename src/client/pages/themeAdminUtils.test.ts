import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import type { ThemeDefinition } from "../../shared/theme";
import { fitContent, formatEdited, organizeThemes, themeContentBounds } from "./themeAdminUtils";

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

describe("organizeThemes", () => {
  const themes: ThemeDefinition[] = [
    makeTheme({ id: "builtin-classic", name: "Classic", description: "Built in theme", builtin: true }),
    makeTheme({ id: "custom-alpha", name: "Alpha Custom", description: "Custom competitive", updatedAt: "2026-09-01T10:00:00.000Z" }),
    makeTheme({ id: "custom-bravo", name: "Bravo Custom", description: "Second custom", updatedAt: "2026-09-20T10:00:00.000Z" }),
    makeTheme({ id: "custom-old", name: "Old Event", description: "", archived: true }),
    makeTheme({ id: "custom-legacy", name: "Legacy", description: "", updatedAt: null })
  ];

  it("keeps built-ins out of the list as templates", () => {
    const sections = organizeThemes(themes, "", "nameAsc", null);
    expect(sections.templates.map((theme) => theme.id)).toEqual(["builtin-classic"]);
    expect(sections.active.some((theme) => theme.builtin)).toBe(false);
  });

  it("shows the theme on air on its own, even a built-in", () => {
    const sections = organizeThemes(themes, "", "nameAsc", "builtin-classic");
    expect(sections.onAir?.id).toBe("builtin-classic");
    const custom = organizeThemes(themes, "", "nameAsc", "custom-alpha");
    expect(custom.onAir?.id).toBe("custom-alpha");
    expect(custom.active.map((theme) => theme.id)).not.toContain("custom-alpha");
  });

  it("puts archived themes in their own section", () => {
    const sections = organizeThemes(themes, "", "nameAsc", null);
    expect(sections.archived.map((theme) => theme.id)).toEqual(["custom-old"]);
    expect(sections.active.map((theme) => theme.id)).not.toContain("custom-old");
  });

  it("sorts by most recent edit, unknown times last", () => {
    expect(organizeThemes(themes, "", "recent", null).active.map((theme) => theme.id)).toEqual(["custom-bravo", "custom-alpha", "custom-legacy"]);
  });

  it("sorts by name either way", () => {
    expect(organizeThemes(themes, "", "nameAsc", null).active.map((theme) => theme.name)).toEqual(["Alpha Custom", "Bravo Custom", "Legacy"]);
    expect(organizeThemes(themes, "", "nameDesc", null).active.map((theme) => theme.name)).toEqual(["Legacy", "Bravo Custom", "Alpha Custom"]);
  });

  it("searches name and description across every section", () => {
    const sections = organizeThemes(themes, "competitive", "nameAsc", "custom-bravo");
    expect(sections.active.map((theme) => theme.id)).toEqual(["custom-alpha"]);
    expect(sections.onAir).toBeNull();
    expect(organizeThemes(themes, "old", "nameAsc", null).archived.map((theme) => theme.id)).toEqual(["custom-old"]);
  });
});

describe("formatEdited", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  it.each([
    ["2026-10-01T11:59:40.000Z", "Edited just now"],
    ["2026-10-01T11:45:00.000Z", "Edited 15 min ago"],
    ["2026-10-01T11:00:00.000Z", "Edited 1 hour ago"],
    ["2026-10-01T07:00:00.000Z", "Edited 5 hours ago"],
    ["2026-09-30T10:00:00.000Z", "Edited yesterday"],
    ["2026-09-27T10:00:00.000Z", "Edited 4 days ago"]
  ])("formats %s as %s", (value, expected) => {
    expect(formatEdited(value, now)).toBe(expected);
  });

  it("gives a date for older edits and nothing for unknown ones", () => {
    expect(formatEdited("2026-08-01T10:00:00.000Z", now)).toMatch(/^Edited .*2026$/);
    expect(formatEdited(null, now)).toBeNull();
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
