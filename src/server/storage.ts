import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import mime from "mime-types";
import {
  anyAppExportSchema,
  appExportV2Schema,
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
  type AnyAppExportPackage,
  type AppExportV2Package,
  type AppSettings,
  type AssetCleanupReport,
  type AssetCleanupRequest,
  type AssetCleanupResult,
  type AssetLibraryEntry,
  type AssetThemeUsageLocation,
  type AssetUsage,
  type BackupReason,
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
import type { BackupPreview } from "../shared/backup.js";
import { runtimeBuild } from "./buildInfo.js";
import { dataDir, isPathInside, uploadsDir } from "./runtimePaths.js";
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
  // Images and fonts a named version uses stay in use, so cleanup never breaks a version.
  for (const version of theme.versions) {
    const snapshot = themeSchema.safeParse({ ...version.theme, versions: [] });
    if (!snapshot.success) continue;
    for (const ref of themeAssetRefs(snapshot.data)) {
      refs.push({
        location: { type: "version", name: version.name },
        assetId: ref.assetId,
        set: (assetId) => {
          ref.set(assetId);
          version.theme = versionContent(snapshot.data);
        }
      });
    }
  }
  for (const font of theme.fonts) {
    refs.push({
      location: { type: "font", family: font.family },
      assetId: font.assetId,
      set: (assetId) => {
        if (assetId) font.assetId = assetId;
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
  for (const which of ["timeout", "gameFinished"] as const) {
    const card = theme.momentOverlays[which];
    refs.push({
      location: { type: "momentOverlay", which },
      assetId: card.backgroundImageAssetId,
      set: (assetId) => {
        card.backgroundImageAssetId = assetId;
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
  writeFileDurably(filePath, JSON.stringify(value, null, 2));
}

/** Write through a flushed temp file and rename, so a crash leaves either the old or the new content. */
function writeFileDurably(filePath: string, content: string) {
  const tempPath = `${filePath}.tmp`;
  const fd = fs.openSync(tempPath, "w");
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
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

/**
 * A name no other theme uses: "Broadcast Logos" becomes "Broadcast Logos 2", then 3, and a copy of a copy
 * counts on from the same stem instead of piling up "Copy Copy".
 */
export function uniqueThemeName(wanted: string, takenNames: string[]): string {
  const taken = new Set(takenNames.map((name) => name.trim().toLowerCase()));
  const trimmed = wanted.trim();
  if (!taken.has(trimmed.toLowerCase())) {
    return trimmed;
  }
  const stem = trimmed.replace(/(\s+copy)+$/i, "").replace(/\s+\d+$/, "").trim() || trimmed;
  for (let number = 2; ; number += 1) {
    const candidate = `${stem} ${number}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

export function createThemeFromClone(cloneFromId?: string, name?: string): ThemeDefinition {
  const source = cloneFromId ? getTheme(cloneFromId) : null;
  const base = source ?? listThemes()[0];
  const themes = listThemes();
  const theme: ThemeDefinition = {
    ...base,
    id: createThemeId("theme"),
    builtin: false,
    archived: false,
    updatedAt: new Date().toISOString(),
    name: uniqueThemeName(name?.trim() || base.name, themes.map((item) => item.name)),
    description: base.description
  };
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
  // Versions change only through their own calls, so an editor holding an older list never drops one.
  const withVersions = existing ? { ...next, versions: existing.versions } : next;
  const toSave = { ...(existing?.builtin ? { ...withVersions, builtin: true } : withVersions), updatedAt: new Date().toISOString() };
  if (index > -1) {
    themes[index] = toSave;
  } else {
    themes.push(toSave);
  }
  writeJson(themesPath, themes);
  pruneOperatorTextOverridesForTheme(toSave);
  return toSave;
}

export const MAX_THEME_VERSIONS = 10;

/** A theme's settings without its identity-free extras, as stored in a version. */
function versionContent(theme: ThemeDefinition): Record<string, unknown> {
  const { versions: _versions, updatedAt: _updatedAt, ...content } = theme;
  return content;
}

/**
 * Keeps a named snapshot of `snapshot` (usually the editor's current draft) on the theme, newest first; past the
 * limit the oldest is dropped. Not an edit: the theme's settings and last-edited time stay as they are.
 */
export function addThemeVersion(id: string, name: string, snapshot: unknown): ThemeDefinition {
  const themes = listThemes();
  const index = themes.findIndex((theme) => theme.id === id);
  if (index === -1) {
    throw new Error("Theme not found");
  }
  const theme = themes[index];
  if (theme.builtin) {
    throw new Error("Built-in themes can't keep versions. Save a copy first.");
  }
  const parsed = themeSchema.parse({ ...(snapshot as Record<string, unknown>), id, versions: [] });
  const version = { id: createThemeId("version"), name: name.trim().slice(0, 60), savedAt: new Date().toISOString(), theme: versionContent(parsed) };
  themes[index] = { ...theme, versions: [version, ...theme.versions].slice(0, MAX_THEME_VERSIONS) };
  writeJson(themesPath, themes);
  return themes[index];
}

export function deleteThemeVersion(id: string, versionId: string): ThemeDefinition {
  const themes = listThemes();
  const index = themes.findIndex((theme) => theme.id === id);
  if (index === -1) {
    throw new Error("Theme not found");
  }
  themes[index] = { ...themes[index], versions: themes[index].versions.filter((version) => version.id !== versionId) };
  writeJson(themesPath, themes);
  return themes[index];
}

/** Hides or restores a theme in the list. Not an edit, so the theme's last-edited time stays as it was. */
export function setThemeArchived(id: string, archived: boolean): ThemeDefinition {
  const themes = listThemes();
  const index = themes.findIndex((theme) => theme.id === id);
  if (index === -1) {
    throw new Error("Theme not found");
  }
  if (archived && themes[index].builtin) {
    throw new Error("Built-in themes cannot be archived");
  }
  if (archived && getSettings().publishedThemeId === id) {
    throw new Error("The theme on air cannot be archived");
  }
  themes[index] = { ...themes[index], archived };
  writeJson(themesPath, themes);
  return themes[index];
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
  // A theme going on air is in use again, so it comes back from the archive.
  const onAir = theme.archived ? setThemeArchived(id, false) : theme;
  const settings = getSettings();
  updateSettings({ ...settings, publishedThemeId: id });
  return onAir;
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
  // Fonts have no pixels to analyse.
  const visibleContent =
    reusableAnalysis ?? (mimeType.startsWith("font/") ? ({ analyzerVersion: 1, status: "unsupported" } as const) : await analyzeVisibleContent(buffer, mimeType));
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

function sectionChecksum(value: unknown): string {
  return computeContentHash(Buffer.from(JSON.stringify(value) ?? "null", "utf8"));
}

function resolveStoredAssetPath(asset: StoredAssetRecord): string {
  if (asset.filePath && fs.existsSync(asset.filePath)) {
    return asset.filePath;
  }
  return path.join(uploadsDir, path.basename(asset.url));
}

export type AppPackageBuildResult = {
  pkg: AppExportV2Package;
  missingAssetIds: string[];
};

/** Build a v2 package. The JSON documents are read together, before any asset file, so the sections agree with each other. */
export async function buildAppPackage(reason: BackupReason, exportedAt = new Date().toISOString()): Promise<AppPackageBuildResult> {
  const settings = getSettings();
  const themes = listThemes();
  const teams = listTeamRecords();
  const operations = getOperationsState();
  const assetRecords = readJson<StoredAssetRecord[]>(assetsPath, []);
  const missingAssetIds: string[] = [];
  const assets: AppExportV2Package["assets"] = [];

  for (const asset of assetRecords) {
    let file: Buffer;
    try {
      file = await fsp.readFile(resolveStoredAssetPath(asset));
    } catch {
      missingAssetIds.push(asset.id);
      continue;
    }
    assets.push({
      asset: assetSchema.parse(asset),
      data: `data:${asset.mimeType};base64,${file.toString("base64")}`,
      sha256: computeContentHash(file),
      size: file.length
    });
  }

  const pkg = appExportV2Schema.parse({
    version: 2,
    exportedAt,
    appVersion: runtimeBuild.info.appVersion,
    reason,
    settings,
    themes,
    teams,
    operations,
    assets,
    checksums: {
      settings: sectionChecksum(settings),
      themes: sectionChecksum(themes),
      teams: sectionChecksum(teams),
      operations: sectionChecksum(operations)
    }
  });
  return { pkg, missingAssetIds };
}

export async function exportAppPackage(reason: BackupReason = "export"): Promise<AppExportV2Package> {
  return (await buildAppPackage(reason)).pkg;
}

/** A cheap identity of the stored data, used to skip automatic backups when nothing changed. */
export function computeDataFingerprint(): string {
  const hash = createHash("sha256");
  for (const filePath of [settingsPath, themesPath, assetsPath, teamsPath, operationsPath]) {
    hash.update(path.basename(filePath));
    hash.update("\0");
    hash.update(fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0));
    hash.update("\0");
  }
  const uploads = fs.existsSync(uploadsDir)
    ? fs
        .readdirSync(uploadsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
        .map((entry) => `${entry.name}:${fs.statSync(path.join(uploadsDir, entry.name)).size}`)
        .sort()
    : [];
  hash.update(uploads.join("\n"));
  return hash.digest("hex");
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

type DecodedAsset = {
  asset: StoredAsset;
  fileName: string;
  buffer: Buffer;
};

export type ValidatedAppPackage = {
  pkg: AnyAppExportPackage;
  assets: DecodedAsset[];
  preview: BackupPreview;
};

const safeUploadNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function decodeDataUrl(data: string, label: string): Buffer {
  const match = /^data:[^,;]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(data);
  if (!match) {
    throw new Error(`${label} is not valid base64 image data.`);
  }
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.toString("base64") !== match[1]) {
    throw new Error(`${label} is not valid base64 image data.`);
  }
  return buffer;
}

function sectionOf(raw: unknown, key: string): unknown {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
}

/**
 * Fully check a backup without touching live data: schema, every checksum, every asset decode and the references
 * between themes, teams and assets. Throws on anything that would make a restore unsafe; returns warnings otherwise.
 */
export function validateAppPackage(raw: unknown): ValidatedAppPackage {
  const parsed = anyAppExportSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`This file is not a scoreboard backup (${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"}).`);
  }
  const pkg = parsed.data;
  const warnings: string[] = [];

  if (pkg.version === 2) {
    for (const key of ["settings", "themes", "teams", "operations"] as const) {
      if (sectionChecksum(sectionOf(raw, key)) !== pkg.checksums[key]) {
        throw new Error(`The backup's ${key} section is damaged (checksum mismatch).`);
      }
    }
  }

  const assets: DecodedAsset[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const item of pkg.assets) {
    const label = `Logo "${item.asset.originalName}"`;
    const fileName = path.basename(item.asset.url);
    if (!safeUploadNamePattern.test(fileName) || seenNames.has(fileName) || seenIds.has(item.asset.id)) {
      throw new Error(`${label} has an unsafe or duplicate file name.`);
    }
    seenIds.add(item.asset.id);
    seenNames.add(fileName);
    const buffer = decodeDataUrl(item.data, label);
    if ("sha256" in item && (buffer.length !== item.size || computeContentHash(buffer) !== item.sha256)) {
      throw new Error(`${label} is damaged (checksum mismatch).`);
    }
    assets.push({ asset: item.asset, fileName, buffer });
  }

  const missingReferences = new Set<string>();
  for (const theme of pkg.themes) {
    for (const assetId of collectThemeAssetIds(theme)) {
      if (!seenIds.has(assetId)) missingReferences.add(assetId);
    }
  }
  for (const assetId of collectTeamAssetIds(pkg.teams)) {
    if (!seenIds.has(assetId)) missingReferences.add(assetId);
  }
  if (missingReferences.size > 0) {
    warnings.push(`${missingReferences.size} image reference(s) point to logos that are not in the backup; they will show empty.`);
  }
  if (pkg.settings.publishedThemeId && !pkg.themes.some((theme) => theme.id === pkg.settings.publishedThemeId)) {
    warnings.push("The published theme is not in the backup; a built-in theme will be published instead.");
  }
  if (pkg.version === 1) {
    warnings.push("This is an older backup without operations state; current team-resolution overrides are kept and operator text is reset.");
  } else if (pkg.appVersion !== runtimeBuild.info.appVersion) {
    warnings.push(`Created by version ${pkg.appVersion}; this is version ${runtimeBuild.info.appVersion}.`);
  }

  return {
    pkg,
    assets,
    preview: {
      version: pkg.version,
      appVersion: pkg.version === 2 ? pkg.appVersion : null,
      createdAt: pkg.exportedAt,
      reason: pkg.version === 2 ? pkg.reason : null,
      counts: {
        themes: pkg.themes.length,
        teams: pkg.teams.length,
        assets: pkg.assets.length,
        teamResolutionOverrides: pkg.version === 2 ? pkg.operations.overrides.length : null,
        operatorTextOverrides: pkg.version === 2 ? pkg.operations.operatorTextOverrides.length : null
      },
      totalAssetBytes: assets.reduce((total, item) => total + item.buffer.length, 0),
      warnings
    }
  };
}

type RestoreFaultPoint = "staged" | "files-committed" | "documents-partial";
let restoreFaultInjector: ((point: RestoreFaultPoint) => void) | null = null;

/** Test hook: throw at a named point of the restore transaction. */
export function setRestoreFaultInjectorForTests(injector: typeof restoreFaultInjector) {
  restoreFaultInjector = injector;
}

function readFileOrNull(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function restoreFileContent(filePath: string, content: string | null) {
  if (content === null) {
    fs.rmSync(filePath, { force: true });
  } else {
    writeFileDurably(filePath, content);
  }
}

/** Remove staging folders left behind by a restore that was interrupted by a crash or power loss. */
export function cleanupInterruptedRestores() {
  if (!fs.existsSync(uploadsDir)) return;
  for (const entry of fs.readdirSync(uploadsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(".restore-")) {
      fs.rmSync(path.join(uploadsDir, entry.name), { recursive: true, force: true });
    }
  }
}

/**
 * Restore a v1 or v2 package as one transaction. Nothing live changes until the whole package has validated and
 * every logo is staged; a failure while committing puts back the previous documents and removes only the files this
 * restore added. Old logos are deleted only after the commit.
 */
export async function importAppPackage(raw: unknown): Promise<{ settings: AppSettings; themes: ThemeDefinition[] }> {
  const { pkg, assets } = validateAppPackage(raw);

  const restoredThemes = withBuiltinThemes(pkg.themes.map((theme) => themeSchema.parse(theme)));
  const restoredThemeIds = new Set(restoredThemes.map((theme) => theme.id));
  const restoredTeams = pkg.teams.map((team) => teamRecordSchema.parse(team));
  const publishedThemeExists = restoredThemes.some((theme) => theme.id === pkg.settings.publishedThemeId);
  const restoredSettings = settingsSchema.parse({
    ...pkg.settings,
    publishedThemeId: publishedThemeExists ? pkg.settings.publishedThemeId : resolvePrimaryThemeId(restoredThemes)
  });
  const restoredOperations: OperationsState =
    pkg.version === 2
      ? {
          ...pkg.operations,
          operatorTextOverrides: pkg.operations.operatorTextOverrides.filter((override) => restoredThemeIds.has(override.themeId))
        }
      : { ...getOperationsState(), operatorTextOverrides: [] };
  const restoredAssets: StoredAssetRecord[] = assets.map((item) => ({
    ...item.asset,
    filePath: path.join(uploadsDir, item.fileName)
  }));

  const documentPaths = [settingsPath, themesPath, assetsPath, teamsPath, operationsPath];
  const previousDocuments = new Map(documentPaths.map((filePath) => [filePath, readFileOrNull(filePath)]));
  const previousAssets = readJson<StoredAssetRecord[]>(assetsPath, []);
  const stagingDir = path.join(uploadsDir, `.restore-${randomUUID()}`);
  const displacedDir = path.join(stagingDir, ".displaced");
  const addedFiles: string[] = [];
  const displacedFiles: Array<{ from: string; to: string }> = [];

  try {
    await fsp.mkdir(displacedDir, { recursive: true });
    for (const item of assets) {
      await fsp.writeFile(path.join(stagingDir, item.fileName), item.buffer);
    }
    restoreFaultInjector?.("staged");

    for (const item of assets) {
      const staged = path.join(stagingDir, item.fileName);
      const target = path.join(uploadsDir, item.fileName);
      if (fs.existsSync(target)) {
        if (computeContentHash(await fsp.readFile(target)) === computeContentHash(item.buffer)) {
          continue;
        }
        const displaced = path.join(displacedDir, item.fileName);
        await fsp.rename(target, displaced);
        displacedFiles.push({ from: displaced, to: target });
      }
      await fsp.rename(staged, target);
      addedFiles.push(target);
    }
    restoreFaultInjector?.("files-committed");

    writeJson(settingsPath, restoredSettings);
    writeJson(themesPath, restoredThemes);
    restoreFaultInjector?.("documents-partial");
    writeJson(assetsPath, restoredAssets);
    writeJson(teamsPath, restoredTeams);
    writeOperationsState(restoredOperations);
  } catch (error) {
    for (const [filePath, content] of previousDocuments) {
      try {
        restoreFileContent(filePath, content);
      } catch {
        // Keep putting back the remaining documents.
      }
    }
    for (const filePath of addedFiles) {
      await fsp.rm(filePath, { force: true }).catch(() => undefined);
    }
    for (const displaced of displacedFiles) {
      await fsp.rename(displaced.from, displaced.to).catch(() => undefined);
    }
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  const keptFiles = new Set(restoredAssets.map((asset) => path.resolve(asset.filePath)));
  for (const asset of previousAssets) {
    const filePath = path.resolve(resolveStoredAssetPath(asset));
    if (!keptFiles.has(filePath) && isPathInside(uploadsDir, filePath)) {
      await fsp.rm(filePath, { force: true }).catch(() => undefined);
    }
  }
  await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);

  for (const theme of restoredThemes) {
    pruneOperatorTextOverridesForTheme(theme);
  }

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
