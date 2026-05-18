import type {
  AppExportPackage,
  AppSettings,
  NormalizedLiveState,
  OperationsState,
  StoredAsset,
  TeamMatchResult,
  TeamRecord,
  TeamRegistryExportPackage,
  TeamResolutionOverride,
  ThemeDefinition,
  ThemeExportPackage
} from "../shared/theme";

type UploadProcessingInfo = {
  status: "processed" | "skipped" | "failed";
  reason: string | null;
};

export type UploadAssetResponse = {
  asset: StoredAsset;
  processing: UploadProcessingInfo;
};

export type UploadTeamLogoResponse = {
  team: TeamRecord;
  asset: StoredAsset;
  processing: UploadProcessingInfo;
};

export type ApiErrorPayload = {
  message?: string;
  code?: string;
  conflictTeamId?: string | null;
  conflictTeamName?: string | null;
  conflictType?: "reassignable" | "blocked" | null;
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
  updateSettings: (settings: AppSettings) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings)
    }).then(handle<AppSettings>),
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
  exportApp: () => fetch("/api/app/export").then(handle<AppExportPackage>),
  importApp: (payload: AppExportPackage) =>
    fetch("/api/app/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<{ settings: AppSettings; themes: ThemeDefinition[] }>),
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
  publishTheme: (id: string) =>
    fetch(`/api/themes/${id}/publish`, {
      method: "POST"
    }).then(handle<ThemeDefinition>),
  getLive: () => fetch("/api/live").then(handle<NormalizedLiveState>),
  getRawLive: () => fetch("/api/live/raw").then(handle<unknown>),
  getAssets: () => fetch("/api/assets").then(handle<StoredAsset[]>),
  uploadAsset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/assets", {
      method: "POST",
      body: form
    }).then(handle<UploadAssetResponse>);
  },
  exportTheme: (id: string) => fetch(`/api/themes/${id}/export`).then(handle<ThemeExportPackage>),
  importTheme: (payload: ThemeExportPackage) =>
    fetch("/api/themes/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<ThemeDefinition>)
};
