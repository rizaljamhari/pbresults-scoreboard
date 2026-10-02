import type {
  AppExportV2Package,
  AppSettings,
  AssetCleanupReport,
  AssetCleanupRequest,
  AssetCleanupResult,
  AssetLibraryEntry,
  AssetUsage,
  NormalizedLiveState,
  OperatorTextOverride,
  OperatorTextState,
  OperationsState,
  StoredAsset,
  TeamMatchResult,
  TeamRecord,
  TeamRegistryExportPackage,
  TeamResolutionOverride,
  ThemeDefinition,
  ThemeExportPackage
} from "../shared/theme";
import type { UpdateStatus } from "../shared/update";
import type { BackupConfigInput, BackupPreview, BackupStatus } from "../shared/backup";
import type { OverlayReport, OverlayState } from "../shared/overlayHealth";
import type { RehearsalStatus } from "../shared/rehearsal";

type UploadProcessingInfo = {
  status: "processed" | "skipped" | "failed";
  reason: string | null;
};

export type UploadAssetResponse = {
  asset: StoredAsset;
  processing: UploadProcessingInfo;
};

export type DeleteAssetResponse = {
  deletedIds: string[];
  clearedThemeIds: string[];
  clearedTeamIds: string[];
  freedBytes: number;
};

export type UploadTeamLogoResponse = {
  team: TeamRecord;
  asset: StoredAsset;
  processing: UploadProcessingInfo;
};

export type RuntimeInfo = {
  preferredHost: string | null;
  preferredOrigin: string | null;
  appVersion: string;
  releaseTag: string | null;
};

export type ApiErrorPayload = {
  message?: string;
  code?: string;
  conflictTeamId?: string | null;
  conflictTeamName?: string | null;
  conflictType?: "reassignable" | "blocked" | null;
  usages?: AssetUsage[];
};

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload | null;

  constructor(message: string, status: number, payload: ApiErrorPayload | null) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let payload: ApiErrorPayload | null = null;
    let fallbackText = "";
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      fallbackText = await response.text();
    }
    throw new ApiError(payload?.message || fallbackText || `Request failed with ${response.status}`, response.status, payload);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  getSettings: () => fetch("/api/settings").then(handle<AppSettings>),
  getOperations: () => fetch("/api/operations").then(handle<OperationsState>),
  getOperatorTextFields: (signal?: AbortSignal) => fetch("/api/operations/text-fields", { signal }).then(handle<OperatorTextState>),
  updateOperatorText: (themeId: string, componentId: string, value: string) =>
    fetch(`/api/operations/text/${encodeURIComponent(themeId)}/${encodeURIComponent(componentId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value })
    }).then(handle<OperatorTextOverride>),
  resetOperatorText: (themeId: string, componentId: string) =>
    fetch(`/api/operations/text/${encodeURIComponent(themeId)}/${encodeURIComponent(componentId)}`, {
      method: "DELETE"
    }).then(handle<void>),
  resetAllOperatorText: (themeId: string) =>
    fetch(`/api/operations/text/${encodeURIComponent(themeId)}/reset`, {
      method: "POST"
    }).then(handle<void>),
  updateSettings: (settings: AppSettings) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings)
    }).then(handle<AppSettings>),
  /** Every overlay plays its entrance again. */
  playEntrance: () =>
    fetch("/api/overlay/entrance", {
      method: "POST"
    }).then(handle<{ token: number }>),
  startLivePolling: () =>
    fetch("/api/live/poll/start", {
      method: "POST"
    }).then(handle<AppSettings>),
  stopLivePolling: () =>
    fetch("/api/live/poll/stop", {
      method: "POST"
    }).then(handle<AppSettings>),
  refreshLivePolling: () =>
    fetch("/api/live/poll/refresh", {
      method: "POST"
    }).then(handle<{ ok: boolean }>),
  resolveLiveTeam: (payload: { teamId: string; rawInputName: string; remember?: boolean; forceReassign?: boolean }) =>
    fetch("/api/operations/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<{ override: TeamResolutionOverride; rememberedTeam: TeamRecord | null; reassignedFromTeam: TeamRecord | null }>),
  clearLiveTeamResolution: (side: "left" | "right", rawInputName: string) =>
    fetch(`/api/operations/resolve/${side}?rawInputName=${encodeURIComponent(rawInputName)}`, {
      method: "DELETE"
    }).then(handle<void>),
  exportApp: () => fetch("/api/app/export").then(handle<AppExportV2Package>),
  importApp: (payload: unknown) =>
    fetch("/api/app/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<{ settings: AppSettings; themes: ThemeDefinition[] }>),
  getBackups: () => fetch("/api/backups").then(handle<BackupStatus>),
  createBackup: () => fetch("/api/backups", { method: "POST" }).then(handle<BackupStatus>),
  inspectBackupPackage: (payload: unknown) =>
    fetch("/api/backups/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<BackupPreview>),
  inspectBackupFile: (file: string) =>
    fetch(`/api/backups/${encodeURIComponent(file)}/inspect`, { method: "POST" }).then(handle<BackupPreview>),
  restoreBackupFile: (file: string) =>
    fetch(`/api/backups/${encodeURIComponent(file)}/restore`, { method: "POST" }).then(
      handle<{ settings: AppSettings; themes: ThemeDefinition[] }>
    ),
  updateBackupConfig: (config: BackupConfigInput) =>
    fetch("/api/backups/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    }).then(handle<BackupStatus>),
  exportTeams: () => fetch("/api/teams/export").then(handle<TeamRegistryExportPackage>),
  importTeams: (payload: TeamRegistryExportPackage) =>
    fetch("/api/teams/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<TeamRecord[]>),
  getTeams: () => fetch("/api/teams").then(handle<TeamRecord[]>),
  createTeam: (input?: Partial<Pick<TeamRecord, "canonicalName" | "scoreboardDisplayName" | "shortName" | "aliases" | "notes" | "active">>) =>
    fetch("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? {})
    }).then(handle<TeamRecord>),
  getTeam: (id: string) => fetch(`/api/teams/${id}`).then(handle<TeamRecord>),
  saveTeam: (team: TeamRecord) =>
    fetch(`/api/teams/${team.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(team)
    }).then(handle<TeamRecord>),
  deleteTeam: (id: string) =>
    fetch(`/api/teams/${id}`, {
      method: "DELETE"
    }).then(handle<void>),
  uploadTeamLogo: (teamId: string, file: File, slot: "primary" | "alternate" = "primary") => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/teams/${teamId}/logo?slot=${slot}`, {
      method: "POST",
      body: form
    }).then(handle<UploadTeamLogoResponse>);
  },
  matchTeam: (inputName: string) =>
    fetch("/api/teams/match-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputName })
    }).then(handle<TeamMatchResult>),
  getRehearsal: (signal?: AbortSignal) => fetch("/api/rehearsal", { signal }).then(handle<RehearsalStatus>),
  rehearsal: (action: "start" | "go" | "mark" | "autoplay" | "stop" | "dismiss", body: Record<string, unknown> = {}) =>
    fetch(`/api/rehearsal/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(handle<RehearsalStatus>),
  getOverlayClients: (signal?: AbortSignal) => fetch("/api/overlay/clients", { signal }).then(handle<OverlayState>),
  /** Fire and forget: an overlay's report must never affect what it renders. */
  reportOverlay: (report: OverlayReport) => {
    const body = JSON.stringify(report);
    if (report.leaving && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/overlay/report", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/overlay/report", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  },
  getThemes: () => fetch("/api/themes").then(handle<ThemeDefinition[]>),
  createTheme: (cloneFromId?: string, name?: string) =>
    fetch("/api/themes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cloneFromId, name })
    }).then(handle<ThemeDefinition>),
  getTheme: (id: string) => fetch(`/api/themes/${id}`).then(handle<ThemeDefinition>),
  saveTheme: (theme: ThemeDefinition) =>
    fetch(`/api/themes/${theme.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(theme)
    }).then(handle<ThemeDefinition>),
  deleteTheme: (id: string) =>
    fetch(`/api/themes/${id}`, {
      method: "DELETE"
    }).then(handle<void>),
  archiveTheme: (id: string, archived: boolean) =>
    fetch(`/api/themes/${id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived })
    }).then(handle<ThemeDefinition>),
  publishTheme: (id: string) =>
    fetch(`/api/themes/${id}/publish`, {
      method: "POST"
    }).then(handle<ThemeDefinition>),
  getLive: (signal?: AbortSignal) => fetch("/api/live", { signal }).then(handle<NormalizedLiveState>),
  getRawLive: () => fetch("/api/live/raw").then(handle<unknown>),
  getRuntimeInfo: (signal?: AbortSignal) => fetch("/api/runtime-info", { signal }).then(handle<RuntimeInfo>),
  getUpdateStatus: () => fetch("/api/update/status").then(handle<UpdateStatus>),
  checkForUpdate: () => fetch("/api/update/check", { method: "POST" }).then(handle<UpdateStatus>),
  downloadUpdate: (version: string) =>
    fetch("/api/update/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version })
    }).then(handle<UpdateStatus>),
  installUpdate: (version: string) =>
    fetch("/api/update/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, confirmation: "INSTALL_AND_RESTART" })
    }).then(handle<UpdateStatus>),
  toggleSkipUpdate: (version: string) =>
    fetch("/api/update/skip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version })
    }).then(handle<UpdateStatus>),
  rollbackUpdate: () =>
    fetch("/api/update/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "ROLL_BACK_AND_RESTART" })
    }).then(handle<UpdateStatus>),
  dismissUpdateResult: () => fetch("/api/update/result/dismiss", { method: "POST" }).then(handle<UpdateStatus>),
  /** Keeps a named version of a theme (usually the editor's draft); returns the theme with its versions. */
  addThemeVersion: (themeId: string, name: string, theme: ThemeDefinition) =>
    fetch(`/api/themes/${encodeURIComponent(themeId)}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, theme })
    }).then(handle<ThemeDefinition>),
  deleteThemeVersion: (themeId: string, versionId: string) =>
    fetch(`/api/themes/${encodeURIComponent(themeId)}/versions/${encodeURIComponent(versionId)}`, { method: "DELETE" }).then(handle<ThemeDefinition>),
  getAssets: () => fetch("/api/assets").then(handle<StoredAsset[]>),
  uploadAsset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/assets", {
      method: "POST",
      body: form
    }).then(handle<UploadAssetResponse>);
  },
  getAssetLibrary: () => fetch("/api/assets/library").then(handle<AssetLibraryEntry[]>),
  renameAsset: (id: string, displayName: string | null) =>
    fetch(`/api/assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName })
    }).then(handle<StoredAsset>),
  replaceAssetFile: (id: string, file: File, removeBackground: boolean) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/assets/${encodeURIComponent(id)}/file?removeBackground=${removeBackground}`, {
      method: "PUT",
      body: form
    }).then(handle<UploadAssetResponse>);
  },
  revertAsset: (id: string) =>
    fetch(`/api/assets/${encodeURIComponent(id)}/revert`, { method: "POST" }).then(handle<StoredAsset>),
  reprocessAsset: (id: string) =>
    fetch(`/api/assets/${encodeURIComponent(id)}/reprocess`, { method: "POST" }).then(handle<UploadAssetResponse>),
  /** Rejects with an ApiError (status 409, payload.usages) when the asset is in use and not forced. */
  deleteAsset: (id: string, force = false) =>
    fetch(`/api/assets/${encodeURIComponent(id)}${force ? "?force=true" : ""}`, { method: "DELETE" }).then(
      handle<DeleteAssetResponse>
    ),
  getAssetCleanupReport: () => fetch("/api/assets/cleanup").then(handle<AssetCleanupReport>),
  runAssetCleanup: (request: AssetCleanupRequest) =>
    fetch("/api/assets/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    }).then(handle<AssetCleanupResult>),
  linkTeamLogo: (teamId: string, assetId: string | null, slot: "primary" | "alternate") =>
    fetch(`/api/teams/${teamId}/logo/asset`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId, slot })
    }).then(handle<TeamRecord>),
  exportTheme: (id: string) => fetch(`/api/themes/${id}/export`).then(handle<ThemeExportPackage>),
  importTheme: (payload: ThemeExportPackage) =>
    fetch("/api/themes/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<ThemeDefinition>)
};
