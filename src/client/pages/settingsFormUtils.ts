import type { AppSettings } from "../../shared/theme";

export function areSettingsEqual(left: AppSettings, right: AppSettings): boolean {
  return (
    left.upstreamBaseUrl === right.upstreamBaseUrl &&
    left.publishedThemeId === right.publishedThemeId &&
    left.pollEnabled === right.pollEnabled &&
    left.pollIntervalMs === right.pollIntervalMs &&
    left.autoRemoveBackgroundUploads === right.autoRemoveBackgroundUploads &&
    left.updateCheckEnabled === right.updateCheckEnabled &&
    left.updateCheckIntervalHours === right.updateCheckIntervalHours &&
    left.updateAutoDownload === right.updateAutoDownload
  );
}

export function createSettingsDraft(source: AppSettings): AppSettings {
  return {
    upstreamBaseUrl: source.upstreamBaseUrl,
    publishedThemeId: source.publishedThemeId,
    pollEnabled: source.pollEnabled,
    pollIntervalMs: source.pollIntervalMs,
    autoRemoveBackgroundUploads: source.autoRemoveBackgroundUploads,
    updateCheckEnabled: source.updateCheckEnabled,
    updateCheckIntervalHours: source.updateCheckIntervalHours,
    updateAutoDownload: source.updateAutoDownload
  };
}
