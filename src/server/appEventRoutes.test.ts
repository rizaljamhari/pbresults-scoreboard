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

describe("event stream shaping", () => {
  async function openShapingApp() {
    const app = Fastify({ logger: false });
    const hub = new AppEventHub({ instanceId: "shape-instance" });
    apps.push(app);
    hubs.push(hub);
    app.decorateRequest("remoteAccess", null);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-test-remote"]) request.remoteAccess = { kind: "ngrok", sessionId: "s", publicOrigin: "https://x.ngrok-free.app" };
    });
    registerAppEventRoutes(app, {
      hub,
      openStreams: new Set(),
      getRuntime: () => ({ appVersion: "1.8.0", releaseTag: "v1.8.0" }),
      getLiveState: () => normalizeLiveState(null, { sourceStatus: "idle", fetchedAt: null, errorMessage: null }),
      getOperatorTextState: () => ({ themeId: null, fields: [] }),
      trackRemoteStream: () => () => {}
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    return { hub, port };
  }

  /** Reads decoded stream text until `done` says so, or fails after `ms`. */
  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, done: (text: string) => boolean, ms = 1_000) {
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + ms;
    while (!done(text)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out; got: ${text.slice(-300)}`);
      const chunk = await Promise.race([reader.read(), new Promise<never>((_r, reject) => setTimeout(() => reject(new Error("timed out")), remaining))]);
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text;
  }

  const live = (fetchedAt: string, sourceStatus: "ok" | "error" = "ok") => normalizeLiveState(null, { sourceStatus, fetchedAt, errorMessage: null });
  const count = (text: string) => text.split("event: live.state").length - 1;

  it("leaves local streams untouched: no compression, every live state delivered", async () => {
    const { hub, port } = await openShapingApp();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { "accept-encoding": "gzip" } });
    expect(response.headers.get("content-encoding")).toBeNull();
    const reader = response.body!.getReader();
    await readUntil(reader, (text) => text.includes("system.snapshot"));
    for (let index = 0; index < 4; index += 1) hub.publishLiveState(live(`2026-10-05T00:00:0${index}.000Z`));
    const text = await readUntil(reader, (value) => count(value) >= 4);
    expect(count(text)).toBe(4);
    await reader.cancel();
  });

  it("compresses remote streams, thins unchanged states, and still delivers a real change at once", async () => {
    const { hub, port } = await openShapingApp();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { "x-test-remote": "1", "accept-encoding": "gzip" } });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    const reader = response.body!.getReader();
    await readUntil(reader, (text) => text.includes("system.snapshot"));

    hub.publishLiveState(live("2026-10-05T00:00:00.000Z"));
    hub.publishLiveState(live("2026-10-05T00:00:00.500Z"));
    hub.publishLiveState(live("2026-10-05T00:00:01.000Z"));
    const first = await readUntil(reader, (text) => count(text) >= 1, 500);
    expect(count(first)).toBe(1);

    const sentAt = Date.now();
    hub.publishLiveState(live("2026-10-05T00:00:01.500Z", "error"));
    const change = await readUntil(reader, (text) => text.includes('"sourceStatus":"error"'), 500);
    expect(change).toContain("event: live.state");
    // Flushed per frame: compression never holds an update back.
    expect(Date.now() - sentAt).toBeLessThan(250);
    await reader.cancel();
  });
});
