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
export const scheduledBackupsDir = path.resolve(path.join(appRootDir, "backups", "scheduled"));
export const backupStatePath = path.resolve(path.join(appRootDir, "backups", "backup-state.json"));
export const currentVersionPath = path.resolve(path.join(appRootDir, "current-version.json"));
export const portableLauncherPath = path.resolve(path.join(appRootDir, "pbresults-launcher.mjs"));
export const portableUpdaterPath = path.resolve(path.join(appRootDir, "pbresults-updater.mjs"));
/** Outside data/, so secrets never reach exports or backups, and at the root, so they survive version switches. */
export const secretsDir = path.resolve(process.env.APP_SECRETS_DIR ?? path.join(appRootDir, "secrets"));
export const remoteAccessSecretPath = path.join(secretsDir, "remote-access.json");
export const aiAssistantSecretPath = path.join(secretsDir, "ai-assistant.json");

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
