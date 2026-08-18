import path from "node:path";

const defaultRootDir = process.cwd();

export const appRootDir = path.resolve(process.env.APP_ROOT_DIR ?? defaultRootDir);
export const dataDir = path.resolve(process.env.APP_DATA_DIR ?? path.join(appRootDir, "data"));
export const uploadsDir = path.resolve(process.env.APP_UPLOADS_DIR ?? path.join(dataDir, "uploads"));
export const logsDir = path.resolve(process.env.APP_LOG_DIR ?? path.join(appRootDir, "logs"));
export const clientDistDir = path.resolve(process.env.APP_CLIENT_DIST_DIR ?? path.join(appRootDir, "dist/client"));
export const activeAppDir = path.resolve(process.env.APP_ACTIVE_DIR ?? appRootDir);
export const buildInfoPath = path.resolve(process.env.APP_BUILD_INFO_PATH ?? path.join(activeAppDir, "BUILD-INFO.json"));
export const updatesDir = path.resolve(process.env.APP_UPDATES_DIR ?? path.join(appRootDir, "updates"));
export const updateDownloadsDir = path.join(updatesDir, "downloads");
export const updateStagingDir = path.join(updatesDir, "staging");
export const updateTransactionsDir = path.join(updatesDir, "transactions");
export const updateStatePath = path.join(updatesDir, "update-state.json");
export const preUpdateBackupsDir = path.resolve(path.join(appRootDir, "backups", "pre-update"));
export const currentVersionPath = path.resolve(path.join(appRootDir, "current-version.json"));
export const portableLauncherPath = path.resolve(path.join(appRootDir, "portable-launcher.ps1"));
export const portableUpdaterPath = path.resolve(path.join(appRootDir, "portable-updater.ps1"));

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
