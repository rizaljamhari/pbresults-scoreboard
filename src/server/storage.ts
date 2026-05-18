import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import mime from "mime-types";
import {
  appExportSchema,
  assetSchema,
  createThemeId,
  operationsStateSchema,
  settingsSchema,
  teamRegistryExportSchema,
  teamMatchResultSchema,
  teamRecordSchema,
  teamResolutionOverrideSchema,
  themeExportSchema,
  themeSchema,
  type AppExportPackage,
  type AppSettings,
  type OperationsState,
  type StoredAsset,
  type TeamMatchResult,
  type TeamRecord,
  type TeamResolutionOverride,
  type TeamRegistryExportPackage,
  type ThemeDefinition,
  type ThemeExportPackage
} from "../shared/theme.js";
import { createThemeExportPackage } from "../shared/exportTheme.js";
import { builtinThemes } from "../shared/builtinThemes.js";
import { defaultSettings } from "../shared/theme.js";
import { listExplicitTeamMatchNames, matchTeamName, normalizeTeamName } from "../shared/teamMatching.js";
import { removeImageBackground } from "./imageProcessing.js";
import { dataDir, uploadsDir } from "./runtimePaths.js";
const settingsPath = path.join(dataDir, "settings.json");
const themesPath = path.join(dataDir, "themes.json");
const assetsPath = path.join(dataDir, "assets.json");
const teamsPath = path.join(dataDir, "teams.json");
const operationsPath = path.join(dataDir, "operations.json");
const legacyDatabasePath = path.join(dataDir, "scoreboard.db");
const preferredBuiltinThemeId = "theme-7ad8adb8-e017-4853-93b1-fb608a750253";
const allowedBuiltinThemeIds = new Set([preferredBuiltinThemeId, "builtin-minimal-strip"]);
const defaultOperationsState: OperationsState = {
  overrides: []
};

type StoredAssetRecord = StoredAsset & { filePath: string };

type StoreAssetOptions = {
  attemptBackgroundRemoval?: boolean;
  role?: StoredAsset["role"];
  sourceAssetId?: string | null;
  hiddenFromPicker?: boolean;
  contentHash?: string | null;
};

export type UploadProcessingInfo = {
  status: "processed" | "skipped" | "failed";
  reason: string | null;
};

export type StoreAssetResult = {
  asset: StoredAsset;
  processing: UploadProcessingInfo;
};

type LiveMatchNameConflict = {
  kind: "reassignable" | "blocked";
  team: TeamRecord;
};

function createConflictError(
  message: string,
  code: string,
  conflict: LiveMatchNameConflict
): Error & {
  code: string;
  conflictTeamId: string;
  conflictTeamName: string;
  conflictType: LiveMatchNameConflict["kind"];
} {
  const error = new Error(message) as Error & {
    code: string;
    conflictTeamId: string;
    conflictTeamName: string;
    conflictType: LiveMatchNameConflict["kind"];
  };
  error.code = code;
  error.conflictTeamId = conflict.team.id;
  error.conflictTeamName = conflict.team.canonicalName;
  error.conflictType = conflict.kind;
  return error;
}

function computeContentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function findReusedAssetByHash(contentHash: string, mode: "any" | "processed-only"): StoredAsset | null {
  const parsed = readJson<StoredAssetRecord[]>(assetsPath, []).map((asset) => assetSchema.parse(asset));
  const source = parsed.find((asset) => asset.role === "original" && asset.contentHash === contentHash);
  const processed = source ? parsed.find((asset) => asset.role === "processed" && asset.sourceAssetId === source.id) : null;

  if (mode === "processed-only") {
    return processed ?? null;
  }

  if (processed) {
    return processed;
  }

  const visibleSameHash = parsed.find((asset) => asset.contentHash === contentHash && !asset.hiddenFromPicker);
  return visibleSameHash ?? source ?? null;
}

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
  if (theme.teamEventOverlay.concede.backgroundImageAssetId) {
    assetIds.add(theme.teamEventOverlay.concede.backgroundImageAssetId);
  }
  if (theme.teamEventOverlay.base.backgroundImageAssetId) {
    assetIds.add(theme.teamEventOverlay.base.backgroundImageAssetId);
  }
  return [...assetIds];
}

function collectTeamAssetIds(teams: TeamRecord[]): string[] {
  const assetIds = new Set<string>();
  for (const team of teams) {
    if (team.logoAssetId) {
      assetIds.add(team.logoAssetId);
    }
    if (team.alternateLogoAssetId) {
      assetIds.add(team.alternateLogoAssetId);
    }
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
  theme.teamEventOverlay.concede.backgroundImageAssetId = theme.teamEventOverlay.concede.backgroundImageAssetId
    ? (idMap.get(theme.teamEventOverlay.concede.backgroundImageAssetId) ?? null)
    : null;
  theme.teamEventOverlay.base.backgroundImageAssetId = theme.teamEventOverlay.base.backgroundImageAssetId
    ? (idMap.get(theme.teamEventOverlay.base.backgroundImageAssetId) ?? null)
    : null;
}

function withBuiltinThemes(themes: ThemeDefinition[]): ThemeDefinition[] {
  const parsedThemes = themes.map((theme) => themeSchema.parse(theme));
  const byId = new Map<string, ThemeDefinition>(parsedThemes.map((theme) => [theme.id, { ...theme, builtin: false }]));

  for (const builtinId of allowedBuiltinThemeIds) {
    const existing = parsedThemes.find((theme) => theme.id === builtinId);
    if (existing) {
      byId.set(existing.id, {
        ...existing,
        builtin: true
      });
      continue;
    }

    const fallback = builtinThemes.find((theme) => theme.id === builtinId);
    if (fallback) {
      byId.set(fallback.id, {
        ...fallback,
        builtin: true
      });
    }
  }

  return Array.from(byId.values());
}

function resolvePrimaryThemeId(themes: ThemeDefinition[]): string | null {
  const builtins = themes.filter((theme) => theme.builtin);
  const ids = new Set(themes.map((theme) => theme.id));
  if (ids.has(preferredBuiltinThemeId)) {
    return preferredBuiltinThemeId;
  }
  if (ids.has("builtin-minimal-strip")) {
    return "builtin-minimal-strip";
  }
  return builtins[0]?.id ?? themes[0]?.id ?? null;
}

function ensureStorageInitialized() {
  fs.mkdirSync(uploadsDir, { recursive: true });

  if (!fs.existsSync(settingsPath) && !fs.existsSync(themesPath) && !fs.existsSync(assetsPath) && !fs.existsSync(teamsPath)) {
    if (!tryMigrateLegacyDatabase()) {
      writeJson(settingsPath, defaultSettings);
      writeJson(themesPath, builtinThemes);
      writeJson(assetsPath, []);
      writeJson(teamsPath, []);
      writeJson(operationsPath, defaultOperationsState);
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

  if (!fs.existsSync(operationsPath)) {
    writeJson(operationsPath, defaultOperationsState);
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
  const themes = withBuiltinThemes(readJson<ThemeDefinition[]>(themesPath, []));
  const themeIds = new Set(themes.map((theme) => theme.id));
  if (settings.publishedThemeId && !themeIds.has(settings.publishedThemeId)) {
    const fallbackThemeId = resolvePrimaryThemeId(themes);
    const next = {
      ...settings,
      publishedThemeId: fallbackThemeId
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

export function getOperationsState(): OperationsState {
  return operationsStateSchema.parse(readJson(operationsPath, defaultOperationsState));
}

function writeOperationsState(next: OperationsState) {
  writeJson(operationsPath, operationsStateSchema.parse(next));
}

export function saveTeamResolutionOverride(rawInputName: string, teamId: string): TeamResolutionOverride {
  const team = getTeamRecord(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  if (!team.active) {
    throw new Error("Inactive teams cannot be used for live resolution");
  }
  const normalizedInputName = normalizeTeamName(rawInputName);
  if (!normalizedInputName) {
    throw new Error("Live team name is required");
  }
  const now = new Date().toISOString();
  const operations = getOperationsState();
  const existing = operations.overrides.find((override) => override.normalizedInputName === normalizedInputName);
  const nextOverride = teamResolutionOverrideSchema.parse({
    normalizedInputName,
    rawInputName: rawInputName.trim(),
    teamId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
  writeOperationsState({
    overrides: [...operations.overrides.filter((override) => override.normalizedInputName !== normalizedInputName), nextOverride]
  });
  return nextOverride;
}

export function clearTeamResolutionOverride(rawInputName: string) {
  const normalizedInputName = normalizeTeamName(rawInputName);
  if (!normalizedInputName) {
    return;
  }
  const operations = getOperationsState();
  writeOperationsState({
    overrides: operations.overrides.filter((override) => override.normalizedInputName !== normalizedInputName)
  });
}

export function getApplicableTeamResolutionOverrides(rawLeftName: string, rawRightName: string): {
  left: TeamRecord | null;
  right: TeamRecord | null;
} {
  const operations = getOperationsState();
  const overridesByName = new Map(operations.overrides.map((override) => [override.normalizedInputName, override.teamId]));
  const leftOverrideTeamId = overridesByName.get(normalizeTeamName(rawLeftName));
  const rightOverrideTeamId = overridesByName.get(normalizeTeamName(rawRightName));

  return {
    left: leftOverrideTeamId ? (() => {
      const team = getTeamRecord(leftOverrideTeamId);
      return team?.active ? team : null;
    })() : null,
    right: rightOverrideTeamId ? (() => {
      const team = getTeamRecord(rightOverrideTeamId);
      return team?.active ? team : null;
    })() : null
  };
}

export function getTeamRecord(id: string): TeamRecord | null {
  return listTeamRecords().find((team) => team.id === id) ?? null;
}

export function createTeamRecord(
  input?: Partial<Pick<TeamRecord, "canonicalName" | "scoreboardDisplayName" | "shortName" | "aliases" | "notes" | "active">>
): TeamRecord {
  const now = new Date().toISOString();
  const team = teamRecordSchema.parse({
    id: createThemeId("team"),
    canonicalName: input?.canonicalName?.trim() || "New Team",
    scoreboardDisplayName: input?.scoreboardDisplayName?.trim() || "",
    shortName: input?.shortName?.trim() || "",
    aliases: input?.aliases ?? [],
    liveMatchNames: [],
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

export function rememberTeamLiveMatchName(
  teamId: string,
  rawInputName: string,
  options?: { forceReassign?: boolean }
): { team: TeamRecord; reassignedFromTeam: TeamRecord | null } {
  const team = getTeamRecord(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  if (!team.active) {
    throw new Error("Inactive teams cannot be used for live resolution");
  }

  const raw = rawInputName.trim();
  const normalized = normalizeTeamName(raw);
  if (!normalized) {
    throw new Error("Live team name is required");
  }

  const teams = listTeamRecords();
  const conflict = teams.find((candidate) => {
    if (candidate.id === teamId) {
      return false;
    }
    const coreNames = [candidate.canonicalName, candidate.scoreboardDisplayName, candidate.shortName, ...candidate.aliases];
    if (coreNames.some((name) => normalizeTeamName(name) === normalized)) {
      return true;
    }
    return candidate.liveMatchNames.some((name) => normalizeTeamName(name) === normalized);
  });

  const existingNames = listExplicitTeamMatchNames(team).map((name) => normalizeTeamName(name));
  if (existingNames.includes(normalized)) {
    return { team, reassignedFromTeam: null };
  }

  let reassignedFromTeam: TeamRecord | null = null;
  if (conflict) {
    const isLearnedLiveName = conflict.liveMatchNames.some((name) => normalizeTeamName(name) === normalized);
    if (!isLearnedLiveName) {
      throw createConflictError(`"${raw}" is already used to match ${conflict.canonicalName}.`, "LIVE_MATCH_NAME_BLOCKED", {
        kind: "blocked",
        team: conflict
      });
    }
    if (!options?.forceReassign) {
      throw createConflictError(`"${raw}" is already remembered for ${conflict.canonicalName}.`, "LIVE_MATCH_NAME_REASSIGNABLE", {
        kind: "reassignable",
        team: conflict
      });
    }

    reassignedFromTeam = saveTeamRecord({
      ...conflict,
      liveMatchNames: conflict.liveMatchNames.filter((name) => normalizeTeamName(name) !== normalized)
    });
  }

  const next = saveTeamRecord({
    ...team,
    liveMatchNames: [...team.liveMatchNames, raw]
  });
  return { team: next, reassignedFromTeam };
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
): Promise<{ team: TeamRecord; asset: StoredAsset; processing: UploadProcessingInfo }> {
  const team = getTeamRecord(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const { asset, processing } = await storeAsset(buffer, originalName, mimeType);
  const updated = saveTeamRecord({
    ...team,
    logoAssetId: slot === "primary" ? asset.id : team.logoAssetId,
    alternateLogoAssetId: slot === "alternate" ? asset.id : team.alternateLogoAssetId
  });
  return { team: updated, asset, processing };
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
  if (!existing && next.builtin) {
    throw new Error("Built-in themes must originate from predefined templates");
  }
  const toSave = existing?.builtin ? { ...next, builtin: true } : next;
  if (index > -1) {
    themes[index] = toSave;
  } else {
    themes.push(toSave);
  }
  writeJson(themesPath, themes);
  return toSave;
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
    const fallbackThemeId = resolvePrimaryThemeId(listThemes().filter((theme) => theme.id !== id));
    updateSettings({ ...settings, publishedThemeId: fallbackThemeId });
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
    .map((asset) => assetSchema.parse(asset))
    .filter((asset) => !asset.hiddenFromPicker)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getAsset(id: string): StoredAssetRecord | null {
  const raw = readJson<StoredAssetRecord[]>(assetsPath, []).find((asset) => asset.id === id);
  if (!raw) {
    return null;
  }
  return {
    ...assetSchema.parse(raw),
    filePath: raw.filePath
  };
}

async function persistAssetRecord(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  options: StoreAssetOptions = {}
): Promise<StoredAssetRecord> {
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
    role: options.role ?? "processed",
    sourceAssetId: options.sourceAssetId ?? null,
    hiddenFromPicker: options.hiddenFromPicker ?? false,
    contentHash: options.contentHash ?? null,
    filePath
  };
  const assets = readJson<StoredAssetRecord[]>(assetsPath, []);
  assets.unshift(asset);
  writeJson(assetsPath, assets);
  return {
    ...assetSchema.parse(asset),
    filePath
  };
}

export async function storeAsset(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  options: StoreAssetOptions = {}
): Promise<StoreAssetResult> {
  const originalHash = options.contentHash ?? computeContentHash(buffer);
  const autoRemoveEnabled = options.attemptBackgroundRemoval ?? getSettings().autoRemoveBackgroundUploads;
  const reusedAsset = findReusedAssetByHash(originalHash, autoRemoveEnabled ? "processed-only" : "any");
  if (reusedAsset) {
    return {
      asset: reusedAsset,
      processing: {
        status: "skipped",
        reason: autoRemoveEnabled
          ? "Reused existing processed asset (matching original content hash)"
          : "Reused existing asset (matching content hash)"
      }
    };
  }

  if (autoRemoveEnabled) {
    const removal = await removeImageBackground(buffer, mimeType, originalName);
    if (removal.status === "processed") {
      const processedHash = computeContentHash(removal.buffer);
      const originalAsset = await persistAssetRecord(buffer, originalName, mimeType, {
        role: "original",
        hiddenFromPicker: true,
        sourceAssetId: null,
        contentHash: originalHash
      });
      const processedAsset = await persistAssetRecord(removal.buffer, removal.originalName, removal.mimeType, {
        role: "processed",
        hiddenFromPicker: false,
        sourceAssetId: originalAsset.id,
        contentHash: processedHash
      });
      return {
        asset: assetSchema.parse(processedAsset),
        processing: {
          status: "processed",
          reason: null
        }
      };
    }

    if (removal.status === "skipped") {
      console.info(`[asset-upload] background removal skipped: ${removal.reason}`);
    }

    if (removal.status === "failed") {
      // Keep uploads resilient: store original when background removal fails.
      console.warn(`[asset-upload] background removal failed: ${removal.reason}`);
    }

    const stored = await persistAssetRecord(buffer, originalName, mimeType, {
      role: options.role ?? "original",
      sourceAssetId: options.sourceAssetId,
      hiddenFromPicker: options.hiddenFromPicker,
      contentHash: originalHash
    });
    return {
      asset: assetSchema.parse(stored),
      processing: {
        status: removal.status,
        reason: removal.reason
      }
    };
  }

  const stored = await persistAssetRecord(buffer, originalName, mimeType, {
    role: options.role ?? "original",
    sourceAssetId: options.sourceAssetId,
    hiddenFromPicker: options.hiddenFromPicker,
    contentHash: originalHash
  });
  return {
    asset: assetSchema.parse(stored),
    processing: {
      status: "skipped",
      reason: options.attemptBackgroundRemoval === false ? "Background removal disabled for this operation" : "Background removal disabled in settings"
    }
  };
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
    const { asset } = await storeAsset(buffer, exportedAsset.asset.originalName, exportedAsset.asset.mimeType, {
      attemptBackgroundRemoval: false,
      role: exportedAsset.asset.role,
      sourceAssetId: exportedAsset.asset.sourceAssetId,
      hiddenFromPicker: exportedAsset.asset.hiddenFromPicker
    });
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

export async function exportTeamRegistryPackage(): Promise<TeamRegistryExportPackage> {
  const teams = listTeamRecords();
  const assets: Array<{ asset: StoredAsset; data: string }> = [];
  for (const assetId of collectTeamAssetIds(teams)) {
    const asset = getAsset(assetId);
    if (asset) {
      const file = await fsp.readFile(asset.filePath);
      assets.push({
        asset,
        data: `data:${asset.mimeType};base64,${file.toString("base64")}`
      });
    }
  }

  return teamRegistryExportSchema.parse({
    version: 1,
    exportedAt: new Date().toISOString(),
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
  const fallbackThemeId = resolvePrimaryThemeId(restoredThemes);
  const restoredSettings = settingsSchema.parse({
    ...parsed.settings,
    publishedThemeId: publishedThemeExists ? parsed.settings.publishedThemeId : fallbackThemeId
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

export async function importTeamRegistryPackage(pkg: TeamRegistryExportPackage): Promise<TeamRecord[]> {
  const parsed = teamRegistryExportSchema.parse(pkg);
  const idMap = new Map<string, string>();

  for (const item of parsed.assets) {
    const [, base64] = item.data.split(",", 2);
    const buffer = Buffer.from(base64, "base64");
    const { asset } = await storeAsset(buffer, item.asset.originalName, item.asset.mimeType, {
      attemptBackgroundRemoval: false,
      role: item.asset.role,
      sourceAssetId: item.asset.sourceAssetId,
      hiddenFromPicker: item.asset.hiddenFromPicker,
      contentHash: item.asset.contentHash
    });
    idMap.set(item.asset.id, asset.id);
  }

  const existingTeams = readJson<TeamRecord[]>(teamsPath, []).map((team) => teamRecordSchema.parse(team));
  const nextById = new Map(existingTeams.map((team) => [team.id, team]));

  for (const exportedTeam of parsed.teams) {
    const team = teamRecordSchema.parse(exportedTeam);
    nextById.set(team.id, {
      ...team,
      logoAssetId: team.logoAssetId ? (idMap.get(team.logoAssetId) ?? null) : null,
      alternateLogoAssetId: team.alternateLogoAssetId ? (idMap.get(team.alternateLogoAssetId) ?? null) : null,
      updatedAt: new Date().toISOString()
    });
  }

  const restoredTeams = Array.from(nextById.values()).sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
  writeJson(teamsPath, restoredTeams);
  return restoredTeams;
}
