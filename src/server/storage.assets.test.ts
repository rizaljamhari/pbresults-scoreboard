import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinThemes } from "../shared/builtinThemes";
import type { FreeImageComponent, ThemeDefinition } from "../shared/theme";

let tempRoot = "";
let uploadsDir = "";
let storage: typeof import("./storage");

const removal = vi.hoisted(() => ({ mode: "processed" as "processed" | "failed" }));

vi.mock("./imageProcessing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./imageProcessing")>();
  return {
    ...actual,
    removeImageBackground: vi.fn(async (buffer: Buffer, _mimeType: string, originalName: string) => {
      if (removal.mode === "failed") {
        return { status: "failed" as const, reason: "mocked failure" };
      }
      const { default: sharpModule } = await import("sharp");
      const cutOut = await sharpModule(buffer).ensureAlpha().png({ compressionLevel: 0 }).toBuffer();
      // Append a marker so the processed bytes always differ from the source.
      return {
        status: "processed" as const,
        buffer: Buffer.concat([cutOut, Buffer.from("cut-out")]),
        mimeType: "image/png" as const,
        originalName: `${path.parse(originalName).name}-nobg.png`
      };
    })
  };
});

async function png(width: number, height: number, colour: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { ...colour, alpha: 1 } } }).png().toBuffer();
}

async function storePlain(name: string, colour = { r: 200, g: 30, b: 30 }, size = 4) {
  const { asset } = await storage.storeAsset(await png(size, size, colour), name, "image/png", { attemptBackgroundRemoval: false });
  return asset;
}

function fileOf(url: string) {
  return path.join(uploadsDir, path.basename(url));
}

function themeUsing(id: string, refs: { image?: string; surface?: string; free?: string; concede?: string; winner?: string; timeout?: string; gameFinished?: string }): ThemeDefinition {
  const theme: ThemeDefinition = { ...structuredClone(builtinThemes[0]), id, name: `Theme ${id}`, builtin: false };
  if (refs.image) theme.components.eventLogo.assetId = refs.image;
  if (refs.surface) theme.components.homeScore.backgroundImageAssetId = refs.surface;
  if (refs.free) {
    const free: FreeImageComponent = {
      ...structuredClone(builtinThemes[0].components.eventLogo),
      id: "free-sponsor",
      label: "Sponsor",
      assetId: refs.free
    };
    theme.freeComponents = [free];
  }
  if (refs.concede) theme.teamEventOverlay.concede.backgroundImageAssetId = refs.concede;
  if (refs.winner) theme.teamEventOverlay.winner.backgroundImageAssetId = refs.winner;
  if (refs.timeout) theme.momentOverlays.timeout.backgroundImageAssetId = refs.timeout;
  if (refs.gameFinished) theme.momentOverlays.gameFinished.backgroundImageAssetId = refs.gameFinished;
  return theme;
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-assets-"));
  uploadsDir = path.join(tempRoot, "data", "uploads");
  process.env.APP_ROOT_DIR = tempRoot;
  process.env.APP_DATA_DIR = path.join(tempRoot, "data");
  process.env.APP_UPLOADS_DIR = uploadsDir;
  vi.resetModules();
  storage = await import("./storage");
});

beforeEach(() => {
  removal.mode = "processed";
  for (const theme of storage.listThemes().filter((item) => !item.builtin)) {
    storage.deleteTheme(theme.id);
  }
  for (const team of storage.listTeamRecords()) {
    storage.deleteTeamRecord(team.id);
  }
});

afterAll(() => {
  delete process.env.APP_ROOT_DIR;
  delete process.env.APP_DATA_DIR;
  delete process.env.APP_UPLOADS_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("asset usage index", () => {
  it("finds every kind of theme and team reference", async () => {
    const asset = await storePlain("everywhere.png", { r: 1, g: 2, b: 3 });
    storage.saveTheme(themeUsing("theme-usage", {
        image: asset.id,
        surface: asset.id,
        free: asset.id,
        concede: asset.id,
        winner: asset.id,
        timeout: asset.id,
        gameFinished: asset.id
      }));
    const team = storage.createTeamRecord({ canonicalName: "Usage FC" });
    storage.attachExistingTeamLogo(team.id, asset.id, "primary");
    storage.attachExistingTeamLogo(team.id, asset.id, "alternate");

    const usages = storage.computeAssetUsageIndex().get(asset.id) ?? [];
    const places = usages.map((usage) =>
      usage.kind === "team" ? `team:${usage.slot}` : `${usage.location.type}:${"key" in usage.location ? usage.location.key : "id" in usage.location ? usage.location.id : usage.location.which}`
    );
    expect(places.sort()).toEqual(
      [
        "component:eventLogo",
        "surface:homeScore",
        "free:free-sponsor",
        "eventOverlay:concede",
        "eventOverlay:winner",
        "momentOverlay:timeout",
        "momentOverlay:gameFinished",
        "team:primary",
        "team:alternate"
      ].sort()
    );
  });

  it("tracks a theme's custom font and exports it with the theme", async () => {
    const { asset } = await storage.storeAsset(Buffer.from("wOF2-font"), "Brand.woff2", "font/woff2", { attemptBackgroundRemoval: false });
    const theme = themeUsing("theme-font", {});
    theme.fonts = [{ assetId: asset.id, family: "Brand" }];
    theme.components.homeName.fontFamily = "Brand";
    storage.saveTheme(theme);

    const usages = storage.computeAssetUsageIndex().get(asset.id) ?? [];
    expect(usages).toEqual([expect.objectContaining({ kind: "theme", themeId: "theme-font", location: { type: "font", family: "Brand" } })]);
    const exported = await storage.exportThemePackage("theme-font");
    expect(exported.assets.map((item) => item.asset.id)).toContain(asset.id);
    expect(storage.getTheme("theme-font")?.components.homeName.fontFamily).toBe("Brand");
  });

  it("exports winner overlay backgrounds with the theme", async () => {
    const asset = await storePlain("winner.png", { r: 9, g: 9, b: 90 });
    storage.saveTheme(themeUsing("theme-winner", { winner: asset.id }));
    const exported = await storage.exportThemePackage("theme-winner");
    expect(exported.assets.map((item) => item.asset.id)).toContain(asset.id);
  });
});

describe("library listing and rename", () => {
  it("lists visible assets with usage, size and original link", async () => {
    const { asset } = await storage.storeAsset(await png(6, 6, { r: 0, g: 120, b: 0 }), "cutout.png", "image/png", {
      attemptBackgroundRemoval: true
    });
    const entry = storage.listAssetLibrary().find((item) => item.id === asset.id);
    expect(entry).toMatchObject({ backgroundRemoved: true, fileMissing: false, usages: [] });
    expect(entry?.original?.id).toBe(asset.sourceAssetId);
    expect(entry?.byteSize).toBeGreaterThan(0);
    expect(storage.listAssetLibrary().some((item) => item.id === asset.sourceAssetId)).toBe(false);
  });

  it("renames without touching the file", async () => {
    const asset = await storePlain("rename-me.png", { r: 4, g: 5, b: 6 });
    const before = fs.readFileSync(fileOf(asset.url));
    const renamed = storage.renameAsset(asset.id, "  Sponsor banner  ");
    expect(renamed.displayName).toBe("Sponsor banner");
    expect(renamed.originalName).toBe("rename-me.png");
    expect(fs.readFileSync(fileOf(asset.url)).equals(before)).toBe(true);
    expect(storage.renameAsset(asset.id, "").displayName).toBeNull();
  });
});

describe("replacing, reverting and reprocessing", () => {
  it("keeps the id, follows a new extension and removes the old file", async () => {
    const asset = await storePlain("swap.png", { r: 10, g: 20, b: 30 });
    storage.saveTheme(themeUsing("theme-swap", { image: asset.id }));
    const jpeg = await sharp({ create: { width: 8, height: 5, channels: 3, background: { r: 50, g: 60, b: 70 } } }).jpeg().toBuffer();

    const { asset: replaced, processing } = await storage.replaceAssetFile(asset.id, jpeg, "swap.jpg", "image/jpeg", { removeBackground: false });

    expect(replaced.id).toBe(asset.id);
    expect(replaced.url).toBe(`/uploads/${asset.id}.jpeg`);
    expect(replaced.mimeType).toBe("image/jpeg");
    expect(replaced.updatedAt).not.toBeNull();
    expect(replaced.visibleContent).toMatchObject({ sourceWidth: 8, sourceHeight: 5 });
    expect(processing.status).toBe("skipped");
    expect(fs.existsSync(fileOf(asset.url))).toBe(false);
    expect(fs.readFileSync(fileOf(replaced.url)).equals(jpeg)).toBe(true);
    expect(storage.getTheme("theme-swap")?.components.eventLogo.assetId).toBe(asset.id);
  });

  it("stores a new hidden original when the replacement is cut out, and drops the old one", async () => {
    const { asset } = await storage.storeAsset(await png(5, 5, { r: 1, g: 100, b: 1 }), "first.png", "image/png", {
      attemptBackgroundRemoval: true
    });
    const firstOriginal = asset.sourceAssetId!;
    const { asset: replaced } = await storage.replaceAssetFile(asset.id, await png(5, 5, { r: 2, g: 2, b: 200 }), "second.png", "image/png", {
      removeBackground: true
    });

    expect(replaced.sourceAssetId).not.toBeNull();
    expect(replaced.sourceAssetId).not.toBe(firstOriginal);
    expect(storage.getAsset(firstOriginal)).toBeNull();
  });

  it("reverts to the original and removes the background again, keeping the id", async () => {
    const source = await png(5, 5, { r: 240, g: 240, b: 0 });
    const { asset } = await storage.storeAsset(source, "revert.png", "image/png", { attemptBackgroundRemoval: true });
    const processedBytes = fs.readFileSync(fileOf(asset.url));

    const reverted = await storage.revertAssetToOriginal(asset.id);
    expect(reverted.id).toBe(asset.id);
    expect(fs.readFileSync(fileOf(reverted.url)).equals(source)).toBe(true);
    expect(storage.listAssetLibrary().find((item) => item.id === asset.id)?.backgroundRemoved).toBe(false);

    const { asset: reprocessed, processing } = await storage.reprocessAssetBackground(asset.id);
    expect(processing.status).toBe("processed");
    expect(reprocessed.id).toBe(asset.id);
    expect(reprocessed.sourceAssetId).toBe(asset.sourceAssetId);
    expect(fs.readFileSync(fileOf(reprocessed.url)).equals(processedBytes)).toBe(true);
  });

  it("creates an original the first time a plain upload is cut out, and leaves it alone on failure", async () => {
    const asset = await storePlain("plain.png", { r: 33, g: 66, b: 99 });
    removal.mode = "failed";
    const failed = await storage.reprocessAssetBackground(asset.id);
    expect(failed.processing.status).toBe("failed");
    expect(failed.asset.sourceAssetId).toBeNull();

    removal.mode = "processed";
    const { asset: processed } = await storage.reprocessAssetBackground(asset.id);
    expect(processed.sourceAssetId).not.toBeNull();
    expect(storage.getAsset(processed.sourceAssetId!)?.hiddenFromPicker).toBe(true);
  });

  it("refuses to revert an asset without an original", async () => {
    const asset = await storePlain("no-original.png", { r: 77, g: 0, b: 77 });
    await expect(storage.revertAssetToOriginal(asset.id)).rejects.toBeInstanceOf(storage.AssetOperationError);
  });
});

describe("deleting", () => {
  it("refuses while in use and lists the usages", async () => {
    const asset = await storePlain("busy.png", { r: 90, g: 91, b: 92 });
    storage.saveTheme(themeUsing("theme-busy", { surface: asset.id }));
    const error = await storage.deleteAsset(asset.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(storage.AssetInUseError);
    expect((error as InstanceType<typeof storage.AssetInUseError>).usages).toHaveLength(1);
    expect(fs.existsSync(fileOf(asset.url))).toBe(true);
  });

  it("force-deletes, clears references and removes the hidden original", async () => {
    const { asset } = await storage.storeAsset(await png(5, 5, { r: 12, g: 34, b: 56 }), "force.png", "image/png", {
      attemptBackgroundRemoval: true
    });
    const originalId = asset.sourceAssetId!;
    const originalFile = fileOf(storage.getAsset(originalId)!.url);
    storage.saveTheme(themeUsing("theme-force", { image: asset.id, concede: asset.id, timeout: asset.id }));
    const team = storage.createTeamRecord({ canonicalName: "Force FC" });
    storage.attachExistingTeamLogo(team.id, asset.id, "primary");

    const result = await storage.deleteAsset(asset.id, { force: true });

    expect(result.deletedIds.sort()).toEqual([asset.id, originalId].sort());
    expect(result.clearedThemeIds).toEqual(["theme-force"]);
    expect(result.clearedTeamIds).toEqual([team.id]);
    expect(result.freedBytes).toBeGreaterThan(0);
    const theme = storage.getTheme("theme-force")!;
    expect(theme.components.eventLogo.assetId).toBeNull();
    expect(theme.teamEventOverlay.concede.backgroundImageAssetId).toBeNull();
    expect(theme.momentOverlays.timeout.backgroundImageAssetId).toBeNull();
    expect(storage.getTeamRecord(team.id)?.logoAssetId).toBeNull();
    expect(fs.existsSync(fileOf(asset.url))).toBe(false);
    expect(fs.existsSync(originalFile)).toBe(false);
  });

  it("counts the branding logo as in use and clears it on force-delete", async () => {
    const asset = await storePlain("brand.png", { r: 7, g: 8, b: 9 });
    storage.updateSettings({ ...storage.getSettings(), brandLogoAssetId: asset.id });
    expect(storage.computeAssetUsageIndex().get(asset.id)).toEqual([{ kind: "branding" }]);
    await expect(storage.deleteAsset(asset.id)).rejects.toBeInstanceOf(storage.AssetInUseError);

    await storage.deleteAsset(asset.id, { force: true });

    expect(storage.getSettings().brandLogoAssetId).toBeNull();
  });

  it("throws a not-found error for unknown ids", async () => {
    await expect(storage.deleteAsset("asset-missing")).rejects.toBeInstanceOf(storage.AssetNotFoundError);
  });
});

describe("cleanup", () => {
  it("reports unused assets, orphan originals, stray files and broken records", async () => {
    const used = await storePlain("used.png", { r: 1, g: 1, b: 1 });
    storage.saveTheme(themeUsing("theme-cleanup", { image: used.id }));
    const unused = await storePlain("unused.png", { r: 2, g: 2, b: 2 });
    const { asset: processed } = await storage.storeAsset(await png(5, 5, { r: 3, g: 3, b: 3 }), "orphan.png", "image/png", {
      attemptBackgroundRemoval: true
    });
    const orphanId = processed.sourceAssetId!;
    // Drop the processed record by hand to leave its original behind, like older builds did.
    const assetsPath = path.join(tempRoot, "data", "assets.json");
    const records = JSON.parse(fs.readFileSync(assetsPath, "utf8")) as Array<{ id: string }>;
    fs.writeFileSync(assetsPath, JSON.stringify(records.filter((record) => record.id !== processed.id)));
    fs.rmSync(fileOf(processed.url));
    const broken = await storePlain("broken.png", { r: 4, g: 4, b: 4 });
    fs.rmSync(fileOf(broken.url));
    fs.writeFileSync(path.join(uploadsDir, "stray.png"), "stray-bytes");

    const report = storage.getAssetCleanupReport(Date.now() + 2 * 24 * 60 * 60 * 1000);

    expect(report.unusedAssets.map((item) => item.id)).toContain(unused.id);
    expect(report.unusedAssets.map((item) => item.id)).not.toContain(used.id);
    expect(report.unusedAssets.every((item) => !item.recent)).toBe(true);
    expect(report.orphanOriginals.map((item) => item.id)).toContain(orphanId);
    expect(report.brokenRecords.map((item) => item.id)).toContain(broken.id);
    expect(report.strayFiles).toContainEqual({ fileName: "stray.png", byteSize: "stray-bytes".length });
    expect(report.reclaimableBytes).toBeGreaterThan(0);
    expect(storage.getAssetCleanupReport().unusedAssets.find((item) => item.id === unused.id)?.recent).toBe(true);

    const result = await storage.runAssetCleanup({
      assetIds: [unused.id, used.id],
      originalIds: [orphanId],
      strayFiles: ["stray.png", "../assets.json"],
      brokenRecordIds: [broken.id]
    });

    expect(result.deleted).toBe(4);
    expect(result.skipped.map((item) => item.id).sort()).toEqual(["../assets.json", used.id].sort());
    expect(storage.getAsset(unused.id)).toBeNull();
    expect(storage.getAsset(orphanId)).toBeNull();
    expect(storage.getAsset(broken.id)).toBeNull();
    expect(storage.getAsset(used.id)).not.toBeNull();
    expect(fs.existsSync(path.join(uploadsDir, "stray.png"))).toBe(false);
    expect(fs.existsSync(assetsPath)).toBe(true);
  });

  it("skips assets that became used after the scan", async () => {
    const asset = await storePlain("late.png", { r: 5, g: 5, b: 5 });
    expect(storage.getAssetCleanupReport().unusedAssets.map((item) => item.id)).toContain(asset.id);
    storage.saveTheme(themeUsing("theme-late", { image: asset.id }));

    const result = await storage.runAssetCleanup({ assetIds: [asset.id], originalIds: [], strayFiles: [], brokenRecordIds: [] });

    expect(result.deleted).toBe(0);
    expect(result.skipped).toEqual([{ id: asset.id, reason: "No longer unused" }]);
    expect(storage.getAsset(asset.id)).not.toBeNull();
  });
});

describe("named versions and assets", () => {
  it("counts an image used only by a version as in use, and exports it", async () => {
    const asset = await storePlain("version-only.png", { r: 5, g: 50, b: 5 });
    const theme = storage.saveTheme(themeUsing("theme-version-asset", {}));
    storage.addThemeVersion(theme.id, "With logo", themeUsing("theme-version-asset", { image: asset.id }));

    const usages = storage.computeAssetUsageIndex().get(asset.id) ?? [];
    expect(usages).toEqual([expect.objectContaining({ kind: "theme", location: { type: "version", name: "With logo" } })]);
    const exported = await storage.exportThemePackage(theme.id);
    expect(exported.assets.map((item) => item.asset.id)).toContain(asset.id);
  });
});

describe("upload versions", () => {
  it("reports each file's current version, and a new one when its bytes are replaced in place", async () => {
    const { assetVersion } = await import("../shared/assetVersion");
    const asset = await storePlain("versioned.png", { r: 1, g: 2, b: 3 });
    const fileName = path.basename(asset.url);
    const before = storage.getUploadVersion(fileName);
    expect(before).toBe(assetVersion(asset));

    const { asset: replaced } = await storage.replaceAssetFile(asset.id, await png(4, 4, { r: 9, g: 9, b: 9 }), "versioned.png", "image/png", {
      removeBackground: false
    });
    // Same address, new bytes: the version is what tells browsers apart.
    expect(replaced.url).toBe(asset.url);
    expect(storage.getUploadVersion(fileName)).not.toBe(before);
    expect(storage.getUploadVersion(fileName)).toBe(assetVersion(replaced));
    expect(storage.getUploadVersion("not-an-upload.png")).toBeNull();
  });
});
