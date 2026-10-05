import { describe, expect, it } from "vitest";
import { applySettingsDraft, areSettingsEqual, createSettingsDraft, pollIntervalError } from "./settingsFormUtils";
import type { AppSettings } from "../../shared/theme";

const sample: AppSettings = {
  upstreamBaseUrl: "http://127.0.0.1:5000",
  publishedThemeId: "theme-1",
  pollEnabled: true,
  pollIntervalMs: 1000,
  autoRemoveBackgroundUploads: true,
  reduceMotion: false,
  updateCheckEnabled: true,
  updateCheckIntervalHours: 6,
  updateAutoDownload: false,
  brandName: "",
  brandLogoAssetId: null,
  brandPoweredBy: true
};

describe("settingsFormUtils", () => {
  it("drafts only the fields the Settings page edits", () => {
    expect(createSettingsDraft(sample)).toEqual({
      upstreamBaseUrl: "http://127.0.0.1:5000",
      pollIntervalMs: 1000,
      autoRemoveBackgroundUploads: true,
      brandName: "",
      brandLogoAssetId: null,
      brandPoweredBy: true
    });
  });

  it("compares the edited fields and ignores changes made on other pages", () => {
    expect(areSettingsEqual(sample, createSettingsDraft(sample))).toBe(true);
    expect(areSettingsEqual(sample, { ...sample, pollIntervalMs: 1200 })).toBe(false);
    expect(areSettingsEqual(sample, { ...sample, autoRemoveBackgroundUploads: false })).toBe(false);
    expect(areSettingsEqual(sample, { ...sample, brandName: "Media Crew" })).toBe(false);
    expect(areSettingsEqual(sample, { ...sample, brandLogoAssetId: "asset-1" })).toBe(false);
    expect(areSettingsEqual(sample, { ...sample, brandPoweredBy: false })).toBe(false);
    const changedElsewhere: AppSettings = { ...sample, publishedThemeId: "theme-2", pollEnabled: false, updateAutoDownload: true };
    expect(areSettingsEqual(sample, changedElsewhere)).toBe(true);
  });

  it("saves the draft on top of the latest settings", () => {
    const latest = { ...sample, publishedThemeId: "theme-2", pollEnabled: false };
    const saved = applySettingsDraft(latest, { ...createSettingsDraft(sample), brandName: "Media Crew" });
    expect(saved).toEqual({ ...latest, brandName: "Media Crew" });
  });

  it("checks the feed interval range", () => {
    expect(pollIntervalError(500)).toBeNull();
    expect(pollIntervalError(0)).not.toBeNull();
    expect(pollIntervalError(10001)).not.toBeNull();
    expect(pollIntervalError(250.5)).not.toBeNull();
  });
});
