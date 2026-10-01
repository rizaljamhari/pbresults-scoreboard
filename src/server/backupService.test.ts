import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let tempRoot = "";
let backupsDir = "";
let storage: typeof import("./storage");
let service: import("./backupService").BackupService;
let BackupServiceClass: typeof import("./backupService").BackupService;

function backupFiles(dir = backupsDir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function touchSettings() {
  storage.updateSettings({ ...storage.getSettings(), pollIntervalMs: storage.getSettings().pollIntervalMs === 1000 ? 1500 : 1000 });
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-backup-service-"));
  backupsDir = path.join(tempRoot, "backups", "scheduled");
  process.env.APP_ROOT_DIR = tempRoot;
  process.env.APP_DATA_DIR = path.join(tempRoot, "data");
  process.env.APP_UPLOADS_DIR = path.join(tempRoot, "data", "uploads");
  vi.resetModules();
  storage = await import("./storage");
  BackupServiceClass = (await import("./backupService")).BackupService;
});

beforeEach(() => {
  fs.rmSync(path.join(tempRoot, "backups"), { recursive: true, force: true });
  service = new BackupServiceClass();
});

afterAll(() => {
  delete process.env.APP_ROOT_DIR;
  delete process.env.APP_DATA_DIR;
  delete process.env.APP_UPLOADS_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("backup service", () => {
  it("writes a validated backup and leaves no partial file", async () => {
    const result = await service.createBackup("manual");
    expect(result?.file).toMatch(/-manual\.pbbackup\.json$/);
    expect(backupFiles()).toEqual([result!.file]);
    const status = service.getStatus();
    expect(status.lastSuccess?.file).toBe(result!.file);
    expect(status.backups[0]).toMatchObject({ reason: "manual", automatic: false });
    await expect(service.inspectFile(result!.file)).resolves.toMatchObject({ version: 2, reason: "manual" });
  });

  it("skips an automatic backup when nothing changed since the last one", async () => {
    await service.createBackup("startup", { skipIfUnchanged: true });
    expect(await service.createBackup("shutdown", { skipIfUnchanged: true })).toBeNull();
    touchSettings();
    expect(await service.createBackup("shutdown", { skipIfUnchanged: true })).not.toBeNull();
    expect(backupFiles()).toHaveLength(2);
  });

  it("prunes only automatic backups beyond the retention limit", async () => {
    service.updateConfig({ extraFolder: null, retainAutomatic: 5 });
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, "notes.txt"), "keep me");
    await service.createBackup("manual");
    for (let index = 0; index < 7; index += 1) {
      touchSettings();
      await service.createBackup("startup");
    }
    const files = backupFiles();
    expect(files.filter((file) => file.endsWith("-startup.pbbackup.json"))).toHaveLength(5);
    expect(files.filter((file) => file.endsWith("-manual.pbbackup.json"))).toHaveLength(1);
    expect(files).toContain("notes.txt");
  });

  it("copies to the extra folder and records a failed copy without failing the backup", async () => {
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-backup-extra-"));
    try {
      service.updateConfig({ extraFolder: extra, retainAutomatic: 30 });
      const copied = await service.createBackup("manual");
      expect(copied?.extraCopy).toBe("ok");
      expect(fs.readdirSync(extra)).toEqual([copied!.file]);

      fs.rmSync(extra, { recursive: true, force: true });
      fs.writeFileSync(extra, "not a folder");
      const failed = await service.createBackup("manual");
      expect(failed?.extraCopy).toBe("failed");
      expect(failed?.extraCopyError).toBeTruthy();
      expect(backupFiles()).toHaveLength(2);
    } finally {
      fs.rmSync(extra, { recursive: true, force: true });
    }
  });

  it("rejects an extra folder that does not exist", () => {
    expect(() => service.updateConfig({ extraFolder: path.join(tempRoot, "missing"), retainAutomatic: 30 })).toThrow(/does not exist/);
    expect(() => service.updateConfig({ extraFolder: "relative/folder", retainAutomatic: 30 })).toThrow(/full path/);
  });

  it("takes a safety backup before restoring", async () => {
    const original = await service.createBackup("manual");
    touchSettings();
    const changedInterval = storage.getSettings().pollIntervalMs;

    await service.restoreFile(original!.file);

    expect(storage.getSettings().pollIntervalMs).not.toBe(changedInterval);
    const safety = service.getStatus().backups.find((entry) => entry.reason === "pre-restore");
    expect(safety).toBeTruthy();
    expect((await service.inspectFile(safety!.file)).createdAt).toBe(safety!.createdAt);
  });

  it("does not take a safety backup for a package that fails validation", async () => {
    await expect(service.restorePackage({ version: 2 })).rejects.toThrow(/not a scoreboard backup/);
    expect(service.getStatus().backups).toEqual([]);
  });

  it("rejects backup file names outside the backups folder", async () => {
    await expect(service.inspectFile("../data/settings.json")).rejects.toThrow(/Unknown backup file/);
    await expect(service.restoreFile("2026-01-01T00-00-00-000Z-manual.pbbackup.json")).rejects.toThrow(/Unknown backup file/);
  });

  it("runs backups one at a time", async () => {
    const results = await Promise.all([service.createBackup("manual"), service.createBackup("manual"), service.createBackup("manual")]);
    expect(new Set(results.map((result) => result?.file)).size).toBe(3);
    expect(backupFiles()).toHaveLength(3);
  });
});
