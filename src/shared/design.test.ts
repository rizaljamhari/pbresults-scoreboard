import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { bakeDesign, copyStyle, designUsage, paletteFromColors, pasteStyle, reconcileDesign, removeDesignItem } from "./design";
import { surfaceStyleDefaults, textStyleDefaults, themeSchema, type ThemeDefinition } from "./theme";

function base() {
  const theme = structuredClone(builtinThemes[0]);
  theme.tokens.colors = [{ id: "c-brand", name: "Brand", value: "#cc0000" }];
  theme.styles.text = [{ ...textStyleDefaults("t-name", "Team name"), fontFamily: "Bebas Neue", fontSize: 40, color: "#ffffff" }];
  theme.styles.surface = [{ ...surfaceStyleDefaults("s-plate", "Plate"), backgroundColor: "#222222", borderWidth: 2 }];
  return theme;
}

/** One editor change: mutate a copy, then reconcile and bake as the editor does. */
function edit(theme: ThemeDefinition, change: (draft: ThemeDefinition) => void) {
  const draft = structuredClone(theme);
  change(draft);
  return bakeDesign(reconcileDesign(theme, draft));
}

describe("theme colours", () => {
  it("binding a colour sets it, and editing the colour updates every user", () => {
    let theme = edit(base(), (draft) => {
      draft.components.homeName.color = "#cc0000";
      draft.components.homeName.design.tokenBindings.color = "c-brand";
      draft.components.awayScore.backgroundColor = "#cc0000";
      draft.components.awayScore.design.tokenBindings.backgroundColor = "c-brand";
    });
    theme = edit(theme, (draft) => {
      draft.tokens.colors[0].value = "#0055ff";
    });
    expect(theme.components.homeName.color).toBe("#0055ff");
    expect(theme.components.awayScore.backgroundColor).toBe("#0055ff");
  });

  it("typing a different colour unbinds that field only", () => {
    let theme = edit(base(), (draft) => {
      draft.components.homeName.color = "#cc0000";
      draft.components.homeName.design.tokenBindings = { color: "c-brand", borderColor: "c-brand" };
    });
    theme = edit(theme, (draft) => {
      draft.components.homeName.color = "#123456";
    });
    expect(theme.components.homeName.design.tokenBindings).toEqual({ borderColor: "c-brand" });
    theme = edit(theme, (draft) => {
      draft.tokens.colors[0].value = "#00ff00";
    });
    expect(theme.components.homeName.color).toBe("#123456");
    expect(theme.components.homeName.borderColor).toBe("#00ff00");
  });
});

describe("styles", () => {
  it("applying a style sets its fields, and editing the style updates its users", () => {
    let theme = edit(base(), (draft) => {
      draft.components.homeName.design.textStyleId = "t-name";
      draft.momentOverlays.timeout.design.textStyleId = "t-name";
    });
    expect(theme.components.homeName).toMatchObject({ fontFamily: "Bebas Neue", fontSize: 40 });
    theme = edit(theme, (draft) => {
      draft.styles.text[0].fontSize = 48;
    });
    expect(theme.components.homeName.fontSize).toBe(48);
    expect(theme.momentOverlays.timeout.fontSize).toBe(48);
  });

  it("a field changed on the piece becomes an override, and setting it back clears it", () => {
    let theme = edit(base(), (draft) => {
      draft.components.homeName.design.textStyleId = "t-name";
    });
    theme = edit(theme, (draft) => {
      draft.components.homeName.fontSize = 60;
    });
    expect(theme.components.homeName.design.overrides).toEqual(["fontSize"]);
    theme = edit(theme, (draft) => {
      draft.styles.text[0].fontSize = 50;
      draft.styles.text[0].fontWeight = 400;
    });
    expect(theme.components.homeName).toMatchObject({ fontSize: 60, fontWeight: 400 });
    theme = edit(theme, (draft) => {
      draft.components.homeName.fontSize = 50;
    });
    expect(theme.components.homeName.design.overrides).toEqual([]);
  });

  it("a surface style sets the box of pieces and moment cards", () => {
    const theme = edit(base(), (draft) => {
      draft.components.homeScore.design.surfaceStyleId = "s-plate";
    });
    expect(theme.components.homeScore).toMatchObject({ backgroundColor: "#222222", borderWidth: 2 });
  });

  it("typing a style's linked colour unlinks it", () => {
    let theme = edit(base(), (draft) => {
      draft.styles.text[0].tokenBindings.color = "c-brand";
    });
    theme = edit(theme, (draft) => {
      draft.styles.text[0].color = "#00ff00";
    });
    expect(theme.styles.text[0].tokenBindings).toEqual({});
    expect(theme.styles.text[0].color).toBe("#00ff00");
  });

  it("a style can use a theme colour", () => {
    let theme = edit(base(), (draft) => {
      draft.styles.text[0].tokenBindings.color = "c-brand";
      draft.components.awayName.design.textStyleId = "t-name";
    });
    expect(theme.components.awayName.color).toBe("#cc0000");
    theme = edit(theme, (draft) => {
      draft.tokens.colors[0].value = "#abcdef";
    });
    expect(theme.components.awayName.color).toBe("#abcdef");
  });
});

describe("usage, removal, copy and paste", () => {
  it("counts users and unbinds them on removal, keeping their values", () => {
    let theme = edit(base(), (draft) => {
      draft.components.homeName.design.textStyleId = "t-name";
      draft.components.homeName.color = "#cc0000";
      draft.components.homeName.design.tokenBindings.color = "c-brand";
    });
    const usage = designUsage(theme);
    expect(usage.entries("c-brand").map((entry) => entry.key)).toEqual(["component:homeName"]);
    expect(usage.entries("t-name")).toHaveLength(1);
    theme = removeDesignItem(removeDesignItem(theme, "c-brand"), "t-name");
    expect(theme.components.homeName.design).toEqual({ tokenBindings: {}, textStyleId: null, surfaceStyleId: null, overrides: [] });
    expect(theme.components.homeName).toMatchObject({ color: "#cc0000", fontFamily: "Bebas Neue" });
  });

  it("pastes a style with its bindings and overrides", () => {
    let theme = edit(base(), (draft) => {
      draft.components.homeName.design.textStyleId = "t-name";
    });
    theme = edit(theme, (draft) => {
      draft.components.homeName.fontSize = 64;
    });
    const copied = copyStyle(theme.components.homeName as unknown as Record<string, unknown>);
    expect(copied).not.toHaveProperty("x");
    expect(copied).not.toHaveProperty("defaultText");
    theme = edit(theme, (draft) => pasteStyle(draft.components.awayName as unknown as Record<string, unknown>, copied));
    expect(theme.components.awayName).toMatchObject({ fontFamily: "Bebas Neue", fontSize: 64 });
    expect(theme.components.awayName.design).toMatchObject({ textStyleId: "t-name", overrides: ["fontSize"] });
  });

  it("starts a palette from colours in use", () => {
    const palette = paletteFromColors(["#FFFFFF", "#ffffff", "#111111"]);
    expect(palette.map((token) => [token.name, token.value])).toEqual([
      ["Primary", "#ffffff"],
      ["Accent", "#111111"]
    ]);
  });

  it("older themes get empty tokens, styles and bindings", () => {
    const stored = structuredClone(builtinThemes[0]) as unknown as Record<string, any>;
    delete stored.tokens;
    delete stored.styles;
    delete stored.components.homeName.design;
    const theme = themeSchema.parse(stored);
    expect(theme.tokens.colors).toEqual([]);
    expect(theme.styles).toEqual({ text: [], surface: [] });
    expect(theme.components.homeName.design.tokenBindings).toEqual({});
    expect(bakeDesign(theme)).toEqual(theme);
  });
});
