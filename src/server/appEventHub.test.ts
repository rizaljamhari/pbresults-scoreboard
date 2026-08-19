import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLiveState } from "../shared/normalize";
import { AppEventHub, formatAppEventFrame } from "./appEventHub";

const runtime = { appVersion: "1.8.0", releaseTag: "v1.8.0" };
const hubs: AppEventHub[] = [];

function createHub(options: ConstructorParameters<typeof AppEventHub>[0] = {}) {
  const hub = new AppEventHub({ instanceId: "instance-1", now: () => new Date("2026-08-19T05:00:00.000Z"), ...options });
  hubs.push(hub);
  return hub;
}

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
  vi.useRealTimers();
});

describe("AppEventHub", () => {
  it("increments sequence and only the affected domain revision", () => {
    const hub = createHub();
    const published = hub.publish("theme.published", ["theme-1"]);
    const snapshot = hub.getSnapshot(runtime);

    expect(published).toMatchObject({ sequence: 1, revision: 1, resourceIds: ["theme-1"] });
    expect(snapshot.revisions).toEqual({ settings: 1, themes: 0, assets: 0, teams: 0 });
    expect(formatAppEventFrame(snapshot, 2000)).toContain("event: system.snapshot");
  });

  it("delivers to multiple clients and removes only a backpressured client", () => {
    const hub = createHub();
    const first: string[] = [];
    const second: string[] = [];
    hub.subscribe((frame) => {
      first.push(frame);
      return false;
    });
    hub.subscribe((frame) => {
      second.push(frame);
      return true;
    });

    hub.publish("assets.changed", ["asset-1", "asset-1"]);
    hub.publish("assets.changed", ["asset-2"]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(hub.getStats().connectedClients).toBe(1);
  });

  it("publishes live and operator state without changing resource revisions", () => {
    const hub = createHub();
    const frames: string[] = [];
    hub.subscribe((frame) => {
      frames.push(frame);
      return true;
    });

    const live = hub.publishLiveState(normalizeLiveState(null, { sourceStatus: "idle", fetchedAt: null, errorMessage: null }));
    const operator = hub.publishOperatorTextState({ themeId: null, fields: [] });
    const snapshot = hub.getSnapshot(runtime);

    expect(live).toMatchObject({ type: "live.state", sequence: 1 });
    expect(operator).toMatchObject({ type: "operator-text.state", sequence: 2 });
    expect(snapshot.revisions).toEqual({ settings: 0, themes: 0, assets: 0, teams: 0 });
    expect(frames[0]).toContain("event: live.state");
    expect(frames[1]).toContain("event: operator-text.state");
  });

  it("enforces capacity and makes unsubscribe idempotent", () => {
    const hub = createHub({ maxSubscribers: 1 });
    const unsubscribe = hub.subscribe(() => true);
    expect(unsubscribe).not.toBeNull();
    expect(hub.subscribe(() => true)).toBeNull();
    unsubscribe?.();
    unsubscribe?.();
    expect(hub.getStats().connectedClients).toBe(0);
  });

  it("emits heartbeats and stops them on close", () => {
    vi.useFakeTimers();
    const hub = createHub({ heartbeatIntervalMs: 1000 });
    const frames: string[] = [];
    hub.subscribe((frame) => {
      frames.push(frame);
      return true;
    });

    vi.advanceTimersByTime(1000);
    expect(frames).toEqual([": keep-alive 1787115600000\n\n"]);
    hub.close();
    vi.advanceTimersByTime(2000);
    expect(frames).toHaveLength(1);
  });
});
