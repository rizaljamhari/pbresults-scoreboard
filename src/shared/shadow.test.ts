import { describe, expect, it } from "vitest";
import { boxShadowPresets, matchShadowPreset, parseShadow, parseShadowColor, serializeShadow, textShadowPresets } from "./shadow";

describe("parseShadow", () => {
  it("reads none and empty as no shadow", () => {
    expect(parseShadow("none", "box")).toEqual([]);
    expect(parseShadow("", "box")).toEqual([]);
    expect(parseShadow("  NONE ", "text")).toEqual([]);
  });

  it("reads layered box shadows with inset and rgba colours", () => {
    expect(parseShadow("0 4px 12px rgba(0, 0, 0, 0.5), inset 2px 2px 0 -1px #fff", "box")).toEqual([
      { x: 0, y: 4, blur: 12, spread: 0, color: "#00000080", inset: false },
      { x: 2, y: 2, blur: 0, spread: -1, color: "#ffffffff", inset: true }
    ]);
  });

  it("accepts the colour first, as CSS allows", () => {
    expect(parseShadow("#11223344 1px 2px 3px", "text")).toEqual([{ x: 1, y: 2, blur: 3, spread: 0, color: "#11223344", inset: false }]);
  });

  it("keeps what it can't show as custom CSS", () => {
    expect(parseShadow("0 0 1em black", "box")).toBeNull();
    expect(parseShadow("0 0 4px var(--glow)", "box")).toBeNull();
    expect(parseShadow("0 0 4px rebeccapurple", "box")).toBeNull();
    expect(parseShadow("inset 0 0 4px #000", "text")).toBeNull();
    expect(parseShadow("1px 1px 1px 1px #000", "text")).toBeNull();
    expect(parseShadow("4px", "box")).toBeNull();
  });
});

describe("serializeShadow", () => {
  it("writes none for no layers and round-trips layers", () => {
    expect(serializeShadow([], "box")).toBe("none");
    const css = "inset 0 4px 12px -2px #00000080, 6px 6px 0 0 #000000";
    expect(serializeShadow(parseShadow(css, "box")!, "box")).toBe(css);
  });

  it("drops spread and inset for text shadows", () => {
    expect(serializeShadow([{ x: 1, y: 2, blur: 3, spread: 9, color: "#ffffffff", inset: true }], "text")).toBe("1px 2px 3px #ffffff");
  });
});

describe("presets", () => {
  it("recognises each preset after a round trip", () => {
    for (const [kind, presets] of [["box", boxShadowPresets], ["text", textShadowPresets]] as const) {
      for (const preset of presets) {
        const parsed = parseShadow(serializeShadow(preset.layers, kind), kind)!;
        expect(matchShadowPreset(parsed, kind, presets)).toBe(preset.id);
      }
    }
  });
});

describe("parseShadowColor", () => {
  it("normalises hex, keywords and rgb to #rrggbbaa", () => {
    expect(parseShadowColor("#abc")).toBe("#aabbccff");
    expect(parseShadowColor("black")).toBe("#000000ff");
    expect(parseShadowColor("rgb(255 0 0 / 50%)")).toBe("#ff000080");
    expect(parseShadowColor("hsl(0 0% 0%)")).toBeNull();
  });
});
