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

describe("named versions", () => {
  function savedTheme(id: string) {
    return storage.saveTheme({ ...structuredClone(builtinThemes[0]), id, name: `Versions ${id}`, builtin: false });
  }

  it("keeps a version without editing the theme, newest first, up to the limit", () => {
    const theme = savedTheme("theme-versions");
    const draft = { ...theme, description: "Draft description" };
    let updated = storage.addThemeVersion(theme.id, "Before sponsor", draft);
    expect(updated.updatedAt).toBe(theme.updatedAt);
    expect(updated.description).toBe(theme.description);
    expect(updated.versions[0]).toMatchObject({ name: "Before sponsor", theme: expect.objectContaining({ description: "Draft description" }) });
    expect(updated.versions[0].theme).not.toHaveProperty("versions");

    for (let index = 1; index <= storage.MAX_THEME_VERSIONS; index += 1) {
      updated = storage.addThemeVersion(theme.id, `V${index}`, draft);
    }
    expect(updated.versions).toHaveLength(storage.MAX_THEME_VERSIONS);
    expect(updated.versions[0].name).toBe(`V${storage.MAX_THEME_VERSIONS}`);
    expect(updated.versions.map((version) => version.name)).not.toContain("Before sponsor");
  });

  it("keeps versions when an editor saves the theme with an older list, and deletes one on request", () => {
    const theme = savedTheme("theme-versions-save");
    const withVersion = storage.addThemeVersion(theme.id, "Keep me", theme);
    const saved = storage.saveTheme({ ...theme, versions: [], name: "Renamed" });
    expect(saved.name).toBe("Renamed");
    expect(saved.versions.map((version) => version.name)).toEqual(["Keep me"]);
    const afterDelete = storage.deleteThemeVersion(theme.id, withVersion.versions[0].id);
    expect(afterDelete.versions).toEqual([]);
  });

  it("refuses versions on built-in themes", () => {
    expect(() => storage.addThemeVersion(builtinThemes[0].id, "Nope", builtinThemes[0])).toThrow("Save a copy first");
  });
});
