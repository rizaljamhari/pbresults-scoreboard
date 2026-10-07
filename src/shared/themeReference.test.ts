import { describe, expect, it } from "vitest";
import { componentIds, fontFamilies } from "./theme";
import { themeReference } from "./themeReference";

describe("themeReference", () => {
  const reference = themeReference();

  it("stays within its token budget (about 3.5 characters a token)", () => {
    expect(reference.length / 3.5).toBeLessThan(10_000);
  });

  it("covers every scoreboard piece and the built-in fonts", () => {
    for (const id of componentIds) expect(reference).toMatch(new RegExp(`\\b${id}\\??: `));
    for (const family of fontFamilies) expect(reference).toContain(family);
  });

  it("defines every named shape it uses", () => {
    const used = new Set([...reference.matchAll(/: ([A-Z][A-Za-z0-9]*)\b(?!<)/g)].map((match) => match[1]));
    for (const name of used) expect(reference).toContain(`type ${name} = `);
  });
});
