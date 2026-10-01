import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { builtinThemes } from "../shared/builtinThemes";

let tempRoot = "";
let storage: typeof import("./storage");

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-themes-"));
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

describe("theme names", () => {
  it("numbers a copy instead of stacking Copy", () => {
    expect(storage.uniqueThemeName("Finals", ["Finals"])).toBe("Finals 2");
    expect(storage.uniqueThemeName("Finals", ["Finals", "Finals 2"])).toBe("Finals 3");
    expect(storage.uniqueThemeName("Finals 2", ["Finals", "Finals 2"])).toBe("Finals 3");
    expect(storage.uniqueThemeName("Finals Copy", ["Finals Copy", "Finals"])).toBe("Finals 2");
    expect(storage.uniqueThemeName("Fresh", ["Finals"])).toBe("Fresh");
  });

  it("gives a duplicated theme a free name and an edit time", () => {
    const source = builtinThemes[0];
    const first = storage.createThemeFromClone(source.id);
    const second = storage.createThemeFromClone(source.id);
    expect(first.name).toBe(`${source.name} 2`);
    expect(second.name).toBe(`${source.name} 3`);
    expect(first.updatedAt).not.toBeNull();
    expect(first.builtin).toBe(false);
  });
});

describe("theme edit time and archive", () => {
  it("stamps a save but not an archive", async () => {
    const theme = storage.createThemeFromClone(builtinThemes[0].id, "Stamp test");
    const saved = storage.saveTheme({ ...theme, updatedAt: "2000-01-01T00:00:00.000Z", acronym: "ST" });
    expect(saved.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(storage.getTheme(theme.id)?.acronym).toBe("ST");

    const archived = storage.setThemeArchived(theme.id, true);
    expect(archived.archived).toBe(true);
    expect(archived.updatedAt).toBe(saved.updatedAt);
    expect(storage.setThemeArchived(theme.id, false).archived).toBe(false);
  });

  it("refuses to archive the theme on air or a built-in", () => {
    const theme = storage.createThemeFromClone(builtinThemes[0].id, "On air test");
    storage.publishTheme(theme.id);
    expect(() => storage.setThemeArchived(theme.id, true)).toThrow(/on air/);
    expect(() => storage.setThemeArchived(builtinThemes[0].id, true)).toThrow(/Built-in/);
  });

  it("brings an archived theme back when it goes on air", () => {
    const theme = storage.createThemeFromClone(builtinThemes[0].id, "Comeback");
    storage.setThemeArchived(theme.id, true);
    expect(storage.publishTheme(theme.id).archived).toBe(false);
    expect(storage.getTheme(theme.id)?.archived).toBe(false);
  });
});
