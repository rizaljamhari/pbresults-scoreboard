import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { builtinThemes } from "../shared/builtinThemes";
import type { FreeImageComponent, FreeTextComponent, ThemeDefinition } from "../shared/theme";

let tempRoot = "";
let storage: typeof import("./storage");

function makeOperatorText(): FreeTextComponent {
  return {
    ...structuredClone(builtinThemes[0].components.homeName),
    id: "free-match-context",
    label: "Match Context",
    contentMode: "operator",
    defaultText: "DAY 1 | PRELIMS",
    maxLength: 40,
    multiline: false
  };
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-operator-text-"));
  process.env.APP_ROOT_DIR = tempRoot;
  process.env.APP_DATA_DIR = path.join(tempRoot, "data");
  process.env.APP_UPLOADS_DIR = path.join(tempRoot, "data", "uploads");
  vi.resetModules();
  storage = await import("./storage");
});

afterAll(() => {
  delete process.env.APP_ROOT_DIR;
  delete process.env.APP_DATA_DIR;
  delete process.env.APP_UPLOADS_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("operator text storage", () => {
  it("persists, resolves, and resets text for the published theme", () => {
    const theme: ThemeDefinition = {
      ...structuredClone(builtinThemes[0]),
      id: "theme-operator-test",
      name: "Operator Test",
      builtin: false,
      freeComponents: [makeOperatorText()]
    };
    storage.saveTheme(theme);
    storage.updateSettings({ ...storage.getSettings(), publishedThemeId: theme.id });

    expect(storage.getOperatorTextState().fields[0]).toMatchObject({
      componentId: "free-match-context",
      value: "DAY 1 | PRELIMS",
      hasOverride: false
    });

    storage.saveOperatorTextOverride(theme.id, "free-match-context", "DAY 2 | FINALS");
    expect(storage.getOperatorTextState().fields[0]).toMatchObject({
      value: "DAY 2 | FINALS",
      hasOverride: true
    });

    storage.clearOperatorTextOverride(theme.id, "free-match-context");
    expect(storage.getOperatorTextState().fields[0]).toMatchObject({
      value: "DAY 1 | PRELIMS",
      hasOverride: false
    });
  });

  it("rejects invalid operator updates", () => {
    expect(() => storage.saveOperatorTextOverride("wrong-theme", "free-match-context", "TEST")).toThrow(
      "Published theme changed"
    );
    expect(() => storage.saveOperatorTextOverride("theme-operator-test", "free-match-context", "X".repeat(41))).toThrow(
      "40 characters or fewer"
    );
    expect(() => storage.saveOperatorTextOverride("theme-operator-test", "free-match-context", "LINE 1\nLINE 2")).toThrow(
      "only supports one line"
    );
  });

  it("drops an override when later theme constraints make it invalid", () => {
    storage.saveOperatorTextOverride("theme-operator-test", "free-match-context", "DAY 2 | FINALS");
    const theme = storage.getTheme("theme-operator-test");
    expect(theme).not.toBeNull();
    const freeText = theme!.freeComponents.find((component) => component.id === "free-match-context");
    expect(freeText?.kind).toBe("text");
    if (!freeText || freeText.kind !== "text") {
      return;
    }
    freeText.maxLength = 10;
    freeText.defaultText = "DAY 1";
    storage.saveTheme(theme!);

    expect(storage.getOperatorTextState().fields[0]).toMatchObject({
      value: "DAY 1",
      hasOverride: false
    });
  });

  it("includes free image assets in theme export", async () => {
    const { asset } = await storage.storeAsset(Buffer.from("image-data"), "sponsor.png", "image/png", {
      attemptBackgroundRemoval: false
    });
    const freeImage: FreeImageComponent = {
      ...structuredClone(builtinThemes[0].components.eventLogo),
      id: "free-sponsor",
      label: "Sponsor",
      assetId: asset.id
    };
    const theme = storage.getTheme("theme-operator-test");
    expect(theme).not.toBeNull();
    storage.saveTheme({ ...theme!, freeComponents: [...theme!.freeComponents, freeImage] });

    const exported = await storage.exportThemePackage("theme-operator-test");
    expect(exported.assets.some((item) => item.asset.id === asset.id)).toBe(true);
  });
});
