import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { themeSchema } from "./theme";
import { applyThemeOps, ThemeOpError, themeEditAnswerSchema } from "./themeOps";

function themeWithStyles() {
  const theme = structuredClone(builtinThemes[0]);
  const parsed = themeSchema.parse({
    ...theme,
    styles: { text: [{ id: "headline", name: "Headline", fontFamily: "Bebas Neue" }, { id: "body", name: "Body", fontFamily: "Barlow Condensed" }], surface: [] }
  });
  return parsed;
}

describe("applyThemeOps", () => {
  it("replaces a value without touching the original", () => {
    const theme = structuredClone(builtinThemes[0]);
    const next = applyThemeOps(theme, [{ op: "replace", path: "/components/homeName/fontSize", value: 99 }]);
    expect(next.components.homeName.fontSize).toBe(99);
    expect(theme.components.homeName.fontSize).not.toBe(99);
  });

  it("picks list items by id", () => {
    const theme = themeWithStyles();
    const next = applyThemeOps(theme, [{ op: "replace", path: "/styles/text/@body/fontFamily", value: "Oswald" }]);
    expect(next.styles.text.map((style) => style.fontFamily)).toEqual(["Bebas Neue", "Oswald"]);
  });

  it("adds to the end of a list and removes by id", () => {
    const theme = themeWithStyles();
    const next = applyThemeOps(theme, [
      { op: "add", path: "/styles/text/-", value: { id: "caption", name: "Caption", fontFamily: "Oswald" } },
      { op: "remove", path: "/styles/text/@headline" }
    ]);
    expect(next.styles.text.map((style) => style.id)).toEqual(["body", "caption"]);
  });

  it("decodes escaped path segments", () => {
    const theme = structuredClone(builtinThemes[0]);
    const next = applyThemeOps(theme, [{ op: "add", path: "/tokens/a~1b", value: 1 }]);
    expect((next.tokens as Record<string, unknown>)["a/b"]).toBe(1);
  });

  it("refuses unknown ids and missing fields, naming the edit", () => {
    const theme = themeWithStyles();
    expect(() => applyThemeOps(theme, [{ op: "replace", path: "/styles/text/@nope/fontFamily", value: "Oswald" }])).toThrow('Edit 1: no item with id "nope"');
    expect(() =>
      applyThemeOps(theme, [
        { op: "replace", path: "/components/homeName/fontSize", value: 60 },
        { op: "remove", path: "/components/homeName/notAField" }
      ])
    ).toThrow('Edit 2: "notAField" doesn\'t exist');
  });

  it("refuses to change ids, history or the whole theme", () => {
    const theme = themeWithStyles();
    for (const path of ["/id", "/versions", "/builtin", "/styles/text/@body/id", ""]) {
      expect(() => applyThemeOps(theme, [{ op: "replace", path, value: "x" }])).toThrow(ThemeOpError);
    }
  });

  it("refuses a replace that silently drops or duplicates items", () => {
    const theme = themeWithStyles();
    const [headline] = theme.styles.text;
    expect(() => applyThemeOps(theme, [{ op: "replace", path: "/styles/text", value: [headline] }])).toThrow('item "body" disappeared without a remove');
    expect(() => applyThemeOps(theme, [{ op: "add", path: "/styles/text/-", value: headline }])).toThrow('id "headline" is used more than once');
  });

  it("allows replacing a whole list when every item survives", () => {
    const theme = themeWithStyles();
    const reversed = [...theme.styles.text].reverse();
    expect(applyThemeOps(theme, [{ op: "replace", path: "/styles/text", value: reversed }]).styles.text.map((style) => style.id)).toEqual(["body", "headline"]);
  });
});

describe("themeEditAnswerSchema", () => {
  it("accepts the documented answer shape", () => {
    expect(
      themeEditAnswerSchema.parse({ summary: "Done.", ops: [{ op: "remove", path: "/a" }, { op: "replace", path: "/b", value: 1 }] }).ops
    ).toHaveLength(2);
    expect(themeEditAnswerSchema.safeParse({ summary: "x", ops: [{ op: "move", path: "/a" }] }).success).toBe(false);
  });
});
