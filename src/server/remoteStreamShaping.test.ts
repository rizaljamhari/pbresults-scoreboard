import { describe, expect, it } from "vitest";
import { normalizeLiveState } from "../shared/normalize";
import { formatAppEventFrame } from "./appEventHub";
import { acceptsGzip, createRemoteLiveStateFilter } from "./remoteStreamShaping";

function liveFrame(fetchedAt: string, sourceStatus: "ok" | "error" = "ok") {
  const state = normalizeLiveState(null, { sourceStatus, fetchedAt, errorMessage: null });
  return formatAppEventFrame({ protocol: 1, instanceId: "i", sequence: 1, occurredAt: fetchedAt, type: "live.state", state });
}

describe("remote stream shaping", () => {
  it("reads Accept-Encoding, honouring q=0", () => {
    expect(acceptsGzip("gzip, deflate, br")).toBe(true);
    expect(acceptsGzip("br;q=1.0, gzip;q=0.8")).toBe(true);
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip("identity")).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });

  it("sends each real change at once and repeats an unchanged state only for freshness", () => {
    let now = 0;
    const filter = createRemoteLiveStateFilter({ now: () => now, freshnessMs: 2_000 });
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

  it("never holds back other kinds of frames", () => {
    const filter = createRemoteLiveStateFilter({ now: () => 0 });
    const changed = formatAppEventFrame({ protocol: 1, instanceId: "i", sequence: 2, occurredAt: "x", type: "settings.changed", revision: 1 });
    expect(filter(changed)).toBe(true);
    expect(filter(changed)).toBe(true);
    expect(filter(": heartbeat\n\n")).toBe(true);
  });
});
