import { readFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { normalizeLiveState } from "../../shared/normalize";
import { freeShapeComponentSchema } from "../../shared/theme";
import { OverlayRenderer } from "./OverlayRenderer";

const live = normalizeLiveState(
  { state: "RUNNING", period: "GAME", round: 1, gameTimer: { value: 300, state: 2 }, mainGame: [{ name: "Left", score: 1 }, { name: "Right", score: 0 }] },
  { sourceStatus: "ok", fetchedAt: "2026-10-07T05:00:00.000Z", errorMessage: null }
);

const edge = freeShapeComponentSchema.parse({
  kind: "shape",
  id: "free-edge",
  label: "Edge",
  x: 0,
  y: 0,
  width: 400,
  height: 8,
  zIndex: 9,
  visible: true,
  opacity: 1,
  backgroundColor: "#ff0000",
  borderColor: "#00000000",
  borderWidth: 0,
  borderRadius: [0, 0, 0, 0],
  paddingX: 0,
  paddingY: 0,
  offsetX: 0,
  offsetY: 0,
  shadow: "none"
});

const stylesheet = postcss.parse(readFileSync(new URL("../styles.css", import.meta.url), "utf8"));

function declarations(selector: string) {
  const found: Record<string, string> = {};
  stylesheet.walkRules((rule: Rule) => {
    if (rule.parent?.type !== "root" || rule.selector !== selector) return;
    rule.walkDecls((decl) => {
      found[decl.prop] = decl.value;
    });
  });
  return found;
}

describe("overlay slots and the global button rule", () => {
  it("renders an 8px shape as an 8px tall slot", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.freeComponents = [...theme.freeComponents, edge];
    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} />);
    const slot = markup.match(/<button[^>]*class="component-slot"[^>]*style="([^"]*left:0;top:0;width:400px[^"]*)"/);
    expect(slot?.[1]).toContain("height:8px");
  });

  it("does not let the admin's 42px button minimum stretch an overlay slot", () => {
    const button = Object.entries(declarations("button:not(:where(.te-shell *, .te-popover *, .te-menu *, .te-tooltip *, .pba-scope *, .pba-pop *))"));
    expect(button).toContainEqual(["min-height", "42px"]);
    // .component-slot outranks the global rule (class vs element), so its reset is what the slot gets.
    expect(declarations(".component-slot")["min-height"]).toBe("0");
  });
});
