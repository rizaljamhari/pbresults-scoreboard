import type { AppSettings } from "../../shared/theme";

export function areSettingsEqual(left: AppSettings, right: AppSettings): boolean {
  return (
    left.upstreamBaseUrl === right.upstreamBaseUrl &&
    left.publishedThemeId === right.publishedThemeId &&
    left.pollEnabled === right.pollEnabled &&
    left.pollIntervalMs === right.pollIntervalMs &&
    left.autoRemoveBackgroundUploads === right.autoRemoveBackgroundUploads &&
    left.reduceMotion === right.reduceMotion &&
    left.updateCheckEnabled === right.updateCheckEnabled &&
    left.updateCheckIntervalHours === right.updateCheckIntervalHours &&
    left.updateAutoDownload === right.updateAutoDownload &&
    left.brandName === right.brandName &&
    left.brandLogoAssetId === right.brandLogoAssetId &&
    left.brandPoweredBy === right.brandPoweredBy
  );
}

export function createSettingsDraft(source: AppSettings): AppSettings {
  return {
    upstreamBaseUrl: source.upstreamBaseUrl,
    publishedThemeId: source.publishedThemeId,
    pollEnabled: source.pollEnabled,
    pollIntervalMs: source.pollIntervalMs,
    autoRemoveBackgroundUploads: source.autoRemoveBackgroundUploads,
    reduceMotion: source.reduceMotion,
    updateCheckEnabled: source.updateCheckEnabled,
    updateCheckIntervalHours: source.updateCheckIntervalHours,
    updateAutoDownload: source.updateAutoDownload,
    brandName: source.brandName,
    brandLogoAssetId: source.brandLogoAssetId,
    brandPoweredBy: source.brandPoweredBy
  };
}
