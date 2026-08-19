import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { livePoller } from "./livePoller.js";
import { operatorTextRuntime } from "./operatorTextRuntime.js";
import { clientDistDir, uploadsDir } from "./runtimePaths.js";
import {
  attachTeamLogo,
  backfillVisibleContentMetadata,
  clearAllOperatorTextOverrides,
  clearOperatorTextOverride,
  createTeamRecord,
  deleteTheme,
  deleteTeamRecord,
  exportAppPackage,
  exportTeamRegistryPackage,
  exportThemePackage,
  getOperationsState,
  getOperatorTextState,
  getSettings,
  getTheme,
  getTeamRecord,
  importAppPackage,
  importTeamRegistryPackage,
  importThemePackage,
  listAssets,
  listTeamRecords,
  listThemes,
  matchTeamInput,
  publishTheme,
  rememberTeamLiveMatchName,
  saveTeamRecord,
  saveOperatorTextOverride,
  saveTeamResolutionOverride,
  saveTheme,
  storeAsset,
  updateSettings,
  createThemeFromClone,
  clearTeamResolutionOverride
} from "./storage.js";
import { appExportSchema, settingsSchema, teamRecordSchema, teamRegistryExportSchema, themeExportSchema, themeSchema } from "../shared/theme.js";
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
const unsubscribeLiveEventBridge = livePoller.subscribe(({ normalized }) => {
  appEventHub.publishLiveState(normalized);
});
const unsubscribeOperatorTextEventBridge = operatorTextRuntime.subscribe((state) => {
  appEventHub.publishOperatorTextState(state);
});
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
  appEventHub.close();
  for (const stream of openStreams) {
    if (!stream.destroyed) {
      stream.write("retry: 2000\n\n");
      stream.end();
    }
  }
  await app.close();
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
await app.register(multipart);
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
  getLiveState: () => livePoller.getState().normalized,
  getOperatorTextState: () => operatorTextRuntime.getState()
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

app.get("/api/live", async () => livePoller.getState().normalized);
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
app.post("/api/operations/resolve", async (request, reply) => {
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
  const pkg = appExportSchema.parse(request.body);
  const restored = await importAppPackage(pkg);
  livePoller.reconfigure();
  operatorTextRuntime.emitCurrent();
  appEventHub.publish("settings.changed");
  appEventHub.publish("themes.changed");
  appEventHub.publish("assets.changed");
  appEventHub.publish("teams.changed");
  scheduleVisibleContentBackfill();
  return reply.code(201).send(restored);
});
app.get("/api/teams/export", async () => exportTeamRegistryPackage());
app.post("/api/teams/import", async (request, reply) => {
  const pkg = teamRegistryExportSchema.parse(request.body);
  const restored = await importTeamRegistryPackage(pkg);
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
app.post("/api/teams/:id/logo", async (request, reply) => {
  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ message: "Missing file" });
  }
  const slot = ((request.query as { slot?: string } | undefined)?.slot ?? "primary") === "alternate" ? "alternate" : "primary";
  try {
    const result = await attachTeamLogo((request.params as { id: string }).id, await file.toBuffer(), file.filename, file.mimetype, slot);
    livePoller.reconfigure();
    appEventHub.publish("teams.changed", [result.team.id]);
    appEventHub.publish("assets.changed", [result.asset.id]);
    return reply.code(201).send(result);
  } catch (error) {
    return reply.code(404).send({ message: error instanceof Error ? error.message : "Team not found" });
  }
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

app.post("/api/themes/:id/publish", async (request, reply) => {
  try {
    const theme = publishTheme((request.params as { id: string }).id);
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

app.get("/api/assets", async () => listAssets());
app.post("/api/assets", async (request, reply) => {
  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ message: "Missing file" });
  }
  const buffer = await file.toBuffer();
  const result = await storeAsset(buffer, file.filename, file.mimetype);
  appEventHub.publish("assets.changed", [result.asset.id]);
  return reply.code(201).send(result);
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
await app.listen({ port, host: "0.0.0.0" });
scheduleVisibleContentBackfill();
updateService.startAutomaticChecks();

process.on("SIGINT", () => void gracefulShutdown());
process.on("SIGTERM", () => void gracefulShutdown());
