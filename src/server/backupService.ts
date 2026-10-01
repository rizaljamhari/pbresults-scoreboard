import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  automaticBackupReasons,
  type BackupConfigInput,
  type BackupEntry,
  type BackupPreview,
  type BackupRunResult,
  type BackupStatus
} from "../shared/backup.js";
import { backupReasons, type BackupReason } from "../shared/theme.js";
import { buildAppPackage, cleanupInterruptedRestores, computeDataFingerprint, importAppPackage, validateAppPackage } from "./storage.js";
import { backupStatePath, isPathInside, scheduledBackupsDir } from "./runtimePaths.js";

const backupFilePattern = new RegExp(
  `^(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)-(${backupReasons.join("|")})\\.pbbackup\\.json$`
);
const defaultRetainAutomatic = 30;

const runResultSchema = z.object({
  at: z.string(),
  reason: z.enum(backupReasons),
  durationMs: z.number(),
  sizeBytes: z.number().nullable(),
  file: z.string().nullable(),
  extraCopy: z.enum(["ok", "failed", "skipped"]),
  extraCopyError: z.string().nullable(),
  error: z.string().nullable()
});

/** Machine-local: never part of a backup, so a restored package cannot point at another computer's folders. */
const backupStateSchema = z.object({
  extraFolder: z.string().nullable().default(null),
  retainAutomatic: z.number().int().min(5).max(500).default(defaultRetainAutomatic),
  lastSuccess: runResultSchema.nullable().default(null),
  lastFailure: runResultSchema.nullable().default(null),
  lastFingerprint: z.string().nullable().default(null)
});
type BackupState = z.infer<typeof backupStateSchema>;

export class BackupFailure extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

function fileNameFor(at: string, reason: BackupReason): string {
  return `${at.replace(/[:.]/g, "-")}-${reason}.pbbackup.json`;
}

function parseBackupFileName(file: string): { createdAt: string; reason: BackupReason } | null {
  const match = backupFilePattern.exec(file);
  if (!match) return null;
  const [date, time] = match[1].split("T");
  const [hours, minutes, seconds, millis] = time.replace("Z", "").split("-");
  return { createdAt: `${date}T${hours}:${minutes}:${seconds}.${millis}Z`, reason: match[2] as BackupReason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeFileSynced(filePath: string, content: string) {
  const handle = await fsp.open(filePath, "w");
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Write to a .partial file, read it back and validate it, then rename: a final-named backup is always restorable. */
async function writeVerifiedBackup(dir: string, fileName: string, content: string) {
  await fsp.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, fileName);
  const partialPath = `${finalPath}.partial`;
  try {
    await writeFileSynced(partialPath, content);
    validateAppPackage(JSON.parse(await fsp.readFile(partialPath, "utf8")));
    await fsp.rename(partialPath, finalPath);
  } catch (error) {
    await fsp.rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function listBackupFiles(dir: string): BackupEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries: BackupEntry[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const parsed = entry.isFile() ? parseBackupFileName(entry.name) : null;
    if (!parsed) continue;
    entries.push({
      file: entry.name,
      reason: parsed.reason,
      createdAt: parsed.createdAt,
      sizeBytes: fs.statSync(path.join(dir, entry.name)).size,
      automatic: automaticBackupReasons.has(parsed.reason)
    });
  }
  return entries.sort((left, right) => right.file.localeCompare(left.file));
}

async function pruneAutomaticBackups(dir: string, retain: number) {
  const automatic = listBackupFiles(dir).filter((entry) => entry.automatic);
  for (const entry of automatic.slice(retain)) {
    await fsp.rm(path.join(dir, entry.file), { force: true });
  }
}

export class BackupService {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private changeListener: () => void = () => undefined;
  private lastStartedAt = 0;

  onChange(listener: () => void) {
    this.changeListener = listener;
  }

  isBusy(): boolean {
    return this.pending > 0;
  }

  /** Remove leftovers of a backup or restore that a crash interrupted. */
  cleanupInterrupted() {
    cleanupInterruptedRestores();
    if (fs.existsSync(scheduledBackupsDir)) {
      for (const name of fs.readdirSync(scheduledBackupsDir)) {
        if (name.endsWith(".partial")) fs.rmSync(path.join(scheduledBackupsDir, name), { force: true });
      }
    }
  }

  getStatus(): BackupStatus {
    const state = this.readState();
    return {
      backupsDir: scheduledBackupsDir,
      extraFolder: state.extraFolder,
      retainAutomatic: state.retainAutomatic,
      lastSuccess: state.lastSuccess,
      lastFailure: state.lastFailure,
      busy: this.isBusy(),
      backups: listBackupFiles(scheduledBackupsDir)
    };
  }

  /** Returns null when skipIfUnchanged found nothing new since the last successful backup. Throws on failure. */
  createBackup(reason: BackupReason, options: { skipIfUnchanged?: boolean } = {}): Promise<BackupRunResult | null> {
    return this.serialize(() => this.createBackupNow(reason, options.skipIfUnchanged ?? false));
  }

  async inspectFile(file: string): Promise<BackupPreview> {
    return validateAppPackage(await this.readBackupFile(file)).preview;
  }

  inspectPackage(raw: unknown): BackupPreview {
    return validateAppPackage(raw).preview;
  }

  async restoreFile(file: string) {
    const raw = await this.readBackupFile(file);
    return this.restorePackage(raw);
  }

  /** Validate, take a safety backup, then restore. The restore does not start if the safety backup fails. */
  restorePackage(raw: unknown) {
    return this.serialize(async () => {
      validateAppPackage(raw);
      await this.createSafetyBackup("pre-restore");
      return importAppPackage(raw);
    });
  }

  /** Run a destructive import after a safety backup. */
  runAfterSafetyBackup<T>(task: () => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      await this.createSafetyBackup("pre-import");
      return task();
    });
  }

  updateConfig(input: BackupConfigInput): BackupStatus {
    const retainAutomatic = Math.round(input.retainAutomatic);
    if (!Number.isFinite(retainAutomatic) || retainAutomatic < 5 || retainAutomatic > 500) {
      throw new BackupFailure("Keep between 5 and 500 automatic backups.");
    }
    const extraFolder = input.extraFolder?.trim() ? path.resolve(input.extraFolder.trim()) : null;
    if (extraFolder) {
      if (!path.isAbsolute(input.extraFolder!.trim())) {
        throw new BackupFailure("Enter the full path of the extra backup folder.");
      }
      if (path.resolve(extraFolder) === scheduledBackupsDir || isPathInside(scheduledBackupsDir, extraFolder)) {
        throw new BackupFailure("The extra folder must be somewhere other than the main backups folder.");
      }
      if (!fs.existsSync(extraFolder) || !fs.statSync(extraFolder).isDirectory()) {
        throw new BackupFailure("That folder does not exist. Plug in the drive or create the folder first.");
      }
      const probe = path.join(extraFolder, `.pbresults-write-test-${randomUUID()}`);
      try {
        fs.writeFileSync(probe, "ok");
        fs.rmSync(probe, { force: true });
      } catch (error) {
        throw new BackupFailure(`The scoreboard cannot write to that folder (${errorMessage(error)}).`);
      }
    }
    this.writeState({ ...this.readState(), extraFolder, retainAutomatic });
    this.changeListener();
    return this.getStatus();
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1;
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined).finally(() => {
      this.pending -= 1;
    });
    return run;
  }

  private async createSafetyBackup(reason: "pre-restore" | "pre-import") {
    try {
      await this.createBackupNow(reason, false);
    } catch (error) {
      throw new BackupFailure(`Nothing was changed: the safety backup failed (${errorMessage(error)}).`, 500);
    }
  }

  private async createBackupNow(reason: BackupReason, skipIfUnchanged: boolean): Promise<BackupRunResult | null> {
    // Strictly increasing, so back-to-back backups never share a file name.
    const startedAt = Math.max(Date.now(), this.lastStartedAt + 1);
    this.lastStartedAt = startedAt;
    const at = new Date(startedAt).toISOString();
    const fingerprint = computeDataFingerprint();
    const state = this.readState();
    if (skipIfUnchanged && state.lastSuccess && state.lastFingerprint === fingerprint) {
      return null;
    }

    const fileName = fileNameFor(at, reason);
    try {
      const { pkg } = await buildAppPackage(reason, at);
      const content = JSON.stringify(pkg);
      await writeVerifiedBackup(scheduledBackupsDir, fileName, content);

      let extraCopy: BackupRunResult["extraCopy"] = "skipped";
      let extraCopyError: string | null = null;
      if (state.extraFolder) {
        try {
          await writeVerifiedBackup(state.extraFolder, fileName, content);
          await pruneAutomaticBackups(state.extraFolder, state.retainAutomatic);
          extraCopy = "ok";
        } catch (error) {
          extraCopy = "failed";
          extraCopyError = errorMessage(error);
        }
      }
      await pruneAutomaticBackups(scheduledBackupsDir, state.retainAutomatic);

      const result: BackupRunResult = {
        at,
        reason,
        durationMs: Date.now() - startedAt,
        sizeBytes: Buffer.byteLength(content),
        file: fileName,
        extraCopy,
        extraCopyError,
        error: null
      };
      this.writeState({ ...this.readState(), lastSuccess: result, lastFingerprint: fingerprint });
      return result;
    } catch (error) {
      const result: BackupRunResult = {
        at,
        reason,
        durationMs: Date.now() - startedAt,
        sizeBytes: null,
        file: null,
        extraCopy: "skipped",
        extraCopyError: null,
        error: errorMessage(error)
      };
      try {
        this.writeState({ ...this.readState(), lastFailure: result });
      } catch {
        // The failure is still reported to the caller.
      }
      throw error;
    } finally {
      this.changeListener();
    }
  }

  private async readBackupFile(file: string): Promise<unknown> {
    const filePath = path.join(scheduledBackupsDir, file);
    if (!parseBackupFileName(file) || !isPathInside(scheduledBackupsDir, filePath)) {
      throw new BackupFailure("Unknown backup file.", 404);
    }
    try {
      return JSON.parse(await fsp.readFile(filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new BackupFailure("Unknown backup file.", 404);
      throw new BackupFailure(`The backup file cannot be read (${errorMessage(error)}).`);
    }
  }

  private readState(): BackupState {
    try {
      return backupStateSchema.parse(JSON.parse(fs.readFileSync(backupStatePath, "utf8")));
    } catch {
      return backupStateSchema.parse({});
    }
  }

  private writeState(state: BackupState) {
    fs.mkdirSync(path.dirname(backupStatePath), { recursive: true });
    const tempPath = `${backupStatePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
    fs.renameSync(tempPath, backupStatePath);
  }
}

export const backupService = new BackupService();
