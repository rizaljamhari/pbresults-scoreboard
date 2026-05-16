import type {
  AppExportPackage,
  AppSettings,
  NormalizedLiveState,
  StoredAsset,
  TeamMatchResult,
  TeamRecord,
  ThemeDefinition,
  ThemeExportPackage
} from "../shared/theme";

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  getSettings: () => fetch("/api/settings").then(handle<AppSettings>),
  updateSettings: (settings: AppSettings) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings)
    }).then(handle<AppSettings>),
  exportApp: () => fetch("/api/app/export").then(handle<AppExportPackage>),
  importApp: (payload: AppExportPackage) =>
    fetch("/api/app/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<{ settings: AppSettings; themes: ThemeDefinition[] }>),
  getTeams: () => fetch("/api/teams").then(handle<TeamRecord[]>),
  createTeam: (input?: Partial<Pick<TeamRecord, "canonicalName" | "shortName" | "aliases" | "notes" | "active">>) =>
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
    }).then(handle<{ team: TeamRecord; asset: StoredAsset }>);
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
    }).then(handle<StoredAsset>);
  },
  exportTheme: (id: string) => fetch(`/api/themes/${id}/export`).then(handle<ThemeExportPackage>),
  importTheme: (payload: ThemeExportPackage) =>
    fetch("/api/themes/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(handle<ThemeDefinition>)
};
