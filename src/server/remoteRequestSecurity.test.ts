import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REMOTE_SESSION_MARKER_HEADER,
  RemoteSessionMarkers,
  isOnsiteManagementRequest,
  registerRemoteRequestBoundary
} from "./remoteRequestSecurity";

const marker = "A".repeat(22) + "b_-".repeat(7);
const otherMarker = "Z".repeat(43);
const publicOrigin = "https://example.ngrok-free.app";
const apps: FastifyInstance[] = [];

function setup(options: { confirmed?: boolean; active?: boolean; localOrigins?: Set<string> } = {}) {
  const app = Fastify({ logger: false });
  const markers = new RemoteSessionMarkers();
  if (options.active !== false) {
    markers.activate({ sessionId: "session-1", marker, publicOrigin: `${publicOrigin}/` });
    if (options.confirmed !== false) markers.confirm("session-1");
  }
  registerRemoteRequestBoundary(app, { markers, localOrigins: options.localOrigins });
  const handler = vi.fn((request: FastifyRequest) => ({
    remote: request.remoteAccess,
    authorization: request.headers.authorization ?? null
  }));
  app.get("/api/thing", handler);
  app.post("/api/thing", handler);
  app.get("/api/remote-access/probe", handler);
  app.get("/api/cached", async (_request, reply) => {
    reply.header("Cache-Control", "max-age=60");
    return { ok: true };
  });
  apps.push(app);
  return { app, markers, handler };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

const remoteHeaders = (extra: Record<string, string> = {}) => ({ [REMOTE_SESSION_MARKER_HEADER]: marker, host: "example.ngrok-free.app", ...extra });

describe("remote request classification", () => {
  it("leaves requests without a marker untouched", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: "/api/thing", headers: { authorization: "Basic local" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ remote: null, authorization: "Basic local" });
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("recognizes the active marker and strips Basic Auth before any handler", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: "/api/thing?x=1", headers: remoteHeaders({ authorization: "Basic c2VjcmV0" }) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ remote: { kind: "ngrok", sessionId: "session-1", publicOrigin }, authorization: null });
    expect(response.body).not.toContain(marker);
  });

  it("marks remote API responses no-store without overriding an explicit policy", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders() })).headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ method: "GET", url: "/api/cached", headers: remoteHeaders() })).headers["cache-control"]).toBe("max-age=60");
  });

  it("accepts a provisional marker only on the probe route", async () => {
    const { app, markers } = setup({ confirmed: false });
    expect((await app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders() })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/remote-access/probe", headers: remoteHeaders() })).statusCode).toBe(200);
    markers.confirm("other-session");
    expect((await app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders() })).statusCode).toBe(403);
    markers.confirm("session-1");
    expect((await app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders() })).statusCode).toBe(200);
  });

  it.each([
    ["empty", ""],
    ["unknown", otherMarker],
    ["malformed", "not a marker"],
    ["comma-joined", `${marker}, ${marker}`],
    ["truncated", marker.slice(0, 42)]
  ])("rejects a %s marker before routing", async (_label, value) => {
    const { app, handler } = setup();
    const response = await app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders({ [REMOTE_SESSION_MARKER_HEADER]: value }) });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "REMOTE_SESSION_INVALID" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects the marker once the session is cleared, and when none is active", async () => {
    const { app, markers } = setup();
    markers.clear();
    expect((await app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders() })).statusCode).toBe(403);
    const inactive = setup({ active: false });
    expect((await inactive.app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders() })).statusCode).toBe(403);
  });

  it("rejects a valid marker sent from a LAN address", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: "/api/thing", remoteAddress: "192.168.1.20", headers: remoteHeaders() });
    expect(response.statusCode).toBe(403);
  });

  it("rejects a repeated marker header, which ngrok produces when a client sends its own", async () => {
    const { app, handler } = setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port, path: "/api/thing", method: "GET", headers: ["host", `127.0.0.1:${port}`, REMOTE_SESSION_MARKER_HEADER, marker, REMOTE_SESSION_MARKER_HEADER, marker] },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        }
      );
      request.on("error", reject);
      request.end();
    });
    expect(status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("origin guard", () => {
  it("requires the tunnel's public origin on remote changes", async () => {
    const { app, handler } = setup();
    for (const origin of [undefined, "null", "https://evil.example", "http://example.ngrok-free.app", "not a url"]) {
      const headers = remoteHeaders(origin ? { origin } : {});
      const response = await app.inject({ method: "POST", url: "/api/thing", headers, payload: {} });
      expect(response.statusCode, String(origin)).toBe(403);
      expect(response.json()).toMatchObject({ code: "REMOTE_ACCESS_ORIGIN_REQUIRED" });
    }
    expect(handler).not.toHaveBeenCalled();
    const allowed = await app.inject({ method: "POST", url: "/api/thing", headers: remoteHeaders({ origin: publicOrigin }), payload: {} });
    expect(allowed.statusCode).toBe(200);
  });

  it("lets remote reads through without an Origin", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/api/thing", headers: remoteHeaders() })).statusCode).toBe(200);
  });

  it("keeps local tools without an Origin working and refuses other websites", async () => {
    const { app } = setup();
    const post = (headers: Record<string, string>, remoteAddress?: string) =>
      app.inject({ method: "POST", url: "/api/thing", headers, payload: {}, remoteAddress });

    expect((await post({ host: "localhost:3000" })).statusCode).toBe(200);
    expect((await post({ host: "localhost:3000", origin: "http://localhost:3000" })).statusCode).toBe(200);
    expect((await post({ host: "192.168.1.5:3000", origin: "http://192.168.1.5:3000" }, "192.168.1.20")).statusCode).toBe(200);

    for (const origin of ["https://evil.example", "http://localhost:5173", "null", "https://localhost:3000"]) {
      const response = await post({ host: "localhost:3000", origin });
      expect(response.statusCode, origin).toBe(403);
      expect(response.json()).toMatchObject({ code: "REMOTE_ACCESS_ORIGIN_REQUIRED" });
    }
  });

  it("accepts the dev client's origin only when configured, and never for remote requests", async () => {
    const devOrigin = "http://localhost:5173";
    const { app } = setup({ localOrigins: new Set([devOrigin]) });
    const viaProxy = await app.inject({ method: "POST", url: "/api/thing", headers: { host: "localhost:3000", origin: devOrigin }, payload: {} });
    expect(viaProxy.statusCode).toBe(200);
    const remote = await app.inject({ method: "POST", url: "/api/thing", headers: remoteHeaders({ origin: devOrigin }), payload: {} });
    expect(remote.statusCode).toBe(403);
  });
});

describe("onsite management predicate", () => {
  const ports = new Set([3000]);

  async function check(options: { headers?: Record<string, string>; remoteAddress?: string; active?: boolean } = {}) {
    const { app } = setup({ active: options.active ?? true });
    let result: boolean | null = null;
    app.get("/check", async (request) => {
      result = isOnsiteManagementRequest(request, ports);
      return {};
    });
    const response = await app.inject({ method: "GET", url: "/check", headers: options.headers ?? { host: "localhost:3000" }, remoteAddress: options.remoteAddress });
    return { status: response.statusCode, result };
  }

  it("accepts loopback requests addressed to localhost on the server port", async () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect((await check({ headers: { host } })).result, host).toBe(true);
    }
  });

  it("refuses LAN peers, other ports, rebinding hosts, and odd Host values", async () => {
    expect((await check({ remoteAddress: "192.168.1.20" })).result).toBe(false);
    for (const host of ["localhost:4000", "localhost:5173", "localhost", "evil.example:3000", "example.ngrok-free.app", "localhost:3000/x", "user@localhost:3000"]) {
      expect((await check({ headers: { host } })).result, host).toBe(false);
    }
  });

  it("refuses requests carrying forwarding headers", async () => {
    for (const name of ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]) {
      expect((await check({ headers: { host: "localhost:3000", [name]: "1.2.3.4" } })).result, name).toBe(false);
    }
  });

  it("refuses remote-access requests even though they arrive over loopback", async () => {
    const remote = await check({ headers: { host: "localhost:3000", [REMOTE_SESSION_MARKER_HEADER]: marker } });
    expect(remote).toEqual({ status: 200, result: false });
  });

  it("relies on Fastify leaving proxy trust off, so forwarded addresses are never believed", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.get("/ip", async (request) => ({ ip: request.ip }));
    const response = await app.inject({ method: "GET", url: "/ip", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(response.json()).toEqual({ ip: "127.0.0.1" });
  });
});
