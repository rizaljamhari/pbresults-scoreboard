import { describe, expect, it } from "vitest";
import { areSettingsEqual, createSettingsDraft } from "./settingsFormUtils";

const sample = {
  upstreamBaseUrl: "http://127.0.0.1:5000",
  publishedThemeId: "theme-1",
  pollIntervalMs: 1000
};

describe("settingsFormUtils", () => {
  it("creates an independent draft copy", () => {
    const draft = createSettingsDraft(sample);
    expect(draft).toEqual(sample);
    expect(draft).not.toBe(sample);
  });

  it("compares settings equality by editable fields", () => {
    expect(areSettingsEqual(sample, createSettingsDraft(sample))).toBe(true);
    expect(
      areSettingsEqual(sample, {
        ...sample,
        pollIntervalMs: 1200
      })
    ).toBe(false);
  });
});
