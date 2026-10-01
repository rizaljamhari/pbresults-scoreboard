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
  operatorTextOverrideSchema,
  operatorTextStateSchema,
  settingsSchema,
  teamRegistryExportSchema,
  teamMatchResultSchema,
  teamRecordSchema,
  teamResolutionOverrideSchema,
  themeExportSchema,
  themeSchema,
  type AppExportPackage,
  type AppSettings,
  type AssetCleanupReport,
  type AssetCleanupRequest,
  type AssetCleanupResult,
  type AssetLibraryEntry,
  type AssetThemeUsageLocation,
  type AssetUsage,
  type OperationsState,
  type OperatorTextOverride,
  type OperatorTextState,
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
import { listOperatorTextComponents } from "../shared/themeComponents.js";
import { analyzeVisibleContent, removeImageBackground } from "./imageProcessing.js";
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
  overrides: [],
  operatorTextOverrides: []
};

type StoredAssetRecord = StoredAsset & { filePath: string };

type StoreAssetOptions = {
  attemptBackgroundRemoval?: boolean;
  role?: StoredAsset["role"];
  sourceAssetId?: string | null;
  hiddenFromPicker?: boolean;
  contentHash?: string | null;
  visibleContent?: StoredAsset["visibleContent"];
};

export type VisibleContentBackfillResult = {
  scanned: number;
  changedAssetIds: string[];
  trimmed: number;
  fullFrame: number;
  empty: number;
  unsupported: number;
  failed: number;
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

type AssetRef<Location> = {
  location: Location;
  assetId: string | null;
  set: (assetId: string | null) => void;
};

function themeAssetRefs(theme: ThemeDefinition): Array<AssetRef<AssetThemeUsageLocation>> {
  const refs: Array<AssetRef<AssetThemeUsageLocation>> = [];
  for (const [key, component] of Object.entries(theme.components) as Array<
    [keyof ThemeDefinition["components"], ThemeDefinition["components"][keyof ThemeDefinition["components"]]]
  >) {
    if (component.kind === "image") {
      refs.push({
        location: { type: "component", key },
        assetId: component.assetId,
        set: (assetId) => {
          component.assetId = assetId;
        }
      });
    }
    refs.push({
      location: { type: "surface", key, label: key },
      assetId: component.backgroundImageAssetId,
      set: (assetId) => {
        component.backgroundImageAssetId = assetId;
      }
    });
  }
  for (const component of theme.freeComponents) {
    if (component.kind === "image") {
      refs.push({
        location: { type: "free", id: component.id, label: component.label },
        assetId: component.assetId,
        set: (assetId) => {
          component.assetId = assetId;
        }
      });
    }
    refs.push({
      location: { type: "surface", key: component.id, label: component.label },
      assetId: component.backgroundImageAssetId,
      set: (assetId) => {
        component.backgroundImageAssetId = assetId;
      }
    });
  }
  for (const which of ["concede", "base", "winner"] as const) {
    const event = theme.teamEventOverlay[which];
    refs.push({
      location: { type: "eventOverlay", which },
      assetId: event.backgroundImageAssetId,
      set: (assetId) => {
        event.backgroundImageAssetId = assetId;
      }
    });
  }
  return refs.filter((ref) => ref.assetId !== null);
}

function teamAssetRefs(team: TeamRecord): Array<AssetRef<"primary" | "alternate">> {
  const refs: Array<AssetRef<"primary" | "alternate">> = [];
  if (team.logoAssetId) {
    refs.push({
      location: "primary",
      assetId: team.logoAssetId,
      set: (assetId) => {
        team.logoAssetId = assetId;
      }
    });
  }
  if (team.alternateLogoAssetId) {
    refs.push({
      location: "alternate",
      assetId: team.alternateLogoAssetId,
      set: (assetId) => {
        team.alternateLogoAssetId = assetId;
      }
    });
  }
  return refs;
}

function collectThemeAssetIds(theme: ThemeDefinition): string[] {
  return [...new Set(themeAssetRefs(theme).map((ref) => ref.assetId as string))];
}

function collectTeamAssetIds(teams: TeamRecord[]): string[] {
  return [...new Set(teams.flatMap((team) => teamAssetRefs(team).map((ref) => ref.assetId as string)))];
}

function remapThemeAssetIds(theme: ThemeDefinition, idMap: Map<string, string>) {
  for (const ref of themeAssetRefs(theme)) {
    ref.set(ref.assetId ? (idMap.get(ref.assetId) ?? null) : null);
  }
}

export function computeAssetUsageIndex(): Map<string, AssetUsage[]> {
  const index = new Map<string, AssetUsage[]>();
  const add = (assetId: string, usage: AssetUsage) => {
    const list = index.get(assetId);
    if (list) {
      list.push(usage);
    } else {
      index.set(assetId, [usage]);
    }
  };
  const publishedThemeId = getSettings().publishedThemeId;
  for (const theme of listThemes()) {
    for (const ref of themeAssetRefs(theme)) {
      add(ref.assetId as string, {
        kind: "theme",
        themeId: theme.id,
        themeName: theme.name,
        builtin: theme.builtin,
        published: theme.id === publishedThemeId,
        location: ref.location
      });
    }
  }
  for (const team of listTeamRecords()) {
    for (const ref of teamAssetRefs(team)) {
      add(ref.assetId as string, {
        kind: "team",
        teamId: team.id,
        teamName: team.canonicalName,
        slot: ref.location
      });
    }
  }
  return index;
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

export function validatePersistentStorage(): boolean {
  try {
    settingsSchema.parse(readJson(settingsPath, defaultSettings));
    zodParseThemes();
    listAssets();
    listTeamRecords();
    operationsStateSchema.parse(readJson(operationsPath, defaultOperationsState));
    return true;
  } catch {
    return false;
  }
}

function zodParseThemes() {
  return readJson<ThemeDefinition[]>(themesPath, []).map((theme) => themeSchema.parse(theme));
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

export function getOperatorTextState(): OperatorTextState {
  const publishedThemeId = getSettings().publishedThemeId;
  const theme = publishedThemeId ? getTheme(publishedThemeId) : null;
  if (!theme) {
    return operatorTextStateSchema.parse({ themeId: null, fields: [] });
  }

  const operations = getOperationsState();
  const overrides = new Map(
    operations.operatorTextOverrides
      .filter((override) => override.themeId === theme.id)
      .map((override) => [override.componentId, override])
  );
  const fields = listOperatorTextComponents(theme).map((component) => {
    const override = overrides.get(component.id);
    return {
      componentId: component.id,
      label: component.label,
      defaultValue: component.defaultText,
      value: override?.value ?? component.defaultText,
      hasOverride: Boolean(override),
      maxLength: component.maxLength,
      multiline: component.multiline,
      updatedAt: override?.updatedAt ?? null
    };
  });

  return operatorTextStateSchema.parse({ themeId: theme.id, fields });
}

export function saveOperatorTextOverride(themeId: string, componentId: string, inputValue: string): OperatorTextOverride {
  const settings = getSettings();
  if (settings.publishedThemeId !== themeId) {
    throw new Error("Published theme changed; reload the operator text controls");
  }
  const theme = getTheme(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }
  const component = listOperatorTextComponents(theme).find((candidate) => candidate.id === componentId);
  if (!component) {
    throw new Error("Operator text component not found");
  }

  const value = inputValue.replace(/\r\n?/g, "\n");
  if (!component.multiline && value.includes("\n")) {
    throw new Error("This operator text field only supports one line");
  }
  if (value.length > component.maxLength) {
    throw new Error(`Operator text must be ${component.maxLength} characters or fewer`);
  }

  const now = new Date().toISOString();
  const operations = getOperationsState();
  const existing = operations.operatorTextOverrides.find(
    (override) => override.themeId === themeId && override.componentId === componentId
  );
  const next = operatorTextOverrideSchema.parse({
    themeId,
    componentId,
    value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
  writeOperationsState({
    ...operations,
    operatorTextOverrides: [
      ...operations.operatorTextOverrides.filter(
        (override) => override.themeId !== themeId || override.componentId !== componentId
      ),
      next
    ]
  });
  return next;
}

export function clearOperatorTextOverride(themeId: string, componentId: string): void {
  if (getSettings().publishedThemeId !== themeId) {
    throw new Error("Published theme changed; reload the operator text controls");
  }
  const theme = getTheme(themeId);
  if (!theme || !listOperatorTextComponents(theme).some((component) => component.id === componentId)) {
    throw new Error("Operator text component not found");
  }
  const operations = getOperationsState();
  writeOperationsState({
    ...operations,
    operatorTextOverrides: operations.operatorTextOverrides.filter(
      (override) => override.themeId !== themeId || override.componentId !== componentId
    )
  });
}

export function clearAllOperatorTextOverrides(themeId: string): void {
  if (getSettings().publishedThemeId !== themeId) {
    throw new Error("Published theme changed; reload the operator text controls");
  }
  const operations = getOperationsState();
  writeOperationsState({
    ...operations,
    operatorTextOverrides: operations.operatorTextOverrides.filter((override) => override.themeId !== themeId)
  });
}

function pruneOperatorTextOverridesForTheme(theme: ThemeDefinition): void {
  const validComponents = new Map(listOperatorTextComponents(theme).map((component) => [component.id, component]));
  const operations = getOperationsState();
  const nextOverrides = operations.operatorTextOverrides.filter(
    (override) => {
      if (override.themeId !== theme.id) {
        return true;
      }
      const component = validComponents.get(override.componentId);
      return Boolean(
        component &&
          override.value.length <= component.maxLength &&
          (component.multiline || !override.value.includes("\n"))
      );
    }
  );
  if (nextOverrides.length !== operations.operatorTextOverrides.length) {
    writeOperationsState({ ...operations, operatorTextOverrides: nextOverrides });
  }
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
    ...operations,
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
    ...operations,
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
  pruneOperatorTextOverridesForTheme(toSave);
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
  const operations = getOperationsState();
  writeOperationsState({
    ...operations,
    operatorTextOverrides: operations.operatorTextOverrides.filter((override) => override.themeId !== id)
  });
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

function assetStoredName(id: string, originalName: string, mimeType: string): string {
  const extension = mime.extension(mimeType) || path.extname(originalName).replace(".", "") || "bin";
  return `${id}.${extension}`;
}

async function writeFileAtomic(filePath: string, buffer: Buffer) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, buffer);
  try {
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

async function persistAssetRecord(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  options: StoreAssetOptions = {}
): Promise<StoredAssetRecord> {
  const id = createThemeId("asset");
  const storedName = assetStoredName(id, originalName, mimeType);
  const filePath = path.join(uploadsDir, storedName);
  await writeFileAtomic(filePath, buffer);
  const reusableAnalysis =
    options.visibleContent && options.visibleContent.status !== "failed" ? options.visibleContent : null;
  const visibleContent = reusableAnalysis ?? (await analyzeVisibleContent(buffer, mimeType));
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
    visibleContent,
    displayName: null,
    updatedAt: null,
    byteSize: buffer.length,
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

function visibleContentNeedsAnalysis(asset: StoredAsset): boolean {
  return asset.visibleContent === null || asset.visibleContent.status === "failed";
}

function isFullFrameAnalysis(analysis: StoredAsset["visibleContent"]): boolean {
  return Boolean(
    analysis?.status === "ready" &&
      analysis.x === 0 &&
      analysis.y === 0 &&
      analysis.width === analysis.sourceWidth &&
      analysis.height === analysis.sourceHeight
  );
}

export async function backfillVisibleContentMetadata(): Promise<VisibleContentBackfillResult> {
  const snapshots = readJson<StoredAssetRecord[]>(assetsPath, [])
    .map((raw) => ({ ...assetSchema.parse(raw), filePath: raw.filePath }))
    .filter(visibleContentNeedsAnalysis);
  const result: VisibleContentBackfillResult = {
    scanned: snapshots.length,
    changedAssetIds: [],
    trimmed: 0,
    fullFrame: 0,
    empty: 0,
    unsupported: 0,
    failed: 0
  };

  for (const snapshot of snapshots) {
    let analysis: StoredAsset["visibleContent"];
    let analyzedContentHash: string;
    try {
      const buffer = await fsp.readFile(snapshot.filePath);
      analyzedContentHash = computeContentHash(buffer);
      analysis = await analyzeVisibleContent(buffer, snapshot.mimeType);
    } catch {
      result.failed += 1;
      continue;
    }

    const currentAssets = readJson<StoredAssetRecord[]>(assetsPath, []);
    const currentIndex = currentAssets.findIndex((asset) => asset.id === snapshot.id);
    const current = currentIndex >= 0 ? currentAssets[currentIndex] : null;
    if (
      !current ||
      current.filePath !== snapshot.filePath ||
      (snapshot.contentHash !== null && current.contentHash !== snapshot.contentHash)
    ) {
      continue;
    }

    try {
      const currentBuffer = await fsp.readFile(current.filePath);
      if (computeContentHash(currentBuffer) !== analyzedContentHash) {
        continue;
      }
    } catch {
      continue;
    }

    currentAssets[currentIndex] = { ...current, visibleContent: analysis };
    writeJson(assetsPath, currentAssets);
    result.changedAssetIds.push(snapshot.id);

    if (analysis.status === "ready") {
      if (isFullFrameAnalysis(analysis)) {
        result.fullFrame += 1;
      } else {
        result.trimmed += 1;
      }
    } else {
      result[analysis.status] += 1;
    }
  }

  return result;
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

// ---------------------------------------------------------------------------
// Asset library management
// ---------------------------------------------------------------------------

const RECENT_ASSET_WINDOW_MS = 24 * 60 * 60 * 1000;

export class AssetNotFoundError extends Error {
  readonly code = "asset_not_found";
  constructor(id: string) {
    super(`Asset not found: ${id}`);
  }
}

export class AssetInUseError extends Error {
  readonly code = "asset_in_use";
  constructor(readonly usages: AssetUsage[]) {
    super(`Asset is used in ${usages.length} place${usages.length === 1 ? "" : "s"}`);
  }
}

export class AssetOperationError extends Error {
  readonly code = "asset_operation_invalid";
}

function readAssetRecords(): StoredAssetRecord[] {
  return readJson<StoredAssetRecord[]>(assetsPath, []).map((raw) => ({ ...assetSchema.parse(raw), filePath: raw.filePath }));
}

function writeAssetRecords(records: StoredAssetRecord[]) {
  writeJson(assetsPath, records);
}

/** The file the overlay actually loads: `/uploads/<name>` resolves inside the current uploads folder. */
function resolveAssetFilePath(record: Pick<StoredAssetRecord, "url" | "filePath">): string {
  const servedName = path.basename(record.url.split("?")[0] ?? "");
  return servedName ? path.join(uploadsDir, servedName) : record.filePath;
}

function statFileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function requireAssetRecord(id: string): StoredAssetRecord {
  const record = readAssetRecords().find((asset) => asset.id === id);
  if (!record) {
    throw new AssetNotFoundError(id);
  }
  return record;
}

function updateAssetRecord(id: string, patch: Partial<StoredAssetRecord>): StoredAssetRecord {
  const records = readAssetRecords();
  const index = records.findIndex((asset) => asset.id === id);
  if (index < 0) {
    throw new AssetNotFoundError(id);
  }
  records[index] = { ...records[index], ...patch };
  writeAssetRecords(records);
  return records[index];
}

function toPublicAsset(record: StoredAssetRecord): StoredAsset {
  return assetSchema.parse(record);
}

/**
 * Writes new bytes into an existing asset id. The url keeps the id; only the
 * extension changes when the mime type does, in which case the old file goes.
 */
async function writeAssetBytesInPlace(
  record: StoredAssetRecord,
  buffer: Buffer,
  mimeType: string,
  patch: Partial<StoredAssetRecord> = {}
): Promise<StoredAssetRecord> {
  const previousFilePath = resolveAssetFilePath(record);
  const storedName = assetStoredName(record.id, patch.originalName ?? record.originalName, mimeType);
  const filePath = path.join(uploadsDir, storedName);
  await writeFileAtomic(filePath, buffer);
  if (previousFilePath !== filePath) {
    await fsp.rm(previousFilePath, { force: true });
  }
  const visibleContent = await analyzeVisibleContent(buffer, mimeType);
  return updateAssetRecord(record.id, {
    ...patch,
    mimeType,
    url: `/uploads/${storedName}`,
    filePath,
    contentHash: computeContentHash(buffer),
    visibleContent,
    byteSize: buffer.length,
    updatedAt: new Date().toISOString()
  });
}

async function removeAssetRecordAndFile(id: string): Promise<number> {
  const records = readAssetRecords();
  const record = records.find((asset) => asset.id === id);
  if (!record) {
    return 0;
  }
  const filePath = resolveAssetFilePath(record);
  const freed = statFileSize(filePath) ?? 0;
  writeAssetRecords(records.filter((asset) => asset.id !== id));
  await fsp.rm(filePath, { force: true });
  return freed;
}

/** Removes a hidden original once no other record derives from it and nothing references it directly. */
async function removeOriginalIfOrphaned(originalId: string | null, usageIndex = computeAssetUsageIndex()): Promise<number> {
  if (!originalId) {
    return 0;
  }
  const records = readAssetRecords();
  const original = records.find((asset) => asset.id === originalId);
  if (!original || !original.hiddenFromPicker) {
    return 0;
  }
  if (records.some((asset) => asset.sourceAssetId === originalId) || usageIndex.has(originalId)) {
    return 0;
  }
  return removeAssetRecordAndFile(originalId);
}

export function listAssetLibrary(): AssetLibraryEntry[] {
  const records = readAssetRecords();
  const byId = new Map(records.map((record) => [record.id, record]));
  const usageIndex = computeAssetUsageIndex();
  return records
    .filter((record) => !record.hiddenFromPicker)
    .map((record) => {
      const filePath = resolveAssetFilePath(record);
      const size = statFileSize(filePath);
      const source = record.sourceAssetId ? byId.get(record.sourceAssetId) ?? null : null;
      const sourceSize = source ? statFileSize(resolveAssetFilePath(source)) : null;
      const original = source && sourceSize !== null ? { id: source.id, url: source.url, byteSize: sourceSize } : null;
      return {
        ...toPublicAsset(record),
        byteSize: size ?? record.byteSize,
        usages: usageIndex.get(record.id) ?? [],
        original,
        backgroundRemoved: Boolean(original && source?.contentHash !== record.contentHash),
        fileMissing: size === null
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function renameAsset(id: string, displayName: string | null): StoredAsset {
  const trimmed = displayName?.trim() ?? "";
  const updated = updateAssetRecord(requireAssetRecord(id).id, {
    displayName: trimmed ? trimmed : null,
    updatedAt: new Date().toISOString()
  });
  return toPublicAsset(updated);
}

export async function replaceAssetFile(
  id: string,
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  options: { removeBackground?: boolean } = {}
): Promise<StoreAssetResult> {
  const record = requireAssetRecord(id);
  if (record.hiddenFromPicker) {
    throw new AssetOperationError("Hidden originals cannot be replaced directly");
  }
  const previousOriginalId = record.sourceAssetId;
  const removeBackground = options.removeBackground ?? getSettings().autoRemoveBackgroundUploads;

  let processing: UploadProcessingInfo = {
    status: "skipped",
    reason: removeBackground ? null : "Background removal not requested"
  };
  let updated: StoredAssetRecord;

  const removal = removeBackground ? await removeImageBackground(buffer, mimeType, originalName) : null;
  if (removal?.status === "processed") {
    const original = await persistAssetRecord(buffer, originalName, mimeType, {
      role: "original",
      hiddenFromPicker: true,
      sourceAssetId: null,
      contentHash: computeContentHash(buffer)
    });
    updated = await writeAssetBytesInPlace(record, removal.buffer, removal.mimeType, {
      originalName: removal.originalName,
      role: "processed",
      sourceAssetId: original.id
    });
    processing = { status: "processed", reason: null };
  } else {
    if (removal) {
      processing = { status: removal.status, reason: removal.reason };
    }
    updated = await writeAssetBytesInPlace(record, buffer, mimeType, {
      originalName,
      role: "original",
      sourceAssetId: null
    });
  }

  if (previousOriginalId && previousOriginalId !== updated.sourceAssetId) {
    await removeOriginalIfOrphaned(previousOriginalId);
  }
  return { asset: toPublicAsset(updated), processing };
}

export async function revertAssetToOriginal(id: string): Promise<StoredAsset> {
  const record = requireAssetRecord(id);
  const source = record.sourceAssetId ? readAssetRecords().find((asset) => asset.id === record.sourceAssetId) : null;
  if (!source) {
    throw new AssetOperationError("This asset has no stored original to revert to");
  }
  const buffer = await fsp.readFile(resolveAssetFilePath(source));
  const updated = await writeAssetBytesInPlace(record, buffer, source.mimeType, {
    originalName: source.originalName
  });
  return toPublicAsset(updated);
}

export async function reprocessAssetBackground(id: string): Promise<StoreAssetResult> {
  const record = requireAssetRecord(id);
  if (record.hiddenFromPicker) {
    throw new AssetOperationError("Hidden originals cannot be processed directly");
  }
  const existingSource = record.sourceAssetId ? readAssetRecords().find((asset) => asset.id === record.sourceAssetId) ?? null : null;
  const sourceRecord = existingSource ?? record;
  const sourceBuffer = await fsp.readFile(resolveAssetFilePath(sourceRecord));
  const removal = await removeImageBackground(sourceBuffer, sourceRecord.mimeType, sourceRecord.originalName);
  if (removal.status !== "processed") {
    return { asset: toPublicAsset(record), processing: { status: removal.status, reason: removal.reason } };
  }

  const sourceAssetId =
    existingSource?.id ??
    (
      await persistAssetRecord(sourceBuffer, record.originalName, record.mimeType, {
        role: "original",
        hiddenFromPicker: true,
        sourceAssetId: null,
        contentHash: computeContentHash(sourceBuffer)
      })
    ).id;
  const updated = await writeAssetBytesInPlace(requireAssetRecord(id), removal.buffer, removal.mimeType, {
    originalName: removal.originalName,
    role: "processed",
    sourceAssetId
  });
  return { asset: toPublicAsset(updated), processing: { status: "processed", reason: null } };
}

export type DeleteAssetResult = {
  deletedIds: string[];
  clearedThemeIds: string[];
  clearedTeamIds: string[];
  freedBytes: number;
};

function clearAssetReferences(assetId: string): { clearedThemeIds: string[]; clearedTeamIds: string[] } {
  const clearedThemeIds: string[] = [];
  for (const theme of listThemes()) {
    const refs = themeAssetRefs(theme).filter((ref) => ref.assetId === assetId);
    if (refs.length) {
      refs.forEach((ref) => ref.set(null));
      saveTheme(theme);
      clearedThemeIds.push(theme.id);
    }
  }
  const clearedTeamIds: string[] = [];
  for (const team of listTeamRecords()) {
    const refs = teamAssetRefs(team).filter((ref) => ref.assetId === assetId);
    if (refs.length) {
      refs.forEach((ref) => ref.set(null));
      saveTeamRecord(team);
      clearedTeamIds.push(team.id);
    }
  }
  return { clearedThemeIds, clearedTeamIds };
}

export async function deleteAsset(id: string, options: { force?: boolean } = {}): Promise<DeleteAssetResult> {
  const record = requireAssetRecord(id);
  const usages = computeAssetUsageIndex().get(id) ?? [];
  if (usages.length && !options.force) {
    throw new AssetInUseError(usages);
  }
  const cleared = usages.length ? clearAssetReferences(id) : { clearedThemeIds: [], clearedTeamIds: [] };
  const deletedIds = [id];
  let freedBytes = await removeAssetRecordAndFile(id);
  const freedOriginal = await removeOriginalIfOrphaned(record.sourceAssetId);
  if (record.sourceAssetId && !readAssetRecords().some((asset) => asset.id === record.sourceAssetId)) {
    deletedIds.push(record.sourceAssetId);
    freedBytes += freedOriginal;
  }
  return { deletedIds, ...cleared, freedBytes };
}

export function attachExistingTeamLogo(teamId: string, assetId: string | null, slot: "primary" | "alternate"): TeamRecord {
  const team = getTeamRecord(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  if (assetId) {
    const asset = requireAssetRecord(assetId);
    if (asset.hiddenFromPicker) {
      throw new AssetOperationError("Hidden originals cannot be used as a logo");
    }
  }
  return saveTeamRecord({
    ...team,
    logoAssetId: slot === "primary" ? assetId : team.logoAssetId,
    alternateLogoAssetId: slot === "alternate" ? assetId : team.alternateLogoAssetId
  });
}

function isStrayCandidate(fileName: string): boolean {
  return !fileName.startsWith(".") && !fileName.endsWith(".tmp");
}

export function getAssetCleanupReport(now = Date.now()): AssetCleanupReport {
  const records = readAssetRecords();
  const usageIndex = computeAssetUsageIndex();
  const derivedFrom = new Set(records.map((record) => record.sourceAssetId).filter((id): id is string => Boolean(id)));
  const toItem = (record: StoredAssetRecord, byteSize: number | null) => ({
    id: record.id,
    name: record.displayName ?? record.originalName,
    url: byteSize === null ? null : record.url,
    byteSize,
    createdAt: record.createdAt,
    recent: now - Date.parse(record.createdAt) < RECENT_ASSET_WINDOW_MS
  });

  const report: AssetCleanupReport = {
    unusedAssets: [],
    orphanOriginals: [],
    strayFiles: [],
    brokenRecords: [],
    reclaimableBytes: 0
  };

  const knownFiles = new Set<string>();
  for (const record of records) {
    const filePath = resolveAssetFilePath(record);
    knownFiles.add(path.basename(filePath));
    const size = statFileSize(filePath);
    const used = usageIndex.has(record.id);
    if (used) {
      continue;
    }
    if (size === null) {
      if (!derivedFrom.has(record.id)) {
        report.brokenRecords.push(toItem(record, null));
      }
      continue;
    }
    if (!record.hiddenFromPicker) {
      report.unusedAssets.push(toItem(record, size));
      report.reclaimableBytes += size;
    } else if (!derivedFrom.has(record.id)) {
      report.orphanOriginals.push(toItem(record, size));
      report.reclaimableBytes += size;
    }
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !isStrayCandidate(entry.name) || knownFiles.has(entry.name)) {
      continue;
    }
    const size = statFileSize(path.join(uploadsDir, entry.name)) ?? 0;
    report.strayFiles.push({ fileName: entry.name, byteSize: size });
    report.reclaimableBytes += size;
  }

  report.unusedAssets.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  return report;
}

export async function runAssetCleanup(request: AssetCleanupRequest): Promise<AssetCleanupResult & { deletedIds: string[] }> {
  const report = getAssetCleanupReport();
  const result: AssetCleanupResult & { deletedIds: string[] } = { deleted: 0, skipped: [], freedBytes: 0, deletedIds: [] };
  const unused = new Set(report.unusedAssets.map((item) => item.id));
  const orphans = new Set(report.orphanOriginals.map((item) => item.id));
  const broken = new Set(report.brokenRecords.map((item) => item.id));
  const stray = new Set(report.strayFiles.map((item) => item.fileName));

  for (const id of request.assetIds) {
    if (!unused.has(id)) {
      result.skipped.push({ id, reason: "No longer unused" });
      continue;
    }
    const removed = await deleteAsset(id);
    result.deleted += removed.deletedIds.length;
    result.deletedIds.push(...removed.deletedIds);
    result.freedBytes += removed.freedBytes;
  }
  for (const id of request.originalIds) {
    if (!orphans.has(id) || !readAssetRecords().some((asset) => asset.id === id)) {
      result.skipped.push({ id, reason: "No longer an orphaned original" });
      continue;
    }
    result.freedBytes += await removeAssetRecordAndFile(id);
    result.deleted += 1;
    result.deletedIds.push(id);
  }
  for (const id of request.brokenRecordIds) {
    if (!broken.has(id)) {
      result.skipped.push({ id, reason: "Record is no longer broken or is in use" });
      continue;
    }
    writeAssetRecords(readAssetRecords().filter((asset) => asset.id !== id));
    result.deleted += 1;
    result.deletedIds.push(id);
  }
  for (const fileName of request.strayFiles) {
    if (fileName !== path.basename(fileName) || !stray.has(fileName)) {
      result.skipped.push({ id: fileName, reason: "Not a stray upload" });
      continue;
    }
    const filePath = path.join(uploadsDir, fileName);
    result.freedBytes += statFileSize(filePath) ?? 0;
    await fsp.rm(filePath, { force: true });
    result.deleted += 1;
  }
  return result;
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
      hiddenFromPicker: exportedAsset.asset.hiddenFromPicker,
      contentHash: exportedAsset.asset.contentHash,
      visibleContent: exportedAsset.asset.visibleContent
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
  writeOperationsState({
    ...getOperationsState(),
    operatorTextOverrides: []
  });

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
      contentHash: item.asset.contentHash,
      visibleContent: item.asset.visibleContent
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
