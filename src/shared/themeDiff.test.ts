import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { freeShapeComponentSchema } from "./theme";
import { diffThemes } from "./themeDiff";

const names: Record<string, string> = { homeName: "Left team name", homeScore: "Left score" };
const pieceName = (id: string, label: string) => names[id] ?? label;

describe("diffThemes", () => {
  it("finds nothing between identical themes", () => {
    const theme = structuredClone(builtinThemes[0]);
    expect(diffThemes(theme, structuredClone(theme), pieceName)).toEqual([]);
  });

  it("describes setting changes on a piece in the editor's words", () => {
    const before = structuredClone(builtinThemes[0]);
    const after = structuredClone(before);
    after.components.homeName.fontSize = before.components.homeName.fontSize + 4;
    after.components.homeName.x += 10;
    after.components.homeScore.visible = false;
    const changes = diffThemes(before, after, pieceName);
    expect(changes).toEqual([
      expect.objectContaining({
        pieceId: "homeName",
        subject: "Left team name",
        details: [`Position: ${before.components.homeName.x}, ${before.components.homeName.y} → ${after.components.homeName.x}, ${after.components.homeName.y}`, `Font size: ${before.components.homeName.fontSize} → ${after.components.homeName.fontSize}`]
      }),
      expect.objectContaining({ pieceId: "homeScore", details: ["Hidden"] })
    ]);
  });

  it("reports new and removed layers, and structured settings as changed", () => {
    const before = structuredClone(builtinThemes[0]);
    const after = structuredClone(before);
    after.freeComponents.push(
      freeShapeComponentSchema.parse({
        kind: "shape", id: "free-bar", label: "Sponsor bar", x: 0, y: 0, width: 10, height: 10, zIndex: 1, visible: true, opacity: 1,
        backgroundColor: "#000", borderColor: "#000", borderWidth: 0, borderRadius: [0, 0, 0, 0], paddingX: 0, paddingY: 0, offsetX: 0, offsetY: 0, shadow: "none"
      })
    );
    after.components.homeName.enterMotion = { ...after.components.homeName.enterMotion, preset: "fade" };
    const changes = diffThemes(before, after, pieceName);
    expect(changes.map((change) => change.subject)).toEqual(["Left team name", "New layer: Sponsor bar"]);
    expect(changes[0].details).toEqual(["Entrance changed"]);

    const removed = diffThemes(after, before, pieceName);
    expect(removed.at(-1)).toMatchObject({ subject: "Removed layer: Sponsor bar", kind: "removed", pieceId: null });
  });

  it("lists theme colours, styles and style links", () => {
    const before = structuredClone(builtinThemes[0]);
    const after = structuredClone(before);
    after.tokens.colors = [{ id: "c1", name: "Brand", value: "#cc0000" }];
    after.styles.text = [{ ...structuredClone(after.styles.text[0] ?? {}), id: "t1", name: "Scores" } as never];
    after.components.homeScore.design.textStyleId = "t1";
    const changes = diffThemes(before, after, pieceName);
    expect(changes.find((change) => change.subject === "Left score")?.details).toEqual(["Text style: none → Scores"]);
    expect(changes.find((change) => change.subject === "Theme colours")?.details).toEqual(["Added “Brand”"]);
  });

  it("caps long detail lists", () => {
    const before = structuredClone(builtinThemes[0]);
    const after = structuredClone(before);
    Object.assign(after.components.homeName, { fontSize: 1, fontWeight: 100, letterSpacing: 9, lineHeight: 2, color: "#123456", backgroundColor: "#654321", opacity: 0.5, borderWidth: 9 });
    const details = diffThemes(before, after, pieceName)[0].details;
    expect(details).toHaveLength(6);
    expect(details.at(-1)).toBe("and 3 more");
  });
});
