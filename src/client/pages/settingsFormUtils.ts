import type { AppSettings } from "../../shared/theme";

export function areSettingsEqual(left: AppSettings, right: AppSettings): boolean {
  return (
    left.upstreamBaseUrl === right.upstreamBaseUrl &&
    left.publishedThemeId === right.publishedThemeId &&
    left.pollIntervalMs === right.pollIntervalMs
  );
}

export function createSettingsDraft(source: AppSettings): AppSettings {
  return {
    upstreamBaseUrl: source.upstreamBaseUrl,
    publishedThemeId: source.publishedThemeId,
    pollIntervalMs: source.pollIntervalMs
  };
}
