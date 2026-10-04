import { describe, expect, it } from "vitest";
import { normalizeLiveState } from "../shared/normalize";
import type { OverlayState } from "../shared/overlayHealth";
import { formatAppEventFrame } from "./appEventHub";
import { createRemoteFrameFilter } from "./remoteStreamShaping";

function liveFrame(fetchedAt: string, sourceStatus: "ok" | "error" = "ok") {
  const state = normalizeLiveState(null, { sourceStatus, fetchedAt, errorMessage: null });
  return formatAppEventFrame({ protocol: 1, instanceId: "i", sequence: 1, occurredAt: fetchedAt, type: "live.state", state });
}

function overlayFrame(lastSeenAt: string, connection: "connected" | "stale" = "connected", lagMs = 100) {
  const state: OverlayState = {
    serverStartedAt: "2026-10-05T00:00:00.000Z",
    generatedAt: lastSeenAt,
    clients: [
      {
        clientId: "overlay-1",
        page: "live",
        remoteAddress: "127.0.0.1",
        local: true,
        userAgent: "vMix",
        browser: "Chromium",
        firstSeenAt: "2026-10-05T00:00:00.000Z",
        lastSeenAt,
        streamOpen: true,
        connection,
        report: null,
        lagMs,
        issues: [],
        themeName: null
      }
    ]
  };
  return formatAppEventFrame({ protocol: 1, instanceId: "i", sequence: 2, occurredAt: lastSeenAt, type: "overlay.state", state });
}

describe("remote stream shaping", () => {
  it("sends each real live change at once and repeats an unchanged state only for freshness", () => {
    let now = 0;
    const filter = createRemoteFrameFilter({ now: () => now });
    expect(filter(liveFrame("2026-10-05T00:00:00.000Z"))).toBe(true);
    now = 500;
    expect(filter(liveFrame("2026-10-05T00:00:00.500Z"))).toBe(false);
    now = 1_000;
    // Something real changed: through immediately, however recent the last one was.
    expect(filter(liveFrame("2026-10-05T00:00:01.000Z", "error"))).toBe(true);
    now = 1_500;
    expect(filter(liveFrame("2026-10-05T00:00:01.500Z", "error"))).toBe(false);
    now = 3_000;
    expect(filter(liveFrame("2026-10-05T00:00:03.000Z", "error"))).toBe(true);
  });

  it("resends overlay health only when a verdict changes, or every 15 seconds", () => {
    let now = 0;
    const filter = createRemoteFrameFilter({ now: () => now });
    expect(filter(overlayFrame("2026-10-05T00:00:00.000Z"))).toBe(true);
    now = 5_000;
    // Only the last-seen time and lag moved.
    expect(filter(overlayFrame("2026-10-05T00:00:05.000Z", "connected", 180))).toBe(false);
    now = 6_000;
    expect(filter(overlayFrame("2026-10-05T00:00:06.000Z", "stale"))).toBe(true);
    now = 10_000;
    expect(filter(overlayFrame("2026-10-05T00:00:10.000Z", "stale"))).toBe(false);
    now = 21_000;
    expect(filter(overlayFrame("2026-10-05T00:00:21.000Z", "stale"))).toBe(true);
  });

  it("keeps live and overlay updates independent, and never holds back other frames", () => {
    const filter = createRemoteFrameFilter({ now: () => 0 });
    expect(filter(liveFrame("2026-10-05T00:00:00.000Z"))).toBe(true);
    expect(filter(overlayFrame("2026-10-05T00:00:00.000Z"))).toBe(true);
    const changed = formatAppEventFrame({ protocol: 1, instanceId: "i", sequence: 3, occurredAt: "x", type: "settings.changed", revision: 1 });
    expect(filter(changed)).toBe(true);
    expect(filter(changed)).toBe(true);
    expect(filter(": heartbeat\n\n")).toBe(true);
  });
});
