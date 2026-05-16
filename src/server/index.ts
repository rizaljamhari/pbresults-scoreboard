import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { livePoller } from "./livePoller.js";
import {
  attachTeamLogo,
  createTeamRecord,
  deleteTheme,
  deleteTeamRecord,
  exportAppPackage,
  exportThemePackage,
  getSettings,
  getTheme,
  getTeamRecord,
  importAppPackage,
  importThemePackage,
  listAssets,
  listTeamRecords,
  listThemes,
  matchTeamInput,
  publishTheme,
  saveTeamRecord,
  saveTheme,
  storeAsset,
  updateSettings,
  createThemeFromClone
} from "./storage.js";
import { appExportSchema, settingsSchema, teamRecordSchema, themeExportSchema, themeSchema } from "../shared/theme.js";

const app = Fastify({
  logger: true,
  bodyLimit: 20 * 1024 * 1024
});

await app.register(cors, { origin: true });
await app.register(multipart);
await app.register(fastifyStatic, {
  root: path.resolve(process.cwd(), "data/uploads"),
  prefix: "/uploads/"
});

livePoller.start();

app.get("/api/live", async () => livePoller.getState().normalized);
app.get("/api/live/raw", async () => livePoller.getState().raw);
app.get("/api/live/stream", async (_request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  const unsubscribe = livePoller.subscribe(({ normalized }) => {
    reply.raw.write(`data: ${JSON.stringify(normalized)}\n\n`);
  });

  const keepAlive = setInterval(() => {
    reply.raw.write(": keep-alive\n\n");
  }, 15000);

  reply.raw.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

app.get("/api/settings", async () => getSettings());
app.put("/api/settings", async (request, reply) => {
  const settings = settingsSchema.parse(request.body);
  const next = updateSettings(settings);
  livePoller.reconfigure();
  return reply.send(next);
});
app.get("/api/app/export", async () => exportAppPackage());
app.post("/api/app/import", async (request, reply) => {
  const pkg = appExportSchema.parse(request.body);
  const restored = await importAppPackage(pkg);
  livePoller.reconfigure();
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
  const body = (request.body as Partial<{ canonicalName: string; shortName: string; aliases: string[]; notes: string; active: boolean }> | undefined) ?? {};
  const team = createTeamRecord(body);
  livePoller.reconfigure();
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
  return saved;
});
app.delete("/api/teams/:id", async (request, reply) => {
  deleteTeamRecord((request.params as { id: string }).id);
  livePoller.reconfigure();
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
    return reply.code(201).send(result);
  } catch (error) {
    return reply.code(404).send({ message: error instanceof Error ? error.message : "Team not found" });
  }
});

app.get("/api/themes", async () => listThemes());
app.post("/api/themes", async (request, reply) => {
  const body = (request.body as { cloneFromId?: string; name?: string } | undefined) ?? {};
  const theme = createThemeFromClone(body.cloneFromId, body.name);
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
  return saveTheme(theme);
});

app.delete("/api/themes/:id", async (request, reply) => {
  deleteTheme((request.params as { id: string }).id);
  return reply.code(204).send();
});

app.post("/api/themes/:id/publish", async (request, reply) => {
  try {
    return publishTheme((request.params as { id: string }).id);
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
  return reply.code(201).send(imported);
});

app.get("/api/assets", async () => listAssets());
app.post("/api/assets", async (request, reply) => {
  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ message: "Missing file" });
  }
  const buffer = await file.toBuffer();
  const asset = await storeAsset(buffer, file.filename, file.mimetype);
  return reply.code(201).send(asset);
});

const clientRoot = path.resolve(process.cwd(), "dist/client");
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

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
