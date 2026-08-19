import { describe, expect, it } from "vitest";
import { normalizeLiveState } from "./normalize";
import {
  appChangedEventSchema,
  appEventSchema,
  appEventSnapshotSchema,
  appEventTypeToDomain,
  appRealtimeEventSchema,
  parseAppEventMessage
} from "./appEvents";

const common = {
  protocol: 1 as const,
  instanceId: "instance-1",
  sequence: 3,
  occurredAt: "2026-08-19T05:00:00.000Z"
};
const liveState = normalizeLiveState(null, { sourceStatus: "idle", fetchedAt: null, errorMessage: null });
const operatorTextState = { themeId: null, fields: [] };

describe("app event contracts", () => {
  it("parses a runtime and revision snapshot", () => {
    const parsed = appEventSnapshotSchema.parse({
      ...common,
      type: "system.snapshot",
      revisions: { settings: 1, themes: 2, assets: 3, teams: 4 },
      runtime: { appVersion: "1.8.0", releaseTag: "v1.8.0" },
      liveState,
      operatorTextState
    });

    expect(parsed.revisions.assets).toBe(3);
    expect(parsed.liveState?.sourceStatus).toBe("idle");
    expect(parsed.operatorTextState).toEqual(operatorTextState);
    expect(appEventSchema.parse(parsed)).toEqual(parsed);
  });

  it("parses live and operator state events without resource revisions", () => {
    const live = appRealtimeEventSchema.parse({ ...common, type: "live.state", state: liveState });
    const operator = appRealtimeEventSchema.parse({ ...common, sequence: 4, type: "operator-text.state", state: operatorTextState });

    expect(live.type).toBe("live.state");
    expect("revision" in live).toBe(false);
    expect(operator.type).toBe("operator-text.state");
    expect(parseAppEventMessage("live.state", JSON.stringify(live))).toEqual(live);
    expect(parseAppEventMessage("operator-text.state", JSON.stringify(live))).toBeNull();
  });

  it.each([
    ["settings.changed", "settings"],
    ["themes.changed", "themes"],
    ["theme.published", "settings"],
    ["assets.changed", "assets"],
    ["teams.changed", "teams"]
  ] as const)("maps %s to the %s revision domain", (type, domain) => {
    const parsed = appChangedEventSchema.parse({ ...common, type, revision: 1, resourceIds: ["resource-1"] });
    expect(appEventTypeToDomain[parsed.type]).toBe(domain);
  });

  it("rejects unsupported protocols and oversized resource id lists", () => {
    expect(() =>
      appEventSchema.parse({
        ...common,
        protocol: 2,
        type: "settings.changed",
        revision: 1
      })
    ).toThrow();

    expect(() =>
      appChangedEventSchema.parse({
        ...common,
        type: "assets.changed",
        revision: 1,
        resourceIds: Array.from({ length: 101 }, (_, index) => `asset-${index}`)
      })
    ).toThrow();
  });

  it("rejects malformed messages and SSE names that disagree with the JSON type", () => {
    const payload = JSON.stringify({ ...common, type: "themes.changed", revision: 1 });
    expect(parseAppEventMessage("themes.changed", payload)?.type).toBe("themes.changed");
    expect(parseAppEventMessage("settings.changed", payload)).toBeNull();
    expect(parseAppEventMessage("themes.changed", "not-json")).toBeNull();
  });
});
