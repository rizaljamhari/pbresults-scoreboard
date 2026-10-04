import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalRemoteAccessStatus } from "../shared/remoteAccess";
import type { OpenTunnelOptions, RemoteAccessProvider, RemoteTunnel } from "./ngrokRemoteAccessProvider";
import { buildTrafficPolicy, classifyProviderError } from "./ngrokRemoteAccessProvider";
import { createLifecycleLog } from "./remoteAccessLog";
import { createMemorySecretStore } from "./remoteAccessSecrets";
import { RemoteAccessFailure, RemoteAccessService, generateSessionSecrets, type RemoteAccessLifecycleEvent } from "./remoteAccessService";
import { registerRemoteAccessRoutes } from "./remoteAccessRoutes";
import { REMOTE_SESSION_MARKER_HEADER, RemoteSessionMarkers, isOnsiteManagementRequest, registerRemoteRequestBoundary } from "./remoteRequestSecurity";

const token = "2abcDEFghiJKLmnoPQRstu_3vwxYZ0123456789abcdef";
const publicUrl = "https://scoreboard-test.ngrok-free.app";
const publicHost = "scoreboard-test.ngrok-free.app";

type Policy = {
  on_http_request: Array<{ name: string; expressions?: string[]; actions: Array<{ type: string; config: Record<string, unknown> }> }>;
};

/** Manual clock and timers, so expiry is tested without waiting. */
function fakeTimers(start = Date.parse("2026-10-05T12:00:00.000Z")) {
  let now = start;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let next = 1;
  return {
    now: () => new Date(now),
    timers: {
      setTimeout(callback: () => void, ms: number) {
        const id = next++;
        pending.set(id, { at: now + ms, callback });
        return id;
      },
      clearTimeout(handle: unknown) {
        pending.delete(handle as number);
      }
    },
    advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...pending]) {
        if (entry.at <= now) {
          pending.delete(id);
          entry.callback();
        }
      }
    },
    pendingCount: () => pending.size
  };
}

/**
 * Stands in for the ngrok edge: it reads the generated policy and applies it the way ngrok would (Basic Auth, the
 * onsite-only deny rule, then the marker header, appended after any client copy), and forwards to the app with the
 * forwarding headers ngrok adds.
 */
class FakeEdge implements RemoteAccessProvider {
  app: FastifyInstance | null = null;
  policy: Policy | null = null;
  options: OpenTunnelOptions | null = null;
  open = false;
  closeCalls = 0;
  failClose = false;
  openError: unknown = null;
  url: string | null = publicUrl;
  verifyAuthtoken = vi.fn(async () => {});
  disconnectAll = vi.fn(async () => {});

  async openTunnel(options: OpenTunnelOptions): Promise<RemoteTunnel> {
    if (this.openError) throw this.openError;
    this.options = options;
    this.policy = JSON.parse(options.trafficPolicy) as Policy;
    this.open = true;
    return {
      url: this.url,
      close: async () => {
        this.closeCalls += 1;
        if (this.failClose) throw new Error("close failed");
        this.open = false;
      }
    };
  }

  private credentials() {
    const rule = this.policy!.on_http_request.find((entry) => entry.actions[0].type === "basic-auth")!;
    return rule.actions[0].config.credentials as string[];
  }

  private marker() {
    const rule = this.policy!.on_http_request.find((entry) => entry.actions[0].type === "add-headers")!;
    return (rule.actions[0].config.headers as Record<string, string>)[REMOTE_SESSION_MARKER_HEADER];
  }

  /** A browser request arriving at the public URL. */
  async request(options: { method?: string; url: string; auth?: string | null; headers?: Record<string, string>; payload?: unknown }) {
    if (!this.open || !this.app) return { statusCode: 404, body: "endpoint offline", json: () => ({}) };
    const supplied = options.auth === undefined ? null : options.auth;
    const decoded = supplied ? Buffer.from(supplied.replace(/^Basic /, ""), "base64").toString() : null;
    if (!decoded || !this.credentials().includes(decoded)) return { statusCode: 401, body: "", json: () => ({}) };
    const method = options.method ?? "GET";
    const routePath = options.url.split("?")[0];
    const lifecycle =
      routePath.startsWith("/api/remote-access/") ||
      routePath.startsWith("/api/update/") ||
      routePath === "/api/backups/config" ||
      routePath === "/api/app/import" ||
      (routePath.startsWith("/api/backups/") && routePath.endsWith("/restore"));
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && lifecycle) return { statusCode: 403, body: "denied at edge", json: () => ({}) };
    const clientMarker = options.headers?.[REMOTE_SESSION_MARKER_HEADER];
    const headers: Record<string, string> = {
      ...options.headers,
      host: publicHost,
      authorization: supplied!,
      "x-forwarded-for": "203.0.113.7",
      "x-forwarded-proto": "https",
      [REMOTE_SESSION_MARKER_HEADER]: clientMarker ? `${clientMarker}, ${this.marker()}` : this.marker()
    };
    return this.app.inject({ method: method as InjectOptions["method"], url: options.url, headers, payload: options.payload as InjectOptions["payload"] });
  }
}

const apps: FastifyInstance[] = [];
const tempRoots: string[] = [];

function setup(options: { configured?: boolean } = {}) {
  const clock = fakeTimers();
  const edge = new FakeEdge();
  const markers = new RemoteSessionMarkers();
  const events: RemoteAccessLifecycleEvent[] = [];
  const onChange = vi.fn();
  const app = Fastify({ logger: false });
  registerRemoteRequestBoundary(app, { markers });
  const service = new RemoteAccessService({
    store: createMemorySecretStore(options.configured === false ? null : { authtoken: token, source: "file" }),
    provider: edge,
    markers,
    now: clock.now,
    timers: clock.timers,
    onChange,
    log: (event) => events.push(event),
    port: 3000,
    probe: async ({ username, password }) => {
      const response = await edge.request({ url: "/api/remote-access/probe", auth: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` });
      return response.statusCode;
    }
  });
  registerRemoteAccessRoutes(app, {
    service,
    isManagementRequest: (request) => isOnsiteManagementRequest(request, new Set([3000])),
    isRemoteRequest: (request) => Boolean(request.remoteAccess)
  });
  const echo = async (request: import("fastify").FastifyRequest) => ({ remote: request.remoteAccess, authorization: request.headers.authorization ?? null });
  app.get("/api/settings", echo);
  app.put("/api/settings", echo);
  edge.app = app;
  apps.push(app);
  const local = (method: InjectOptions["method"], url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { host: "localhost:3000" }, payload: payload as InjectOptions["payload"] });
  return { app, edge, service, markers, events, onChange, clock, local };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const start = (local: ReturnType<typeof setup>["local"], durationMinutes = 120) =>
  local("POST", "/api/remote-access/start", { durationMinutes, confirmation: "START_REMOTE_ACCESS" });
const basic = (status: LocalRemoteAccessStatus) => `Basic ${Buffer.from(`${status.credentials!.username}:${status.credentials!.password}`).toString("base64")}`;

describe("remote access session lifecycle", () => {
  it("starts, proves itself through the public URL, and shows credentials only on the scoreboard computer", async () => {
    const { edge, local, events, onChange, app } = setup();
    const response = await start(local);
    expect(response.statusCode).toBe(201);
    const status = response.json() as LocalRemoteAccessStatus;
    expect(status).toMatchObject({
      phase: "active",
      connection: "connected",
      url: publicUrl,
      startedAt: "2026-10-05T12:00:00.000Z",
      expiresAt: "2026-10-05T14:00:00.000Z"
    });
    expect(status.credentials?.username).toMatch(/^pbremote-[A-Za-z0-9_-]{8}$/);
    expect(status.credentials?.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(edge.options).toMatchObject({ authtoken: token, port: 3000 });
    expect(onChange).toHaveBeenCalled();
    expect(events.map((event) => event.event)).toEqual(["session.starting", "session.active"]);
    expect(JSON.stringify(events)).not.toContain(status.credentials!.password);

    const lan = await app.inject({ method: "GET", url: "/api/remote-access/status", remoteAddress: "192.168.1.20", headers: { host: "192.168.1.5:3000" } });
    expect(lan.json()).toMatchObject({ phase: "active", url: publicUrl });
    expect(lan.json()).not.toHaveProperty("credentials");

    const remote = await edge.request({ url: "/api/remote-access/status", auth: basic(status) });
    expect(remote.json()).toMatchObject({ phase: "active", remoteRequest: true, managementAllowed: false });
    expect(remote.json()).not.toHaveProperty("credentials");
  });

  it("lets authenticated remote browsers work, without ever seeing Basic Auth in a handler", async () => {
    const { edge, local } = setup();
    const status = (await start(local)).json() as LocalRemoteAccessStatus;

    expect((await edge.request({ url: "/api/settings", auth: null })).statusCode).toBe(401);
    expect((await edge.request({ url: "/api/settings", auth: "Basic d3Jvbmc6d3Jvbmc=" })).statusCode).toBe(401);

    const read = await edge.request({ url: "/api/settings", auth: basic(status) });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ authorization: null, remote: { kind: "ngrok", publicOrigin: publicUrl } });

    const write = await edge.request({ method: "PUT", url: "/api/settings", auth: basic(status), headers: { origin: publicUrl }, payload: {} });
    expect(write.statusCode).toBe(200);
    const crossSite = await edge.request({ method: "PUT", url: "/api/settings", auth: basic(status), headers: { origin: "https://evil.example" }, payload: {} });
    expect(crossSite.statusCode).toBe(403);

    // A client copying the marker header ends up with two values, which fails closed.
    const spoofed = await edge.request({ url: "/api/settings", auth: basic(status), headers: { [REMOTE_SESSION_MARKER_HEADER]: "x".repeat(43) } });
    expect(spoofed.statusCode).toBe(403);
  });

  it("refuses remote management at the edge and again in the app", async () => {
    const { edge, local, app, markers } = setup();
    const status = (await start(local)).json() as LocalRemoteAccessStatus;
    const stop = await edge.request({ method: "POST", url: "/api/remote-access/stop", auth: basic(status), headers: { origin: publicUrl }, payload: { confirmation: "STOP_REMOTE_ACCESS" } });
    expect(stop.statusCode).toBe(403);

    // Even if the edge rule were missing, a marked request cannot pass the onsite check.
    const marker = (edge.policy!.on_http_request[2].actions[0].config.headers as Record<string, string>)[REMOTE_SESSION_MARKER_HEADER];
    expect(markers.match(marker)).not.toBeNull();
    const direct = await app.inject({
      method: "POST",
      url: "/api/remote-access/stop",
      headers: { host: "localhost:3000", origin: publicUrl, [REMOTE_SESSION_MARKER_HEADER]: marker },
      payload: { confirmation: "STOP_REMOTE_ACCESS" }
    });
    expect(direct.statusCode).toBe(403);
    expect(direct.json()).toMatchObject({ code: "REMOTE_ACCESS_LOCAL_REQUEST_REQUIRED" });
  });

  it("stops: revokes the marker, closes the tunnel, and forgets every secret", async () => {
    const { edge, local, events } = setup();
    const status = (await start(local)).json() as LocalRemoteAccessStatus;
    const stopped = await local("POST", "/api/remote-access/stop", { confirmation: "STOP_REMOTE_ACCESS" });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toMatchObject({ phase: "inactive", url: null, credentials: null, startedAt: null });
    expect(edge.open).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: "session.stopped", reason: "manual" });

    // Even if the old endpoint somehow kept forwarding, the app has already revoked its marker.
    edge.open = true;
    expect((await edge.request({ url: "/api/settings", auth: basic(status) })).statusCode).toBe(403);
    // A fresh session rotates every credential; the old ones stop working at the edge.
    const second = (await start(local)).json() as LocalRemoteAccessStatus;
    expect(second.credentials!.password).not.toBe(status.credentials!.password);
    expect((await edge.request({ url: "/api/settings", auth: basic(status) })).statusCode).toBe(401);
  });

  it("expires at the absolute end time, even after a connection blip", async () => {
    const { edge, local, clock, service, events } = setup();
    await start(local, 30);
    edge.options!.onConnection("reconnecting");
    expect(service.getStatus({ managementAllowed: true, remoteRequest: false })).toMatchObject({ phase: "degraded", connection: "reconnecting" });
    clock.advance(10 * 60_000);
    edge.options!.onConnection("connected");
    expect(service.getStatus({ managementAllowed: true, remoteRequest: false })).toMatchObject({ phase: "active", expiresAt: "2026-10-05T12:30:00.000Z" });

    clock.advance(20 * 60_000);
    await vi.waitFor(() => expect(service.getStatus({ managementAllowed: true, remoteRequest: false }).phase).toBe("inactive"));
    expect(edge.open).toBe(false);
    expect(events.map((event) => event.event)).toEqual(["session.starting", "session.active", "session.degraded", "session.reconnected", "session.expired"]);
    expect(clock.pendingCount()).toBe(0);
  });

  it("fails closed when the probe never reaches the app, and closes the tunnel", async () => {
    const { edge, local, service, markers } = setup();
    edge.url = "https://scoreboard-test.ngrok-free.app";
    // A probe answered by something else (say, ngrok's warning page) must not count.
    const broken = new RemoteAccessService({
      store: createMemorySecretStore({ authtoken: token, source: "file" }),
      provider: edge,
      markers,
      probe: async () => 204
    });
    await expect(broken.start(120)).rejects.toMatchObject({ code: "REMOTE_ACCESS_PROBE_FAILED" });
    expect(edge.open).toBe(false);
    expect(broken.getStatus({ managementAllowed: true, remoteRequest: false })).toMatchObject({ phase: "failed", credentials: null, url: null });
    expect(markers.match("x".repeat(43))).toBeNull();

    // A failed start can simply be retried.
    expect((await start(local)).statusCode).toBe(201);
    expect(service.getStatus({ managementAllowed: true, remoteRequest: false }).phase).toBe("active");
  });

  it("rejects an unsafe public URL", async () => {
    const { edge, local } = setup();
    for (const url of ["http://scoreboard-test.ngrok-free.app", "https://user:pass@scoreboard-test.ngrok-free.app", "https://x.ngrok-free.app/path", null]) {
      edge.url = url;
      const response = await start(local);
      expect(response.statusCode, String(url)).toBe(502);
      expect(response.json()).toMatchObject({ code: "REMOTE_ACCESS_PUBLIC_URL_INVALID" });
      expect(edge.open).toBe(false);
    }
  });

  it("reports provider failures with stable, secret-free messages", async () => {
    const { edge, local } = setup();
    edge.openError = classifyProviderError(new Error(`ERR_NGROK_105 authentication failed for ${token}`), "open");
    const response = await start(local);
    expect(response.json()).toMatchObject({ code: "REMOTE_ACCESS_TOKEN_INVALID" });
    expect(response.body).not.toContain(token);
  });

  it("validates start requests and preconditions", async () => {
    const unconfigured = setup({ configured: false });
    expect((await start(unconfigured.local)).json()).toMatchObject({ code: "REMOTE_ACCESS_NOT_CONFIGURED" });

    const { local, app } = setup();
    expect((await start(local, 90)).json()).toMatchObject({ code: "REMOTE_ACCESS_INVALID_DURATION" });
    expect((await local("POST", "/api/remote-access/start", { durationMinutes: 120 })).json()).toMatchObject({ code: "REMOTE_ACCESS_INVALID_REQUEST" });
    const lan = await app.inject({
      method: "POST",
      url: "/api/remote-access/start",
      remoteAddress: "192.168.1.20",
      headers: { host: "192.168.1.5:3000" },
      payload: { durationMinutes: 120, confirmation: "START_REMOTE_ACCESS" }
    });
    expect(lan.statusCode).toBe(403);

    expect((await start(local)).statusCode).toBe(201);
    expect((await start(local)).json()).toMatchObject({ code: "REMOTE_ACCESS_ALREADY_ACTIVE" });
    expect((await local("PUT", "/api/remote-access/configuration", { authtoken: token, confirmation: "SAVE_AND_TEST_NGROK" })).json()).toMatchObject({
      code: "REMOTE_ACCESS_BUSY"
    });
  });

  it("keeps refusing traffic and allows retry when the tunnel will not close", async () => {
    const { edge, local } = setup();
    const status = (await start(local)).json() as LocalRemoteAccessStatus;
    edge.failClose = true;
    const failed = await local("POST", "/api/remote-access/stop", { confirmation: "STOP_REMOTE_ACCESS" });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ code: "REMOTE_ACCESS_STOP_FAILED" });
    expect((await edge.request({ url: "/api/settings", auth: basic(status) })).statusCode).toBe(403);
    expect((await local("GET", "/api/remote-access/status")).json()).toMatchObject({ phase: "failed", credentials: null });
    expect((await start(local)).json()).toMatchObject({ code: "REMOTE_ACCESS_BUSY" });

    edge.failClose = false;
    expect((await local("POST", "/api/remote-access/stop", { confirmation: "STOP_REMOTE_ACCESS" })).json()).toMatchObject({ phase: "inactive" });
    expect(edge.open).toBe(false);
  });

  it("shuts down promptly even when the tunnel hangs, and never comes back", async () => {
    const { edge, local, service } = setup();
    await start(local);
    edge.openTunnel = edge.openTunnel.bind(edge);
    const hang = new Promise<void>(() => {});
    const tunnelClose = vi.fn(() => hang);
    // Swap the live tunnel's close for one that never settles.
    (service as unknown as { session: { tunnel: RemoteTunnel } }).session.tunnel.close = tunnelClose;
    const began = Date.now();
    await service.shutdown();
    expect(Date.now() - began).toBeLessThan(4_000);
    expect(edge.disconnectAll).toHaveBeenCalled();
    expect(service.getStatus({ managementAllowed: true, remoteRequest: false })).toMatchObject({ phase: "inactive", credentials: null });
    await expect(service.start(120)).rejects.toBeInstanceOf(RemoteAccessFailure);
  }, 10_000);

  it("only answers the probe for the provisional session through ngrok", async () => {
    const { app } = setup();
    const probe = await app.inject({ method: "GET", url: "/api/remote-access/probe", headers: { host: "localhost:3000" } });
    expect(probe.statusCode).toBe(404);
  });
});

describe("traffic policy", () => {
  it("authenticates, refuses machine-lifecycle changes, then marks, within the free plan", () => {
    const secrets = generateSessionSecrets();
    const text = buildTrafficPolicy(secrets);
    const policy = JSON.parse(text) as Policy;
    expect(policy.on_http_request.map((rule) => rule.actions.map((action) => action.type))).toEqual([["basic-auth"], ["deny"], ["add-headers"]]);
    expect(policy.on_http_request.length).toBeLessThanOrEqual(5);
    expect(policy.on_http_request[0].actions[0].config).toEqual({
      realm: "PBResults Scoreboard",
      credentials: [`${secrets.username}:${secrets.password}`],
      enforce: true
    });
    const expression = policy.on_http_request[1].expressions![0];
    for (const route of ["/api/remote-access/", "/api/update/", "/api/backups/config", "/api/app/import", "/restore"]) {
      expect(expression).toContain(route);
    }
    expect(policy.on_http_request[2].actions[0].config).toEqual({ headers: { [REMOTE_SESSION_MARKER_HEADER]: secrets.marker } });
    expect(text).not.toContain("${");
  });

  it("generates unique, policy-safe secrets", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const secrets = generateSessionSecrets();
      expect(secrets.username).toMatch(/^pbremote-[A-Za-z0-9_-]{8}$/);
      expect(secrets.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(secrets.marker).toMatch(/^[A-Za-z0-9_-]{43}$/);
      for (const value of [secrets.username, secrets.password, secrets.marker]) {
        expect(seen.has(value)).toBe(false);
        seen.add(value);
      }
    }
  });
});

describe("provider error classification", () => {
  it("never returns provider text", () => {
    const cases: Array<[string, "verify" | "open", string]> = [
      ["ERR_NGROK_105: The authtoken you specified is not valid", "verify", "REMOTE_ACCESS_TOKEN_INVALID"],
      ["ERR_NGROK_2201 traffic policy invalid", "open", "REMOTE_ACCESS_POLICY_REJECTED"],
      ["ERR_NGROK_108: simultaneous session limit", "open", "REMOTE_ACCESS_PROVIDER_UNAVAILABLE"],
      ["dns error: failed to lookup connect.ngrok-agent.com", "verify", "REMOTE_ACCESS_PROVIDER_UNAVAILABLE"]
    ];
    for (const [text, stage, code] of cases) {
      const failure = classifyProviderError(new Error(`${text} ${token}`), stage);
      expect(failure.code, text).toBe(code);
      expect(failure.message).not.toContain(token);
      expect(failure.message).not.toContain("ERR_NGROK");
    }
  });
});

describe("lifecycle log", () => {
  it("writes allowlisted fields only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-remote-log-"));
    tempRoots.push(root);
    const file = path.join(root, "logs", "remote-access.log");
    const log = createLifecycleLog(file, () => new Date("2026-10-05T12:00:00.000Z"));
    log({ event: "session.active", sessionId: "s1", phase: "active", startedAt: "a", expiresAt: "b", password: "secret" } as RemoteAccessLifecycleEvent);
    log({ event: "session.failed", sessionId: "s1", phase: "failed", errorCode: "REMOTE_ACCESS_PROBE_FAILED", reason: "startup-failure" });
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { at: "2026-10-05T12:00:00.000Z", event: "session.active", sessionId: "s1", phase: "active", startedAt: "a", expiresAt: "b" },
      { at: "2026-10-05T12:00:00.000Z", event: "session.failed", sessionId: "s1", phase: "failed", errorCode: "REMOTE_ACCESS_PROBE_FAILED", reason: "startup-failure" }
    ]);
  });
});
