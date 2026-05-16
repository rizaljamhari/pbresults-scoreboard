import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import mime from "mime-types";
import {
  appExportSchema,
  assetSchema,
  createThemeId,
  settingsSchema,
  teamMatchResultSchema,
  teamRecordSchema,
  themeExportSchema,
  themeSchema,
  type AppExportPackage,
  type AppSettings,
  type StoredAsset,
  type TeamMatchResult,
  type TeamRecord,
  type ThemeDefinition,
  type ThemeExportPackage
} from "../shared/theme.js";
import { createThemeExportPackage } from "../shared/exportTheme.js";
import { builtinThemes } from "../shared/builtinThemes.js";
import { defaultSettings } from "../shared/theme.js";
import { matchTeamName } from "../shared/teamMatching.js";

const dataDir = path.resolve(process.cwd(), "data");
const uploadsDir = path.join(dataDir, "uploads");
const settingsPath = path.join(dataDir, "settings.json");
const themesPath = path.join(dataDir, "themes.json");
const assetsPath = path.join(dataDir, "assets.json");
const teamsPath = path.join(dataDir, "teams.json");
const legacyDatabasePath = path.join(dataDir, "scoreboard.db");

type StoredAssetRecord = StoredAsset & { filePath: string };

function collectThemeAssetIds(theme: ThemeDefinition): string[] {
  const assetIds = new Set<string>();
  for (const component of Object.values(theme.components)) {
    if (component.kind === "image" && component.assetId) {
      assetIds.add(component.assetId);
    }
    if (component.backgroundImageAssetId) {
      assetIds.add(component.backgroundImageAssetId);
    }
  }
  if (theme.concedeState.backgroundImageAssetId) {
    assetIds.add(theme.concedeState.backgroundImageAssetId);
  }
  return [...assetIds];
}

function remapThemeAssetIds(theme: ThemeDefinition, idMap: Map<string, string>) {
  for (const component of Object.values(theme.components)) {
    if (component.kind === "image") {
      component.assetId = component.assetId ? (idMap.get(component.assetId) ?? null) : null;
    }
    component.backgroundImageAssetId = component.backgroundImageAssetId
      ? (idMap.get(component.backgroundImageAssetId) ?? null)
      : null;
  }
  theme.concedeState.backgroundImageAssetId = theme.concedeState.backgroundImageAssetId
    ? (idMap.get(theme.concedeState.backgroundImageAssetId) ?? null)
    : null;
}

function withBuiltinThemes(themes: ThemeDefinition[]): ThemeDefinition[] {
  const byId = new Map(
    themes
      .map((theme) => themeSchema.parse(theme))
      .filter((theme) => !theme.builtin)
      .map((theme) => [theme.id, theme] as const)
  );
  for (const builtin of builtinThemes) {
    byId.set(builtin.id, builtin);
  }
  return Array.from(byId.values());
}

function ensureStorageInitialized() {
  fs.mkdirSync(uploadsDir, { recursive: true });

  if (!fs.existsSync(settingsPath) && !fs.existsSync(themesPath) && !fs.existsSync(assetsPath) && !fs.existsSync(teamsPath)) {
    if (!tryMigrateLegacyDatabase()) {
      writeJson(settingsPath, defaultSettings);
      writeJson(themesPath, builtinThemes);
      writeJson(assetsPath, []);
      writeJson(teamsPath, []);
    }
  }

  if (!fs.existsSync(settingsPath)) {
    writeJson(settingsPath, defaultSettings);
  }

  if (!fs.existsSync(themesPath)) {
    writeJson(themesPath, builtinThemes);
  }

  if (!fs.existsSync(assetsPath)) {
    writeJson(assetsPath, []);
  }

  if (!fs.existsSync(teamsPath)) {
    writeJson(teamsPath, []);
  }

  const themes = readJson<ThemeDefinition[]>(themesPath, []);
  const merged = withBuiltinThemes(themes);
  if (JSON.stringify(merged) !== JSON.stringify(themes)) {
    writeJson(themesPath, merged);
  }
}

function tryMigrateLegacyDatabase(): boolean {
  if (!fs.existsSync(legacyDatabasePath)) {
    return false;
  }

  try {
    const settingsRows = JSON.parse(execFileSync("sqlite3", ["-json", legacyDatabasePath, "SELECT key, value FROM settings"]).toString()) as Array<{
      key: string;
      value: string;
    }>;
    const themeRows = JSON.parse(
      execFileSync("sqlite3", ["-json", legacyDatabasePath, "SELECT data FROM themes ORDER BY builtin DESC, name ASC"]).toString()
    ) as Array<{ data: string }>;
    const assetRows = JSON.parse(
      execFileSync(
        "sqlite3",
        ["-json", legacyDatabasePath, "SELECT id, original_name, mime_type, url, file_path, created_at FROM assets ORDER BY created_at DESC"]
      ).toString()
    ) as Array<{
      id: string;
      original_name: string;
      mime_type: string;
      url: string;
      file_path: string;
      created_at: string;
    }>;

    const settingsRaw: Record<string, unknown> = {};
    for (const row of settingsRows) {
      settingsRaw[row.key] = JSON.parse(row.value);
    }

    const migratedSettings = settingsSchema.parse(settingsRaw);
    const migratedThemes = themeRows.map((row) => themeSchema.parse(JSON.parse(row.data)));
    const migratedAssets = assetRows.map((row) => ({
      ...assetSchema.parse({
        id: row.id,
        originalName: row.original_name,
        mimeType: row.mime_type,
        url: row.url,
        createdAt: row.created_at
      }),
      filePath: row.file_path
    }));

    writeJson(settingsPath, migratedSettings);
    writeJson(themesPath, migratedThemes);
    writeJson(assetsPath, migratedAssets);
    return true;
  } catch {
    return false;
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) {
    return fallback;
  }

  return JSON.parse(content) as T;
}

function writeJson(filePath: string, value: unknown) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

ensureStorageInitialized();

export function getSettings(): AppSettings {
  const settings = settingsSchema.parse(readJson(settingsPath, defaultSettings));
  const themeIds = new Set(withBuiltinThemes(readJson<ThemeDefinition[]>(themesPath, [])).map((theme) => theme.id));
  if (settings.publishedThemeId && !themeIds.has(settings.publishedThemeId)) {
    const next = {
      ...settings,
      publishedThemeId: "builtin-classic-chroma"
    };
    writeJson(settingsPath, next);
    return next;
  }
  return settings;
}

export function updateSettings(input: AppSettings): AppSettings {
  const next = settingsSchema.parse(input);
  writeJson(settingsPath, next);
  return next;
}

export function listThemes(): ThemeDefinition[] {
  return withBuiltinThemes(readJson<ThemeDefinition[]>(themesPath, []))
    .map((theme) => themeSchema.parse(theme))
    .sort((left, right) => {
      if (left.builtin !== right.builtin) {
        return left.builtin ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

export function listTeamRecords(): TeamRecord[] {
  return readJson<TeamRecord[]>(teamsPath, [])
    .map((team) => teamRecordSchema.parse(team))
    .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
}

export function getTeamRecord(id: string): TeamRecord | null {
  return listTeamRecords().find((team) => team.id === id) ?? null;
}

export function createTeamRecord(input?: Partial<Pick<TeamRecord, "canonicalName" | "shortName" | "aliases" | "notes" | "active">>): TeamRecord {
  const now = new Date().toISOString();
  const team = teamRecordSchema.parse({
    id: createThemeId("team"),
    canonicalName: input?.canonicalName?.trim() || "New Team",
    shortName: input?.shortName?.trim() || "",
    aliases: input?.aliases ?? [],
    logoAssetId: null,
    alternateLogoAssetId: null,
    notes: input?.notes ?? "",
    active: input?.active ?? true,
    createdAt: now,
    updatedAt: now
  });
  const teams = listTeamRecords();
  teams.push(team);
  writeJson(teamsPath, teams);
  return team;
}

export function saveTeamRecord(team: TeamRecord): TeamRecord {
  const existing = getTeamRecord(team.id);
  const next = teamRecordSchema.parse({
    ...team,
    createdAt: existing?.createdAt ?? team.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  const teams = listTeamRecords();
  const index = teams.findIndex((item) => item.id === next.id);
  if (index > -1) {
    teams[index] = next;
  } else {
    teams.push(next);
  }
  writeJson(teamsPath, teams);
  return next;
}

export function deleteTeamRecord(id: string): void {
  writeJson(
    teamsPath,
    listTeamRecords().filter((team) => team.id !== id)
  );
}

export async function attachTeamLogo(
  teamId: string,
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  slot: "primary" | "alternate" = "primary"
): Promise<{ team: TeamRecord; asset: StoredAsset }> {
  const team = getTeamRecord(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const asset = await storeAsset(buffer, originalName, mimeType);
  const updated = saveTeamRecord({
    ...team,
    logoAssetId: slot === "primary" ? asset.id : team.logoAssetId,
    alternateLogoAssetId: slot === "alternate" ? asset.id : team.alternateLogoAssetId
  });
  return { team: updated, asset };
}

export function matchTeamInput(inputName: string): TeamMatchResult {
  return teamMatchResultSchema.parse(matchTeamName(inputName, listTeamRecords()));
}

export function getTheme(id: string): ThemeDefinition | null {
  return listThemes().find((theme) => theme.id === id) ?? null;
}

export function createThemeFromClone(cloneFromId?: string, name?: string): ThemeDefinition {
  const source = cloneFromId ? getTheme(cloneFromId) : null;
  const base = source ?? listThemes()[0];
  const theme: ThemeDefinition = {
    ...base,
    id: createThemeId("theme"),
    builtin: false,
    name: name?.trim() || `${base.name} Copy`,
    description: base.description
  };
  const themes = listThemes();
  themes.push(themeSchema.parse(theme));
  writeJson(themesPath, themes);
  return theme;
}

export function saveTheme(theme: ThemeDefinition): ThemeDefinition {
  const next = themeSchema.parse(theme);
  const themes = listThemes();
  const index = themes.findIndex((item) => item.id === next.id);
  const existing = index > -1 ? themes[index] : null;
  if (existing?.builtin) {
    throw new Error("Built-in themes are read-only");
  }
  if (index > -1) {
    themes[index] = next;
  } else {
    themes.push(next);
  }
  writeJson(themesPath, themes);
  return next;
}

export function deleteTheme(id: string): void {
  const themes = listThemes();
  const existing = themes.find((theme) => theme.id === id);
  if (!existing) {
    return;
  }
  if (existing.builtin) {
    throw new Error("Built-in themes cannot be deleted");
  }
  writeJson(
    themesPath,
    themes.filter((theme) => theme.id !== id)
  );
  const settings = getSettings();
  if (settings.publishedThemeId === id) {
    updateSettings({ ...settings, publishedThemeId: "builtin-classic-chroma" });
  }
}

export function publishTheme(id: string): ThemeDefinition {
  const theme = getTheme(id);
  if (!theme) {
    throw new Error("Theme not found");
  }
  const settings = getSettings();
  updateSettings({ ...settings, publishedThemeId: id });
  return theme;
}

export function listAssets(): StoredAsset[] {
  return readJson<StoredAssetRecord[]>(assetsPath, [])
    .map((asset) =>
      assetSchema.parse({
        id: asset.id,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        url: asset.url,
        createdAt: asset.createdAt
      })
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getAsset(id: string): StoredAssetRecord | null {
  return readJson<StoredAssetRecord[]>(assetsPath, []).find((asset) => asset.id === id) ?? null;
}

export async function storeAsset(buffer: Buffer, originalName: string, mimeType: string): Promise<StoredAsset> {
  const extension = mime.extension(mimeType) || path.extname(originalName).replace(".", "") || "bin";
  const id = createThemeId("asset");
  const storedName = `${id}.${extension}`;
  const filePath = path.join(uploadsDir, storedName);
  await fsp.writeFile(filePath, buffer);
  const asset: StoredAssetRecord = {
    id,
    originalName,
    mimeType,
    url: `/uploads/${storedName}`,
    createdAt: new Date().toISOString(),
    filePath
  };
  const assets = readJson<StoredAssetRecord[]>(assetsPath, []);
  assets.unshift(asset);
  writeJson(assetsPath, assets);
  return assetSchema.parse(asset);
}

export async function exportThemePackage(id: string): Promise<ThemeExportPackage> {
  const theme = getTheme(id);
  if (!theme) {
    throw new Error("Theme not found");
  }
  const assets: Array<{ asset: StoredAsset; data: string }> = [];
  for (const assetId of collectThemeAssetIds(theme)) {
    const asset = getAsset(assetId);
    if (asset) {
      const file = await fsp.readFile(asset.filePath);
      assets.push({
        asset,
        data: `data:${asset.mimeType};base64,${file.toString("base64")}`
      });
    }
  }
  return themeExportSchema.parse(createThemeExportPackage(theme, assets));
}

export async function importThemePackage(pkg: ThemeExportPackage): Promise<ThemeDefinition> {
  const parsed = themeExportSchema.parse(pkg);
  const theme = structuredClone(parsed.theme);
  theme.id = createThemeId("theme");
  theme.builtin = false;
  const idMap = new Map<string, string>();
  for (const exportedAsset of parsed.assets) {
    const [, base64] = exportedAsset.data.split(",", 2);
    const buffer = Buffer.from(base64, "base64");
    const asset = await storeAsset(buffer, exportedAsset.asset.originalName, exportedAsset.asset.mimeType);
    idMap.set(exportedAsset.asset.id, asset.id);
  }
  remapThemeAssetIds(theme, idMap);

  return saveTheme(theme);
}

export async function exportAppPackage(): Promise<AppExportPackage> {
  const settings = getSettings();
  const themes = listThemes();
  const teams = listTeamRecords();
  const assets = await Promise.all(
    readJson<StoredAssetRecord[]>(assetsPath, []).map(async (asset) => {
      const file = await fsp.readFile(asset.filePath);
      return {
        asset: assetSchema.parse(asset),
        data: `data:${asset.mimeType};base64,${file.toString("base64")}`
      };
    })
  );

  return appExportSchema.parse({
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    themes,
    teams,
    assets
  });
}

export async function importAppPackage(pkg: AppExportPackage): Promise<{ settings: AppSettings; themes: ThemeDefinition[] }> {
  const parsed = appExportSchema.parse(pkg);
  const existingAssets = readJson<StoredAssetRecord[]>(assetsPath, []);

  await Promise.all(
    existingAssets.map(async (asset) => {
      try {
        await fsp.unlink(asset.filePath);
      } catch {
        // Ignore cleanup errors for missing files.
      }
    })
  );

  const restoredAssets: StoredAssetRecord[] = [];
  for (const item of parsed.assets) {
    const fileName = path.basename(item.asset.url);
    const filePath = path.join(uploadsDir, fileName);
    const [, base64] = item.data.split(",", 2);
    await fsp.writeFile(filePath, Buffer.from(base64, "base64"));
    restoredAssets.push({
      ...item.asset,
      filePath
    });
  }

  const restoredThemes = withBuiltinThemes(parsed.themes.map((theme) => themeSchema.parse(theme)));
  const restoredTeams = parsed.teams.map((team) => teamRecordSchema.parse(team));
  const publishedThemeExists = restoredThemes.some((theme) => theme.id === parsed.settings.publishedThemeId);
  const restoredSettings = settingsSchema.parse({
    ...parsed.settings,
    publishedThemeId: publishedThemeExists ? parsed.settings.publishedThemeId : "builtin-classic-chroma"
  });

  writeJson(settingsPath, restoredSettings);
  writeJson(themesPath, restoredThemes);
  writeJson(assetsPath, restoredAssets);
  writeJson(teamsPath, restoredTeams);

  return {
    settings: restoredSettings,
    themes: restoredThemes
  };
}
