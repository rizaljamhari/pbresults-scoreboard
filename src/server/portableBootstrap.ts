import fs from "node:fs";
import path from "node:path";
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
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temporary, "utf8"));
  fs.renameSync(temporary, target);
}

function copyCoordinatorIfMissing(sourceName: string, destination: string) {
  if (fs.existsSync(destination)) {
    return;
  }
  const source = path.join(activeAppDir, "updater-bootstrap", sourceName);
  if (!fs.existsSync(source)) {
    throw new Error(`Updater bootstrap template is missing: ${sourceName}`);
  }
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
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
    copyCoordinatorIfMissing("portable-launcher.ps1", portableLauncherPath);
    copyCoordinatorIfMissing("portable-updater.ps1", portableUpdaterPath);
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
