import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { themeSchema, type FreeTextComponent } from "./theme";
import {
  getNextComponentZIndex,
  getThemeComponentEntry,
  listOperatorTextComponents,
  listThemeComponentEntries
} from "./themeComponents";

function operatorText(id = "free-match-context"): FreeTextComponent {
  return {
    ...structuredClone(builtinThemes[0].components.homeName),
    id,
    label: "Match Context",
    contentMode: "operator",
    defaultText: "DAY 1 | PRELIMS",
    maxLength: 120,
    multiline: false
  };
}

describe("free theme components", () => {
  it("adds an empty free component list to legacy themes", () => {
    const legacy = structuredClone(builtinThemes[0]) as Partial<(typeof builtinThemes)[number]>;
    delete legacy.freeComponents;

    expect(themeSchema.parse(legacy).freeComponents).toEqual([]);
  });

  it("lists fixed and free components through one editor model", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.freeComponents.push(operatorText());

    const entries = listThemeComponentEntries(theme);
    expect(entries).toHaveLength(10);
    expect(getThemeComponentEntry(theme, "free-match-context")).toMatchObject({
      label: "Match Context",
      source: "free"
    });
    expect(getNextComponentZIndex(theme)).toBeGreaterThan(theme.freeComponents[0].zIndex);
  });

  it("only exposes operator-controlled free text", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.freeComponents.push(operatorText(), { ...operatorText("free-static"), contentMode: "static" });

    expect(listOperatorTextComponents(theme).map((component) => component.id)).toEqual(["free-match-context"]);
  });
});
