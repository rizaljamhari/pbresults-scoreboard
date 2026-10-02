import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { familyFromFileName, fontOptions, fontUsageCount, replaceFontFamily, themeFontFaces } from "./fonts";
import { themeSchema, type StoredAsset } from "./theme";

describe("custom fonts", () => {
  it("names a font from its file, avoiding built-in and taken names", () => {
    expect(familyFromFileName("Gotham-Bold.woff2", [])).toBe("Gotham Bold");
    expect(familyFromFileName("BrandSans_Black.otf", [])).toBe("Brand Sans Black");
    expect(familyFromFileName("Oswald.ttf", [])).toBe("Oswald 2");
    expect(familyFromFileName("Brand.woff", ["Brand", "Brand 2"])).toBe("Brand 3");
  });

  it("renames a family everywhere it is used, including cards, the centre line and text styles", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.components.homeName.fontFamily = "Brand";
    theme.momentOverlays.timeout.fontFamily = "Brand";
    theme.centerSecondary.timerStyle.fontFamily = "Brand";
    expect(fontUsageCount(theme, "Brand")).toBe(3);
    replaceFontFamily(theme, "Brand", "Brand Display");
    expect(fontUsageCount(theme, "Brand")).toBe(0);
    expect(theme.components.homeName.fontFamily).toBe("Brand Display");
    expect(theme.centerSecondary.timerStyle.fontFamily).toBe("Brand Display");
  });

  it("lists faces with a file, and offers custom fonts after the built-in ones", () => {
    const theme = { fonts: [{ assetId: "a1", family: "Brand" }, { assetId: "gone", family: "Lost" }] };
    const assets = [{ id: "a1", url: "/uploads/a1.woff2" }] as StoredAsset[];
    expect(themeFontFaces(theme, assets)).toEqual([{ family: "Brand", url: "/uploads/a1.woff2" }]);
    const options = fontOptions(theme);
    expect(options[0]).toEqual({ value: "Bebas Neue", label: "Bebas Neue" });
    expect(options.at(-1)).toEqual({ value: "Lost", label: "Lost (custom)" });
  });

  it("accepts custom family names, refuses unsafe ones, and gives older themes no fonts", () => {
    const stored = structuredClone(builtinThemes[0]) as unknown as Record<string, any>;
    delete stored.fonts;
    stored.components.homeName.fontFamily = "Brand Display";
    const theme = themeSchema.parse(stored);
    expect(theme.fonts).toEqual([]);
    expect(theme.components.homeName.fontFamily).toBe("Brand Display");
    stored.components.homeName.fontFamily = 'Bad"Name';
    expect(themeSchema.safeParse(stored).success).toBe(false);
  });
});
