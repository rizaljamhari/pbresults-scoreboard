import type { BackupReason } from "./theme.js";

export type BackupPreview = {
  version: 1 | 2;
  appVersion: string | null;
  createdAt: string;
  reason: BackupReason | null;
  counts: {
    themes: number;
    teams: number;
    assets: number;
    teamResolutionOverrides: number | null;
    operatorTextOverrides: number | null;
  };
  totalAssetBytes: number;
  warnings: string[];
};

export type BackupEntry = {
  file: string;
  reason: BackupReason;
  createdAt: string;
  sizeBytes: number;
  automatic: boolean;
};

export type BackupRunResult = {
  at: string;
  reason: BackupReason;
  durationMs: number;
  sizeBytes: number | null;
  file: string | null;
  extraCopy: "ok" | "failed" | "skipped";
  extraCopyError: string | null;
  error: string | null;
};

export type BackupStatus = {
  backupsDir: string;
  extraFolder: string | null;
  retainAutomatic: number;
  lastSuccess: BackupRunResult | null;
  lastFailure: BackupRunResult | null;
  busy: boolean;
  backups: BackupEntry[];
};

export type BackupConfigInput = {
  extraFolder: string | null;
  retainAutomatic: number;
};

export const automaticBackupReasons: ReadonlySet<BackupReason> = new Set(["startup", "shutdown", "pre-restore", "pre-import"]);
