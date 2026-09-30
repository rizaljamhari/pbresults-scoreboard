import { describe, expect, it } from "vitest";
import { defaultSettings, type NormalizedLiveState } from "../../shared/theme";
import { liveSummary } from "./liveSummary";

const now = Date.parse("2026-09-30T10:00:10.000Z");
const theme = { id: "theme-a", name: "APM Invitational" };

function live(overrides: Partial<NormalizedLiveState> = {}): NormalizedLiveState {
  return {
    sourceStatus: "ok",
    fetchedAt: "2026-09-30T10:00:09.000Z",
    unresolvedTeamNames: [],
    ...overrides
  } as NormalizedLiveState;
}

describe("liveSummary", () => {
  it("waits when there is no feed data yet", () => {
    expect(liveSummary(null, defaultSettings, theme, now)).toMatchObject({ tone: "warning", stateLabel: "Waiting for the feed" });
  });

  it("puts an unreachable feed first", () => {
    expect(liveSummary(live({ sourceStatus: "error" }), defaultSettings, null, now)).toMatchObject({
      tone: "critical",
      feedTone: "critical",
      stateLabel: "Live feed unreachable"
    });
  });

  it("flags a missing theme on air", () => {
    expect(liveSummary(live(), defaultSettings, null, now)).toMatchObject({ tone: "critical", stateLabel: "No theme on air" });
  });

  it("flags stopped polling and stale data", () => {
    expect(liveSummary(live({ sourceStatus: "paused" }), defaultSettings, theme, now).stateLabel).toBe("Polling is stopped");
    expect(liveSummary(live({ fetchedAt: "2026-09-30T09:59:00.000Z" }), defaultSettings, theme, now)).toMatchObject({
      tone: "warning",
      feedTone: "warning",
      stateLabel: "Feed data is out of date"
    });
  });

  it("counts team names that need a team", () => {
    expect(liveSummary(live({ unresolvedTeamNames: ["SGS"] }), defaultSettings, theme, now).stateLabel).toBe("1 team name needs a team");
    expect(liveSummary(live({ unresolvedTeamNames: ["SGS", "EJPC"] }), defaultSettings, theme, now).stateLabel).toBe(
      "2 team names need a team"
    );
  });

  it("reports all clear with the feed age", () => {
    expect(liveSummary(live(), defaultSettings, theme, now)).toMatchObject({
      tone: "ok",
      feedTone: "live",
      feedLabel: "Live · just now",
      stateLabel: "All checks clear"
    });
  });
});
