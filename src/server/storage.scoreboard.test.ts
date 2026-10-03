import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let tempRoot = "";
let storage: typeof import("./storage");

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-scoreboard-"));
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

describe("scoreboard show / hide storage", () => {
  it("starts shown, so upgrading never takes a scoreboard off air", () => {
    fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "data", "operations.json"), JSON.stringify({ overrides: [], operatorTextOverrides: [] }));
    expect(storage.getScoreboardState()).toEqual({ visible: true, token: 0, changedAt: null });
  });

  it("remembers a hide, with a token that only moves forward", () => {
    const hidden = storage.setScoreboardVisible(false);
    expect(hidden.visible).toBe(false);
    expect(hidden.changedAt).not.toBeNull();
    expect(storage.getScoreboardState()).toEqual(hidden);

    const shown = storage.setScoreboardVisible(true);
    expect(shown.visible).toBe(true);
    expect(shown.token).toBeGreaterThan(hidden.token);
  });

  it("keeps operator text overrides when it saves", () => {
    const file = path.join(tempRoot, "data", "operations.json");
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    storage.setScoreboardVisible(false);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after.operatorTextOverrides).toEqual(before.operatorTextOverrides);
    expect(after.overrides).toEqual(before.overrides);
  });
});
