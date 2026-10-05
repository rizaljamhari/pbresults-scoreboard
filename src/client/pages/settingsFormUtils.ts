import type { AppSettings } from "../../shared/theme";

/** The settings the Settings page edits. Everything else is changed elsewhere and must never be saved from here. */
export const settingsFormFields = [
  "upstreamBaseUrl",
  "pollIntervalMs",
  "autoRemoveBackgroundUploads",
  "brandName",
  "brandLogoAssetId",
  "brandPoweredBy"
] as const satisfies ReadonlyArray<keyof AppSettings>;

export type SettingsDraft = Pick<AppSettings, (typeof settingsFormFields)[number]>;

export function areSettingsEqual(left: SettingsDraft, right: SettingsDraft): boolean {
  return settingsFormFields.every((field) => left[field] === right[field]);
}

export function createSettingsDraft(source: SettingsDraft): SettingsDraft {
  return Object.fromEntries(settingsFormFields.map((field) => [field, source[field]])) as SettingsDraft;
}

/** The draft on top of the latest saved settings, so a save never undoes a change made on another page. */
export function applySettingsDraft(latest: AppSettings, draft: SettingsDraft): AppSettings {
  return { ...latest, ...createSettingsDraft(draft) };
}

export const POLL_INTERVAL_MIN_MS = 100;
export const POLL_INTERVAL_MAX_MS = 10000;

export function pollIntervalError(value: number): string | null {
  if (!Number.isInteger(value) || value < POLL_INTERVAL_MIN_MS || value > POLL_INTERVAL_MAX_MS) {
    return `Use a whole number from ${POLL_INTERVAL_MIN_MS} to ${POLL_INTERVAL_MAX_MS} ms.`;
  }
  return null;
}
