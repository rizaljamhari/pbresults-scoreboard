import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createFileSecretStore } from "./remoteAccessSecrets";
import { RemoteAccessService } from "./remoteAccessService";
import { registerRemoteAccessRoutes } from "./remoteAccessRoutes";

const token = "2abcDEFghiJKLmnoPQRstu_3vwxYZ0123456789abcdef";
const apps: FastifyInstance[] = [];
const tempRoots: string[] = [];

function setup(options: { local?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-remote-routes-"));
  tempRoots.push(tempRoot);
  const filePath = path.join(tempRoot, "secrets", "remote-access.json");
  const app = Fastify({ logger: false });
  registerRemoteAccessRoutes(app, {
    service: new RemoteAccessService({ store: createFileSecretStore({ filePath, env: options.env ?? {} }) }),
    isManagementRequest: () => options.local ?? true
  });
  apps.push(app);
  return { app, filePath };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const save = (app: FastifyInstance, payload: unknown) => app.inject({ method: "PUT", url: "/api/remote-access/configuration", payload });
const remove = (app: FastifyInstance, payload: unknown) => app.inject({ method: "DELETE", url: "/api/remote-access/configuration", payload });

describe("remote access configuration routes", () => {
  it("saves, reports, and removes the token from the scoreboard computer", async () => {
    const { app, filePath } = setup();

    const initial = await app.inject({ method: "GET", url: "/api/remote-access/status" });
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(initial.json()).toMatchObject({ provider: "ngrok", configured: false, phase: "unconfigured", managementAllowed: true, configurationSource: null });

    const saved = await save(app, { authtoken: ` ${token} `, confirmation: "SAVE_AND_TEST_NGROK" });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ configured: true, phase: "inactive", configurationSource: "file" });
    expect(saved.body).not.toContain(token);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8")).authtoken).toBe(token);

    const removed = await remove(app, { confirmation: "REMOVE_NGROK_CONFIGURATION" });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ configured: false, phase: "unconfigured" });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("rejects configuration changes from other computers and hides local-only fields", async () => {
    const { app, filePath } = setup({ local: false });

    const saved = await save(app, { authtoken: token, confirmation: "SAVE_AND_TEST_NGROK" });
    expect(saved.statusCode).toBe(403);
    expect(saved.json()).toMatchObject({ code: "REMOTE_ACCESS_LOCAL_REQUEST_REQUIRED" });
    expect(fs.existsSync(filePath)).toBe(false);

    const removed = await remove(app, { confirmation: "REMOVE_NGROK_CONFIGURATION" });
    expect(removed.statusCode).toBe(403);

    const status = (await app.inject({ method: "GET", url: "/api/remote-access/status" })).json();
    expect(status).toMatchObject({ managementAllowed: false });
    expect(status).not.toHaveProperty("configurationSource");
    expect(status).not.toHaveProperty("credentials");
  });

  it("requires the exact confirmation and a plausible token without echoing it", async () => {
    const { app, filePath } = setup();

    const unconfirmed = await save(app, { authtoken: token, confirmation: "yes" });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json()).toMatchObject({ code: "REMOTE_ACCESS_INVALID_REQUEST" });
    expect(unconfirmed.body).not.toContain(token);

    const malformed = await save(app, { authtoken: `${token} extra words`, confirmation: "SAVE_AND_TEST_NGROK" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain(token);

    expect((await remove(app, {})).statusCode).toBe(400);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("refuses to replace a token set by the environment", async () => {
    const { app } = setup({ env: { NGROK_AUTHTOKEN: token } });
    const status = (await app.inject({ method: "GET", url: "/api/remote-access/status" })).json();
    expect(status).toMatchObject({ configured: true, configurationSource: "environment" });
    expect(JSON.stringify(status)).not.toContain(token);

    const saved = await save(app, { authtoken: token, confirmation: "SAVE_AND_TEST_NGROK" });
    expect(saved.statusCode).toBe(409);
    expect(saved.json()).toMatchObject({ code: "REMOTE_ACCESS_CONFIGURED_BY_ENVIRONMENT" });
  });
});
