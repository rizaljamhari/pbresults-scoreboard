import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinThemes } from "../shared/builtinThemes";
import type { FreeTextComponent, ThemeDefinition } from "../shared/theme";

let tempRoot = "";
let dataDir = "";
let uploadsDir = "";
let storage: typeof import("./storage");

async function makePng(color: string) {
  return sharp({ create: { width: 4, height: 4, channels: 4, background: color } }).png().toBuffer();
}

function operatorTextComponent(): FreeTextComponent {
  return {
    ...structuredClone(builtinThemes[0].components.homeName),
    id: "free-context",
    label: "Context",
    contentMode: "operator",
    defaultText: "DAY 1",
    maxLength: 40,
    multiline: false
  };
}

function snapshotDataDir(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(dataDir, full)] = fs.readFileSync(full).toString("base64");
    }
  };
  walk(dataDir);
  return files;
}

/** Seed one theme with operator text, a team with a logo and a team-resolution override. */
async function seed(label: string) {
  const theme: ThemeDefinition = {
    ...structuredClone(builtinThemes[0]),
    id: `theme-${label}`,
    name: `Theme ${label}`,
    builtin: false,
    freeComponents: [operatorTextComponent()]
  };
  storage.saveTheme(theme);
  storage.updateSettings({ ...storage.getSettings(), publishedThemeId: theme.id });
  storage.saveOperatorTextOverride(theme.id, "free-context", `TEXT ${label}`);
  const team = storage.createTeamRecord({ canonicalName: `Team ${label}` });
  await storage.attachTeamLogo(team.id, await makePng(label === "a" ? "#ff0000" : "#0000ff"), `${label}.png`, "image/png");
  storage.saveTeamResolutionOverride(`RAW ${label}`, team.id);
  return { theme, team: storage.getTeamRecord(team.id)! };
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-backup-storage-"));
  dataDir = path.join(tempRoot, "data");
  uploadsDir = path.join(dataDir, "uploads");
  process.env.APP_ROOT_DIR = tempRoot;
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_UPLOADS_DIR = uploadsDir;
  vi.resetModules();
  storage = await import("./storage");
});

beforeEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  for (const [name, value] of [
    ["settings.json", { ...storage.getSettings(), publishedThemeId: null, autoRemoveBackgroundUploads: false }],
    ["themes.json", []],
    ["assets.json", []],
    ["teams.json", []],
    ["operations.json", { overrides: [], operatorTextOverrides: [] }]
  ] as const) {
    fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
  }
});

afterEach(() => {
  storage.setRestoreFaultInjectorForTests(null);
});

afterAll(() => {
  delete process.env.APP_ROOT_DIR;
  delete process.env.APP_DATA_DIR;
  delete process.env.APP_UPLOADS_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("backup v2 packages", () => {
  it("round-trips settings, themes, teams, logos and operations state", async () => {
    const seeded = await seed("a");
    const pkg = JSON.parse(JSON.stringify(await storage.exportAppPackage("manual")));
    expect(pkg).toMatchObject({ version: 2, reason: "manual" });
    expect(pkg.operations.operatorTextOverrides).toHaveLength(1);

    await seed("b");
    await storage.importAppPackage(pkg);

    expect(storage.getSettings().publishedThemeId).toBe(seeded.theme.id);
    expect(storage.listTeamRecords().map((team) => team.canonicalName)).toEqual(["Team a"]);
    expect(storage.getOperationsState().overrides.map((override) => override.rawInputName)).toEqual(["RAW a"]);
    expect(storage.getOperatorTextState().fields[0].value).toBe("TEXT a");
    const logo = storage.getAsset(seeded.team.logoAssetId!);
    expect(logo && fs.existsSync(logo.filePath)).toBe(true);
    // Logos from the replaced data are removed after the commit; only the restored ones remain.
    const restoredFiles = new Set(storage.listAssets().map((asset) => path.basename(asset.url)));
    expect(fs.readdirSync(uploadsDir).filter((name) => !name.startsWith("."))).toEqual([...restoredFiles].sort());
  });

  it("still restores a version 1 export and keeps current team-resolution overrides", async () => {
    await seed("a");
    const v2 = await storage.exportAppPackage();
    const v1 = {
      version: 1,
      exportedAt: v2.exportedAt,
      settings: v2.settings,
      themes: v2.themes,
      teams: v2.teams,
      assets: v2.assets.map(({ asset, data }) => ({ asset, data }))
    };
    storage.saveTeamResolutionOverride("RAW kept", storage.listTeamRecords()[0].id);

    const preview = storage.validateAppPackage(v1).preview;
    expect(preview.version).toBe(1);
    expect(preview.warnings.some((warning) => warning.includes("older backup"))).toBe(true);

    await storage.importAppPackage(v1);
    expect(storage.getOperationsState().overrides.map((override) => override.rawInputName)).toContain("RAW kept");
    expect(storage.getOperationsState().operatorTextOverrides).toEqual([]);
  });

  it.each([
    ["a damaged section", (pkg: any) => (pkg.teams[0].canonicalName = "Tampered")],
    ["a damaged logo", (pkg: any) => (pkg.assets[0].data = pkg.assets[0].data.replace(/.{4}$/, "AAAA"))],
    ["invalid base64", (pkg: any) => (pkg.assets[0].data = "data:image/png;base64,@@@")],
    ["an unsafe file name", (pkg: any) => (pkg.assets[0].asset.url = "/uploads/..")]
  ])("rejects %s without touching live data", async (_label, damage) => {
    await seed("a");
    const pkg = JSON.parse(JSON.stringify(await storage.exportAppPackage()));
    damage(pkg);
    await seed("b");
    const before = snapshotDataDir();

    expect(() => storage.validateAppPackage(pkg)).toThrow();
    await expect(storage.importAppPackage(pkg)).rejects.toThrow();
    expect(snapshotDataDir()).toEqual(before);
  });

  it("warns about image references missing from the backup", async () => {
    await seed("a");
    const pkg = JSON.parse(JSON.stringify(await storage.exportAppPackage()));
    pkg.assets = [];
    expect(storage.validateAppPackage(pkg).preview.warnings.some((warning) => warning.includes("image reference"))).toBe(true);
  });

  it.each(["staged", "files-committed", "documents-partial"] as const)(
    "leaves every document and logo intact when the restore fails at %s",
    async (point) => {
      await seed("a");
      const pkg = JSON.parse(JSON.stringify(await storage.exportAppPackage()));
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.mkdirSync(uploadsDir, { recursive: true });
      for (const name of ["settings.json", "themes.json", "assets.json", "teams.json", "operations.json"]) {
        fs.writeFileSync(path.join(dataDir, name), name === "settings.json" ? JSON.stringify(storage.getSettings()) : "[]");
      }
      fs.writeFileSync(path.join(dataDir, "operations.json"), JSON.stringify({ overrides: [], operatorTextOverrides: [] }));
      await seed("b");
      const before = snapshotDataDir();

      storage.setRestoreFaultInjectorForTests((current) => {
        if (current === point) throw new Error(`fault at ${point}`);
      });
      await expect(storage.importAppPackage(pkg)).rejects.toThrow(`fault at ${point}`);
      expect(snapshotDataDir()).toEqual(before);
    }
  );

  it("changes the fingerprint only when stored data changes", async () => {
    await seed("a");
    const first = storage.computeDataFingerprint();
    expect(storage.computeDataFingerprint()).toBe(first);
    storage.saveOperatorTextOverride("theme-a", "free-context", "CHANGED");
    expect(storage.computeDataFingerprint()).not.toBe(first);
  });
});
