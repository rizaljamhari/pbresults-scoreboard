import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLiveState } from "../shared/normalize";
import { AppEventHub } from "./appEventHub";
import { registerAppEventRoutes } from "./appEventRoutes";

const apps: FastifyInstance[] = [];
const hubs: AppEventHub[] = [];

function setup(maxSubscribers = 100) {
  const app = Fastify({ logger: false });
  const hub = new AppEventHub({ instanceId: "route-instance", maxSubscribers });
  const openStreams = new Set<import("node:http").ServerResponse>();
  registerAppEventRoutes(app, {
    hub,
    openStreams,
    getRuntime: () => ({ appVersion: "1.8.0", releaseTag: "v1.8.0" }),
    getLiveState: () => normalizeLiveState(null, { sourceStatus: "idle", fetchedAt: null, errorMessage: null }),
    getOperatorTextState: () => ({ themeId: null, fields: [] })
  });
  apps.push(app);
  hubs.push(hub);
  return { app, hub, openStreams };
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.close();
  for (const app of apps.splice(0)) await app.close();
});

describe("application event route", () => {
  it("sends SSE headers and an immediate state snapshot, then cleans up", async () => {
    const { app, hub, openStreams } = setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events`, { signal: controller.signal });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const chunk = await reader!.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("retry: 2000");
    expect(text).toContain("event: system.snapshot");
    expect(text).toContain('"instanceId":"route-instance"');
    expect(text).toContain('"liveState"');
    expect(text).toContain('"operatorTextState"');
    expect(hub.getStats().connectedClients).toBe(1);
    expect(openStreams.size).toBe(1);

    hub.publishOperatorTextState({ themeId: null, fields: [] });
    const realtimeChunk = await reader!.read();
    const realtimeText = new TextDecoder().decode(realtimeChunk.value);
    expect(realtimeText).toContain("event: operator-text.state");

    controller.abort();
    await vi.waitFor(
      () => {
        expect(hub.getStats().connectedClients).toBe(0);
        expect(openStreams.size).toBe(0);
      },
      { timeout: 30_000 }
    );
  });

  it("rejects a connection before hijacking when capacity is exhausted", async () => {
    const { app, openStreams } = setup(0);
    const response = await app.inject({ method: "GET", url: "/api/events" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "EVENT_STREAM_CAPACITY" });
    expect(openStreams.size).toBe(0);
  });
});

describe("remote event streams", () => {
  it("reports streams opened through remote access, and can end them", async () => {
    const app = Fastify({ logger: false });
    const hub = new AppEventHub({ instanceId: "remote-instance" });
    apps.push(app);
    hubs.push(hub);
    app.decorateRequest("remoteAccess", null);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-test-remote"]) request.remoteAccess = { kind: "ngrok", sessionId: "session-9", publicOrigin: "https://x.ngrok-free.app" };
    });
    const release = vi.fn();
    let close: (() => void) | null = null;
    const trackRemoteStream = vi.fn((_sessionId: string, closeStream: () => void) => {
      close = closeStream;
      return release;
    });
    registerAppEventRoutes(app, {
      hub,
      openStreams: new Set(),
      getRuntime: () => ({ appVersion: "1.8.0", releaseTag: "v1.8.0" }),
      getLiveState: () => normalizeLiveState(null, { sourceStatus: "idle", fetchedAt: null, errorMessage: null }),
      getOperatorTextState: () => ({ themeId: null, fields: [] }),
      trackRemoteStream
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;

    const local = new AbortController();
    const localResponse = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: local.signal });
    await localResponse.body!.getReader().read();
    expect(trackRemoteStream).not.toHaveBeenCalled();
    local.abort();

    const remoteResponse = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { "x-test-remote": "1" } });
    const reader = remoteResponse.body!.getReader();
    await reader.read();
    expect(trackRemoteStream).toHaveBeenCalledWith("session-9", expect.any(Function));

    close!();
    await expect(
      (async () => {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return "ended";
        }
      })()
    ).rejects.toThrow();
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
    expect(hub.getStats().connectedClients).toBe(0);
  });
});
