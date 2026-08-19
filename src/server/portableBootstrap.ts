import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runtimeBuild } from "./buildInfo.js";
import {
  activeAppDir,
  appRootDir,
  currentVersionPath,
  portableLauncherPath,
  portableUpdaterPath,
  preUpdateBackupsDir,
  updateDownloadsDir,
  updateStagingDir,
  updateTransactionsDir,
  updatesDir
} from "./runtimePaths.js";

function atomicWriteJson(target: string, value: unknown) {
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    JSON.parse(fs.readFileSync(temporary, "utf8"));
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const coordinatorVersionPattern = /^\s*#\s*PBRESULTS_COORDINATOR_VERSION:\s*(\d+)\s*$/m;

export function readCoordinatorVersion(scriptPath: string): number {
  if (!fs.existsSync(scriptPath)) return 0;
  const match = coordinatorVersionPattern.exec(fs.readFileSync(scriptPath, "utf8"));
  if (!match) return 0;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version > 0 ? version : 0;
}

function updaterLockIsActive(lockPath: string): boolean {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const descriptor = fs.openSync(lockPath, "r+");
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
    return false;
  } catch {
    return true;
  }
}

export type CoordinatorRefreshResult = "installed" | "updated" | "identical" | "newer-present" | "deferred-active";

export function refreshCoordinatorScript(source: string, destination: string, lockPath: string): CoordinatorRefreshResult {
  if (!fs.existsSync(source)) {
    throw new Error(`Updater bootstrap template is missing: ${path.basename(source)}`);
  }
  const sourceVersion = readCoordinatorVersion(source);
  if (sourceVersion === 0) {
    throw new Error(`Updater bootstrap template has no valid coordinator version: ${path.basename(source)}`);
  }

  if (fs.existsSync(destination)) {
    const sourceBytes = fs.readFileSync(source);
    const destinationBytes = fs.readFileSync(destination);
    if (sourceBytes.equals(destinationBytes)) return "identical";
    const destinationVersion = readCoordinatorVersion(destination);
    if (destinationVersion >= sourceVersion) return "newer-present";
    if (updaterLockIsActive(lockPath)) return "deferred-active";
  } else if (updaterLockIsActive(lockPath)) {
    return "deferred-active";
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, "r+");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (readCoordinatorVersion(temporary) !== sourceVersion) {
      throw new Error(`Updater bootstrap copy failed validation: ${path.basename(source)}`);
    }
    const existed = fs.existsSync(destination);
    fs.renameSync(temporary, destination);
    return existed ? "updated" : "installed";
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function refreshPortableCoordinators(options: {
  sourceDirectory: string;
  destinationDirectory: string;
  updatesDirectory: string;
}): Record<string, CoordinatorRefreshResult> {
  const lockPath = path.join(options.updatesDirectory, "update.lock");
  return Object.fromEntries(
    ["portable-launcher.ps1", "portable-updater.ps1"].map((sourceName) => [
      sourceName,
      refreshCoordinatorScript(
        path.join(options.sourceDirectory, sourceName),
        path.join(options.destinationDirectory, sourceName),
        lockPath
      )
    ])
  );
}

export function bootstrapPortableUpdater(): { supported: boolean; reason: string | null } {
  if (!runtimeBuild.info.packaged) {
    return { supported: false, reason: "Managed updates are available only in the Windows portable package." };
  }
  if (process.platform !== "win32") {
    return { supported: false, reason: "Managed updates require the Windows x64 portable runtime." };
  }
  if (runtimeBuild.error || !runtimeBuild.info.releaseTag || !runtimeBuild.info.updaterProtocolVersion) {
    return { supported: false, reason: "Packaged build metadata is missing or invalid." };
  }

  try {
    for (const directory of [
      updatesDir,
      updateDownloadsDir,
      updateStagingDir,
      updateTransactionsDir,
      preUpdateBackupsDir,
      path.join(appRootDir, "versions"),
      path.join(updatesDir, "quarantine")
    ]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    const coordinatorResults = refreshPortableCoordinators({
      sourceDirectory: path.join(activeAppDir, "updater-bootstrap"),
      destinationDirectory: appRootDir,
      updatesDirectory: updatesDir
    });
    const deferred = Object.entries(coordinatorResults)
      .filter(([, result]) => result === "deferred-active")
      .map(([name]) => name);
    if (deferred.length > 0) {
      // The active coordinator already has the scripts loaded. The next normal
      // startup will safely refresh them after the transaction releases its lock.
      console.info(`Deferred coordinator refresh while an update is active: ${deferred.join(", ")}`);
    }
    const commandPath = path.join(appRootDir, "Run Scoreboard.cmd");
    const expectedCommand = [
      "@echo off",
      "setlocal",
      'set "ROOT_DIR=%~dp0"',
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%portable-launcher.ps1"',
      ""
    ].join("\r\n");
    const existingCommand = fs.existsSync(commandPath) ? fs.readFileSync(commandPath, "utf8") : "";
    if (!existingCommand.includes("portable-launcher.ps1")) {
      if (existingCommand && !fs.existsSync(`${commandPath}.legacy`)) {
        fs.copyFileSync(commandPath, `${commandPath}.legacy`, fs.constants.COPYFILE_EXCL);
      }
      fs.writeFileSync(commandPath, expectedCommand, "utf8");
    }

    if (!fs.existsSync(currentVersionPath)) {
      const relativePath = path.relative(appRootDir, activeAppDir);
      if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("Active application directory is outside the portable root.");
      }
      atomicWriteJson(currentVersionPath, {
        schemaVersion: 1,
        generation: 1,
        active: {
          version: runtimeBuild.info.appVersion,
          releaseTag: runtimeBuild.info.releaseTag,
          relativePath
        },
        previous: null,
        updatedAt: new Date().toISOString()
      });
    }

    JSON.parse(fs.readFileSync(currentVersionPath, "utf8"));
    fs.accessSync(updatesDir, fs.constants.R_OK | fs.constants.W_OK);
    return { supported: true, reason: null };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : "The portable updater could not be initialized."
    };
  }
}
