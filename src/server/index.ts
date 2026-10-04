import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { livePoller } from "./livePoller.js";
import { operatorTextRuntime } from "./operatorTextRuntime.js";
import { clientDistDir, remoteAccessSecretPath, uploadsDir } from "./runtimePaths.js";
import {
  backfillVisibleContentMetadata,
  clearAllOperatorTextOverrides,
  clearOperatorTextOverride,
  createTeamRecord,
  deleteTheme,
  setThemeArchived,
  addThemeVersion,
  deleteThemeVersion,
  deleteTeamRecord,
  exportAppPackage,
  exportTeamRegistryPackage,
  exportThemePackage,
  getOperationsState,
  getOperatorTextState,
  getScoreboardState,
  getSettings,
  getTheme,
  getTeamRecord,
  importTeamRegistryPackage,
  importThemePackage,
  listTeamRecords,
  listAssets,
  listThemes,
  matchTeamInput,
  publishTheme,
  rememberTeamLiveMatchName,
  saveTeamRecord,
  saveOperatorTextOverride,
  setScoreboardVisible,
  saveTeamResolutionOverride,
  saveTheme,
  updateSettings,
  createThemeFromClone,
  clearTeamResolutionOverride
} from "./storage.js";
import { settingsSchema, teamRecordSchema, teamRegistryExportSchema, themeExportSchema, themeSchema } from "../shared/theme.js";
import {
  updateDownloadRequestSchema,
  updateInstallRequestSchema,
  updateRollbackRequestSchema,
  updateSkipRequestSchema
} from "../shared/update.js";
import { runtimeBuild } from "./buildInfo.js";
import { getHealthStatus, runStartupHealthProbe } from "./health.js";
import { isLoopbackRequest } from "./updateSecurity.js";
import { UpdateFailure, updateService } from "./updateService.js";
import { AppEventHub } from "./appEventHub.js";
import { registerAppEventRoutes } from "./appEventRoutes.js";
import { OverlayRegistry } from "./overlayRegistry.js";
import { LiveGate } from "./liveGate.js";
import { RehearsalRefusedError, RehearsalRunner } from "./rehearsalRunner.js";
import { behindThreshold, overlayReportSchema } from "../shared/overlayHealth.js";
import { scoreboardVisibilityRequestSchema } from "../shared/scoreboard.js";
import { registerAssetRoutes } from "./assetRoutes.js";
import { BackupFailure, backupService } from "./backupService.js";
import { createFileSecretStore } from "./remoteAccessSecrets.js";
import { RemoteAccessService } from "./remoteAccessService.js";
import { registerRemoteAccessRoutes } from "./remoteAccessRoutes.js";

const app = Fastify({
  logger: true,
  bodyLimit: 200 * 1024 * 1024
});

const port = Number(process.env.PORT ?? 3000);
const openStreams = new Set<import("node:http").ServerResponse>();
const appEventHub = new AppEventHub({
  logger: {
    warn(message, details) {
      app.log.warn(details ?? {}, message);
    }
  }
});
// What the overlay and admin see: the real feed, or rehearsal frames while a rehearsal runs.
const liveGate = new LiveGate(
  () => livePoller.getState().normalized,
  (state) => appEventHub.publishLiveState(state)
);
const rehearsal = new RehearsalRunner({
  gate: liveGate,
  getFeedState: () => livePoller.getState().normalized,
  getContext: () => {
    const publishedId = getSettings().publishedThemeId;
    const theme = publishedId ? getTheme(publishedId) : null;
    return theme ? { theme, teams: listTeamRecords(), assets: listAssets() } : null;
  },
  onChange: (status) => appEventHub.publishRehearsalState(status)
});
const unsubscribeLiveEventBridge = livePoller.subscribe(({ normalized }) => {
  liveGate.feedChanged(normalized);
  rehearsal.onFeed(normalized);
});
const unsubscribeOperatorTextEventBridge = operatorTextRuntime.subscribe((state) => {
  appEventHub.publishOperatorTextState(state);
});
backupService.onChange(() => appEventHub.publish("backups.changed"));
const overlayRegistry = new OverlayRegistry({
  getServerView: () => {
    const settings = getSettings();
    const published = settings.publishedThemeId ? getTheme(settings.publishedThemeId) : null;
    return {
      publishedThemeId: settings.publishedThemeId,
      publishedThemeUpdatedAt: published?.updatedAt ?? null,
      appVersion: runtimeBuild.info.appVersion,
      behindThresholdMs: behindThreshold(settings.pollIntervalMs)
    };
  },
  getServerLiveFetchedAt: () => liveGate.current().fetchedAt,
  getThemeName: (themeId) => getTheme(themeId)?.name ?? null,
  onChange: (state) => appEventHub.publishOverlayState(state)
});
overlayRegistry.startTicking();
let shuttingDown = false;
let visibleContentBackfillRunning = false;
let visibleContentBackfillRequested = false;

function scheduleVisibleContentBackfill() {
  visibleContentBackfillRequested = true;
  if (visibleContentBackfillRunning || shuttingDown) {
    return;
  }

  visibleContentBackfillRunning = true;
  void (async () => {
    try {
      while (visibleContentBackfillRequested && !shuttingDown) {
        visibleContentBackfillRequested = false;
        const startedAt = Date.now();
        const result = await backfillVisibleContentMetadata();
        app.log.info(
          {
            scanned: result.scanned,
            trimmed: result.trimmed,
            fullFrame: result.fullFrame,
            empty: result.empty,
            unsupported: result.unsupported,
            failed: result.failed,
            durationMs: Date.now() - startedAt
          },
          "Asset visible-content analysis completed"
        );
        if (result.changedAssetIds.length > 0) {
          appEventHub.publish("assets.changed", result.changedAssetIds);
        }
      }
    } catch (error) {
      app.log.warn({ error }, "Asset visible-content analysis failed");
    } finally {
      visibleContentBackfillRunning = false;
      if (visibleContentBackfillRequested && !shuttingDown) {
        scheduleVisibleContentBackfill();
      }
    }
  })();
}

async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  updateService.stop();
  unsubscribeLiveEventBridge();
  unsubscribeOperatorTextEventBridge();
  livePoller.stop();
  await runShutdownBackup();
  overlayRegistry.stop();
  rehearsal.dispose();
  appEventHub.close();
  for (const stream of openStreams) {
    if (!stream.destroyed) {
      stream.write("retry: 2000\n\n");
      stream.end();
    }
  }
  await app.close();
}

const shutdownBackupTimeoutMs = 3000;

/** Best effort: a closing console window gives the process only a few seconds, and the next startup backs up anyway. */
async function runShutdownBackup() {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), shutdownBackupTimeoutMs);
  });
  try {
    const outcome = await Promise.race([backupService.createBackup("shutdown", { skipIfUnchanged: true }), timeout]);
    if (outcome === "timeout") {
      app.log.warn("Shutdown backup did not finish in time");
    }
  } catch (error) {
    app.log.warn({ error }, "Shutdown backup failed");
  } finally {
    clearTimeout(timer);
  }
}

function sendBackupFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof BackupFailure) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  return reply.code(400).send({ message: error instanceof Error ? error.message : "Backup operation failed" });
}

function publishFullRestore() {
  livePoller.reconfigure();
  operatorTextRuntime.emitCurrent();
  appEventHub.publish("settings.changed");
  appEventHub.publish("themes.changed");
  appEventHub.publish("assets.changed");
  appEventHub.publish("teams.changed");
  scheduleVisibleContentBackfill();
}

function requireLocalUpdateRequest(request: Parameters<typeof isLoopbackRequest>[0], reply: FastifyReply) {
  if (isLoopbackRequest(request)) return true;
  reply.code(403).send({
    code: "UPDATE_LOCAL_REQUEST_REQUIRED",
    message: "Software update controls are available only from the local computer."
  });
  return false;
}

function sendUpdateFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof UpdateFailure) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message, retryable: error.retryable });
  }
  return reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid update request" });
}

function findPreferredLanAddress() {
  const interfaces = os.networkInterfaces();
  const ipv4Candidates: string[] = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      if (entry.address.startsWith("169.254.")) {
        continue;
      }
      ipv4Candidates.push(entry.address);
    }
  }

  const privateCandidate =
    ipv4Candidates.find((address) => address.startsWith("192.168.")) ??
    ipv4Candidates.find((address) => address.startsWith("10.")) ??
    ipv4Candidates.find((address) => {
      const match = /^172\.(\d+)\./.exec(address);
      if (!match) {
        return false;
      }
      const secondOctet = Number(match[1]);
      return secondOctet >= 16 && secondOctet <= 31;
    });

  return privateCandidate ?? ipv4Candidates[0] ?? null;
}

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
await app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: "/uploads/"
});

livePoller.start();
runStartupHealthProbe();

app.get("/api/health", async () => getHealthStatus());

app.get("/api/runtime-info", async () => {
  const preferredHost = findPreferredLanAddress();
  return {
    preferredHost,
    preferredOrigin: preferredHost ? `http://${preferredHost}:${port}` : null,
    appVersion: runtimeBuild.info.appVersion,
    releaseTag: runtimeBuild.info.releaseTag
  };
});

registerAppEventRoutes(app, {
  hub: appEventHub,
  openStreams,
  getRuntime: () => ({
    appVersion: runtimeBuild.info.appVersion,
    releaseTag: runtimeBuild.info.releaseTag
  }),
  getLiveState: () => liveGate.current(),
  getOperatorTextState: () => operatorTextRuntime.getState(),
  overlays: overlayRegistry,
  getOverlayState: () => overlayRegistry.getState(),
  getRehearsalStatus: () => rehearsal.getStatus(),
  getScoreboardState: () => getScoreboardState()
});

// Rehearsal: test cases on the real overlay before a show. Refused during a match; never saves anything.
app.get("/api/rehearsal", async () => rehearsal.getStatus());
app.post("/api/rehearsal/start", async (request, reply) => {
  const body = (request.body as { autoPlay?: unknown } | undefined) ?? {};
  try {
    return rehearsal.start({ autoPlay: body.autoPlay === true });
  } catch (error) {
    if (error instanceof RehearsalRefusedError) return reply.code(409).send({ message: error.message });
    throw error;
  }
});
app.post("/api/rehearsal/go", async (request, reply) => {
  const to = (request.body as { to?: unknown } | undefined)?.to;
  if (typeof to !== "string" || !to) return reply.code(400).send({ message: "to must be next, prev or a case id" });
  return rehearsal.go(to);
});
app.post("/api/rehearsal/mark", async (request, reply) => {
  const body = (request.body as { caseId?: unknown; result?: unknown; note?: unknown } | undefined) ?? {};
  if (typeof body.caseId !== "string" || (body.result !== "pass" && body.result !== "issue")) {
    return reply.code(400).send({ message: "caseId and result (pass or issue) are required" });
  }
  return rehearsal.mark(body.caseId, body.result, typeof body.note === "string" ? body.note : "");
});
app.post("/api/rehearsal/autoplay", async (request, reply) => {
  const on = (request.body as { on?: unknown } | undefined)?.on;
  if (typeof on !== "boolean") return reply.code(400).send({ message: "on must be true or false" });
  return rehearsal.setAutoPlay(on);
});
app.post("/api/rehearsal/stop", async () => rehearsal.stop("operator"));
app.post("/api/rehearsal/dismiss", async () => rehearsal.dismiss());

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Overlay pages report what they render; a bad or oversized report is dropped, never an error on air.
app.post("/api/overlay/report", { bodyLimit: 4 * 1024 }, async (request, reply) => {
  const body = typeof request.body === "string" ? safeJson(request.body) : request.body;
  const parsed = overlayReportSchema.safeParse(body);
  if (!parsed.success) {
    return reply.code(400).send({ message: "Invalid overlay report" });
  }
  overlayRegistry.report(parsed.data, {
    remoteAddress: request.ip,
    userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300)
  });
  return reply.code(204).send();
});
app.get("/api/overlay/clients", async () => overlayRegistry.getState());
app.get("/api/scoreboard", async () => getScoreboardState());
app.put("/api/scoreboard", async (request) => {
  const { visible } = scoreboardVisibilityRequestSchema.parse(request.body);
  const state = setScoreboardVisible(visible);
  appEventHub.publishScoreboardState(state);
  return state;
});
app.post("/api/overlay/entrance", async () => {
  const token = Date.now();
  appEventHub.publishEntranceCue(token);
  return { token };
});

registerRemoteAccessRoutes(app, {
  service: new RemoteAccessService({ store: createFileSecretStore({ filePath: remoteAccessSecretPath }) }),
  // Sufficient while no tunnel exists; the strict onsite predicate replaces it before the ngrok provider lands.
  isManagementRequest: isLoopbackRequest
});

app.get("/api/update/status", async () => updateService.getStatus());
app.post("/api/update/check", async (request, reply) => {
  if (!requireLocalUpdateRequest(request, reply)) return;
  try {
    return await updateService.check(true);
  } catch (error) {
    return sendUpdateFailure(reply, error);
  }
});
app.post("/api/update/download", async (request, reply) => {
  if (!requireLocalUpdateRequest(request, reply)) return;
  try {
    const body = updateDownloadRequestSchema.parse(request.body);
    return reply.code(202).send(updateService.download(body.version));
  } catch (error) {
    return sendUpdateFailure(reply, error);
  }
});
app.post("/api/update/install", async (request, reply) => {
  if (!requireLocalUpdateRequest(request, reply)) return;
  try {
    const body = updateInstallRequestSchema.parse(request.body);
    return reply.code(202).send(await updateService.install(body.version));
  } catch (error) {
    return sendUpdateFailure(reply, error);
  }
});
app.post("/api/update/skip", async (request, reply) => {
  if (!requireLocalUpdateRequest(request, reply)) return;
  try {
    const body = updateSkipRequestSchema.parse(request.body);
    return updateService.skip(body.version);
  } catch (error) {
    return sendUpdateFailure(reply, error);
  }
});
app.post("/api/update/rollback", async (request, reply) => {
  if (!requireLocalUpdateRequest(request, reply)) return;
  try {
    updateRollbackRequestSchema.parse(request.body);
    return reply.code(202).send(await updateService.rollback());
  } catch (error) {
    return sendUpdateFailure(reply, error);
  }
});
app.post("/api/update/result/dismiss", async (request, reply) => {
  if (!requireLocalUpdateRequest(request, reply)) return;
  return updateService.dismissResult();
});

app.get("/api/live", async () => liveGate.current());
app.get("/api/live/raw", async () => livePoller.getState().raw);

app.get("/api/settings", async () => getSettings());
app.put("/api/settings", async (request, reply) => {
  const settings = settingsSchema.parse(request.body);
  const next = updateSettings(settings);
  livePoller.reconfigure();
  updateService.reconfigureAutomaticChecks();
  operatorTextRuntime.emitCurrent();
  appEventHub.publish("settings.changed");
  return reply.send(next);
});
app.post("/api/live/poll/start", async () => {
  const next = updateSettings({
    ...getSettings(),
    pollEnabled: true
  });
  livePoller.reconfigure();
  appEventHub.publish("settings.changed");
  return next;
});
app.post("/api/live/poll/stop", async () => {
  const next = updateSettings({
    ...getSettings(),
    pollEnabled: false
  });
  livePoller.reconfigure();
  appEventHub.publish("settings.changed");
  return next;
});
app.post("/api/live/poll/refresh", async () => {
  livePoller.refreshNow();
  return { ok: true };
});
app.get("/api/operations", async () => getOperationsState());
app.get("/api/operations/text-fields", async () => getOperatorTextState());
app.put("/api/operations/text/:themeId/:componentId", async (request, reply) => {
  const { themeId, componentId } = request.params as { themeId: string; componentId: string };
  const value = (request.body as { value?: unknown } | undefined)?.value;
  if (typeof value !== "string") {
    return reply.code(400).send({ message: "value must be a string" });
  }
  try {
    const override = saveOperatorTextOverride(themeId, componentId, value);
    operatorTextRuntime.emitCurrent();
    return override;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update operator text";
    const status = message.startsWith("Published theme changed") ? 409 : message.includes("not found") ? 404 : 400;
    return reply.code(status).send({ message });
  }
});
app.delete("/api/operations/text/:themeId/:componentId", async (request, reply) => {
  const { themeId, componentId } = request.params as { themeId: string; componentId: string };
  try {
    clearOperatorTextOverride(themeId, componentId);
    operatorTextRuntime.emitCurrent();
    return reply.code(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset operator text";
    const status = message.startsWith("Published theme changed") ? 409 : message.includes("not found") ? 404 : 400;
    return reply.code(status).send({ message });
  }
});
app.post("/api/operations/text/:themeId/reset", async (request, reply) => {
  const { themeId } = request.params as { themeId: string };
  try {
    clearAllOperatorTextOverrides(themeId);
    operatorTextRuntime.emitCurrent();
    return reply.code(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset operator text";
    return reply.code(message.startsWith("Published theme changed") ? 409 : 400).send({ message });
  }
});
// During a rehearsal the names on screen are test data: a pick would save a test name as a real team's name.
const REHEARSAL_PICK_REFUSAL = {
  message: "Team picks are paused during a rehearsal: the names on screen are test data. Stop the rehearsal to pick real teams.",
  code: "REHEARSAL_RUNNING"
};

app.post("/api/operations/resolve", async (request, reply) => {
  if (rehearsal.running) return reply.code(409).send(REHEARSAL_PICK_REFUSAL);
  const body = ((request.body as { teamId?: string; rawInputName?: string; remember?: boolean; forceReassign?: boolean } | undefined) ?? {});
  if (!body.teamId?.trim() || !body.rawInputName?.trim()) {
    return reply.code(400).send({ message: "teamId and rawInputName are required" });
  }
  const selectedTeam = getTeamRecord(body.teamId);
  if (!selectedTeam) {
    return reply.code(404).send({ message: "Team not found" });
  }
  if (!selectedTeam.active) {
    return reply.code(400).send({ message: "Inactive teams cannot be used for live resolution" });
  }
  try {
    const remembered = body.remember ? rememberTeamLiveMatchName(body.teamId, body.rawInputName, { forceReassign: body.forceReassign }) : null;
    const override = saveTeamResolutionOverride(body.rawInputName, body.teamId);
    livePoller.reconfigure();
    if (body.remember) {
      appEventHub.publish("teams.changed", [body.teamId, remembered?.reassignedFromTeam?.id ?? ""]);
    }
    return reply.code(201).send({
      override,
      rememberedTeam: remembered?.team ?? null,
      reassignedFromTeam: remembered?.reassignedFromTeam ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Team not found";
    if (error instanceof Error && "code" in error) {
      const details = error as Error & {
        code: string;
        conflictTeamId?: string;
        conflictTeamName?: string;
        conflictType?: "reassignable" | "blocked";
      };
      return reply.code(409).send({
        message,
        code: details.code,
        conflictTeamId: details.conflictTeamId ?? null,
        conflictTeamName: details.conflictTeamName ?? null,
        conflictType: details.conflictType ?? null
      });
    }
    return reply.code(404).send({ message });
  }
});
app.delete("/api/operations/resolve/:side", async (request, reply) => {
  if (rehearsal.running) return reply.code(409).send(REHEARSAL_PICK_REFUSAL);
  const rawInputName = typeof (request.query as { rawInputName?: string } | undefined)?.rawInputName === "string"
    ? ((request.query as { rawInputName?: string }).rawInputName ?? "")
    : "";
  if (!rawInputName.trim()) {
    return reply.code(400).send({ message: "rawInputName is required" });
  }
  clearTeamResolutionOverride(rawInputName);
  livePoller.reconfigure();
  return reply.code(204).send();
});
app.get("/api/app/export", async () => exportAppPackage());
app.post("/api/app/import", async (request, reply) => {
  try {
    const restored = await backupService.restorePackage(request.body);
    publishFullRestore();
    return reply.code(201).send(restored);
  } catch (error) {
    return sendBackupFailure(reply, error);
  }
});
app.get("/api/backups", async () => backupService.getStatus());
app.post("/api/backups", async (_request, reply) => {
  try {
    await backupService.createBackup("manual");
    return reply.code(201).send(backupService.getStatus());
  } catch (error) {
    return sendBackupFailure(reply, error);
  }
});
app.post("/api/backups/inspect", async (request, reply) => {
  try {
    return backupService.inspectPackage(request.body);
  } catch (error) {
    return sendBackupFailure(reply, error);
  }
});
app.post("/api/backups/:file/inspect", async (request, reply) => {
  try {
    return await backupService.inspectFile((request.params as { file: string }).file);
  } catch (error) {
    return sendBackupFailure(reply, error);
  }
});
app.post("/api/backups/:file/restore", async (request, reply) => {
  try {
    const restored = await backupService.restoreFile((request.params as { file: string }).file);
    publishFullRestore();
    return reply.code(201).send(restored);
  } catch (error) {
    return sendBackupFailure(reply, error);
  }
});
app.put("/api/backups/config", async (request, reply) => {
  if (!isLoopbackRequest(request)) {
    return reply.code(403).send({ message: "Backup folders can be changed only from the scoreboard computer." });
  }
  const body = (request.body as { extraFolder?: unknown; retainAutomatic?: unknown } | undefined) ?? {};
  try {
    return backupService.updateConfig({
      extraFolder: typeof body.extraFolder === "string" ? body.extraFolder : null,
      retainAutomatic: typeof body.retainAutomatic === "number" ? body.retainAutomatic : NaN
    });
  } catch (error) {
    return sendBackupFailure(reply, error);
  }
});
app.get("/api/teams/export", async () => exportTeamRegistryPackage());
app.post("/api/teams/import", async (request, reply) => {
  const pkg = teamRegistryExportSchema.parse(request.body);
  let restored;
  try {
    restored = await backupService.runAfterSafetyBackup(() => importTeamRegistryPackage(pkg));
  } catch (error) {
    return sendBackupFailure(reply, error);
  }
  livePoller.reconfigure();
  appEventHub.publish("teams.changed");
  appEventHub.publish("assets.changed");
  scheduleVisibleContentBackfill();
  return reply.code(201).send(restored);
});

app.get("/api/teams", async () => listTeamRecords());
app.post("/api/teams/match-test", async (request, reply) => {
  const body = (request.body as { inputName?: string } | undefined) ?? {};
  if (!body.inputName?.trim()) {
    return reply.code(400).send({ message: "inputName is required" });
  }
  return matchTeamInput(body.inputName);
});
app.post("/api/teams", async (request, reply) => {
  const body = (
    request.body as
      | Partial<{ canonicalName: string; scoreboardDisplayName: string; shortName: string; aliases: string[]; notes: string; active: boolean }>
      | undefined
  ) ?? {};
  const team = createTeamRecord(body);
  livePoller.reconfigure();
  appEventHub.publish("teams.changed", [team.id]);
  return reply.code(201).send(team);
});
app.get("/api/teams/:id", async (request, reply) => {
  const team = getTeamRecord((request.params as { id: string }).id);
  if (!team) {
    return reply.code(404).send({ message: "Team not found" });
  }
  return team;
});
app.put("/api/teams/:id", async (request, reply) => {
  const team = teamRecordSchema.parse(request.body);
  if (team.id !== (request.params as { id: string }).id) {
    return reply.code(400).send({ message: "Team id mismatch" });
  }
  const saved = saveTeamRecord(team);
  livePoller.reconfigure();
  appEventHub.publish("teams.changed", [saved.id]);
  return saved;
});
app.delete("/api/teams/:id", async (request, reply) => {
  const teamId = (request.params as { id: string }).id;
  deleteTeamRecord(teamId);
  livePoller.reconfigure();
  appEventHub.publish("teams.changed", [teamId]);
  return reply.code(204).send();
});
app.get("/api/themes", async () => listThemes());
app.post("/api/themes", async (request, reply) => {
  const body = (request.body as { cloneFromId?: string; name?: string } | undefined) ?? {};
  const theme = createThemeFromClone(body.cloneFromId, body.name);
  appEventHub.publish("themes.changed", [theme.id]);
  return reply.code(201).send(theme);
});

app.get("/api/themes/:id", async (request, reply) => {
  const theme = getTheme((request.params as { id: string }).id);
  if (!theme) {
    return reply.code(404).send({ message: "Theme not found" });
  }
  return theme;
});

app.put("/api/themes/:id", async (request, reply) => {
  const theme = themeSchema.parse(request.body);
  if (theme.id !== (request.params as { id: string }).id) {
    return reply.code(400).send({ message: "Theme id mismatch" });
  }
  const saved = saveTheme(theme);
  operatorTextRuntime.emitCurrent();
  appEventHub.publish("themes.changed", [saved.id]);
  return saved;
});

app.delete("/api/themes/:id", async (request, reply) => {
  const themeId = (request.params as { id: string }).id;
  const wasPublished = getSettings().publishedThemeId === themeId;
  deleteTheme(themeId);
  operatorTextRuntime.emitCurrent();
  appEventHub.publish("themes.changed", [themeId]);
  if (wasPublished) {
    appEventHub.publish("settings.changed");
  }
  return reply.code(204).send();
});

const themeVersionBodySchema = z.object({ name: z.string().trim().min(1).max(60), theme: z.record(z.string(), z.unknown()) });

/** Keeps a named version of the theme: usually the editor's draft. Doesn't change the theme or what's on air. */
app.post("/api/themes/:id/versions", async (request, reply) => {
  const themeId = (request.params as { id: string }).id;
  const body = themeVersionBodySchema.safeParse(request.body);
  if (!body.success) {
    return reply.code(400).send({ message: "A version needs a name and the theme to keep" });
  }
  try {
    const theme = addThemeVersion(themeId, body.data.name, body.data.theme);
    appEventHub.publish("themes.changed", [theme.id]);
    return reply.code(201).send(theme);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not keep the version";
    return reply.code(message === "Theme not found" ? 404 : error instanceof z.ZodError ? 400 : 409).send({ message });
  }
});

app.delete("/api/themes/:id/versions/:versionId", async (request, reply) => {
  const { id, versionId } = request.params as { id: string; versionId: string };
  try {
    const theme = deleteThemeVersion(id, versionId);
    appEventHub.publish("themes.changed", [theme.id]);
    return theme;
  } catch (error) {
    return reply.code(404).send({ message: error instanceof Error ? error.message : "Theme not found" });
  }
});

app.post("/api/themes/:id/archive", async (request, reply) => {
  const themeId = (request.params as { id: string }).id;
  const archived = (request.body as { archived?: unknown } | undefined)?.archived;
  if (typeof archived !== "boolean") {
    return reply.code(400).send({ message: "archived must be true or false" });
  }
  try {
    const theme = setThemeArchived(themeId, archived);
    appEventHub.publish("themes.changed", [theme.id]);
    return theme;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not archive the theme";
    return reply.code(message === "Theme not found" ? 404 : 409).send({ message });
  }
});

app.post("/api/themes/:id/publish", async (request, reply) => {
  try {
    const theme = publishTheme((request.params as { id: string }).id);
    // A rehearsal tests the theme that was on air; its expectations no longer apply to a different one.
    if (rehearsal.running && rehearsal.getStatus().themeId !== theme.id) rehearsal.stop("theme-changed");
    operatorTextRuntime.emitCurrent();
    appEventHub.publish("theme.published", [theme.id]);
    return theme;
  } catch (error) {
    return reply.code(404).send({ message: error instanceof Error ? error.message : "Theme not found" });
  }
});

app.get("/api/themes/:id/export", async (request, reply) => {
  try {
    const pkg = await exportThemePackage((request.params as { id: string }).id);
    reply.header("content-type", "application/json");
    reply.header("content-disposition", `attachment; filename="${pkg.theme.name.replace(/\s+/g, "-").toLowerCase()}.theme.json"`);
    return pkg;
  } catch (error) {
    return reply.code(404).send({ message: error instanceof Error ? error.message : "Theme not found" });
  }
});

app.post("/api/themes/import", async (request, reply) => {
  const pkg = themeExportSchema.parse(request.body);
  const imported = await importThemePackage(pkg);
  appEventHub.publish("themes.changed", [imported.id]);
  appEventHub.publish("assets.changed");
  scheduleVisibleContentBackfill();
  return reply.code(201).send(imported);
});

registerAssetRoutes(app, {
  hub: appEventHub,
  onTeamsChanged: () => livePoller.reconfigure()
});

const clientRoot = clientDistDir;
const clientIndex = path.join(clientRoot, "index.html");
if (fs.existsSync(clientRoot)) {
  await app.register(fastifyStatic, {
    root: clientRoot,
    decorateReply: false
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/uploads/")) {
      return reply.code(404).send({ message: "Not found" });
    }
    return reply.type("text/html").send(fs.readFileSync(clientIndex, "utf8"));
  });
} else {
  app.get("/", async () => ({
    message: "Client build not found. Run `pnpm build` and `pnpm start`, or use `pnpm dev` for development."
  }));
}

updateService.configureLifecycle({ port, shutdown: gracefulShutdown });
backupService.cleanupInterrupted();
await app.listen({ port, host: "0.0.0.0" });
void backupService.createBackup("startup", { skipIfUnchanged: true }).catch((error) => {
  app.log.warn({ error }, "Startup backup failed");
});
scheduleVisibleContentBackfill();
updateService.startAutomaticChecks();

process.on("SIGINT", () => void gracefulShutdown());
process.on("SIGTERM", () => void gracefulShutdown());
process.on("SIGHUP", () => void gracefulShutdown());
