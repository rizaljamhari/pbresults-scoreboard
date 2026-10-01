import { describe, expect, it } from "vitest";
import { defaultSettings, type NormalizedLiveState } from "../../shared/theme";
import type { OverlaySummary } from "../../shared/overlayHealth";
import { liveSummary, overlayDot } from "./liveSummary";

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

  describe("with the overlay", () => {
    const lost: OverlaySummary = {
      level: "critical",
      code: "lost",
      label: "Lost · 12 s ago",
      chip: "Live overlay lost 12 s ago",
      check: { title: "Live overlay lost", detail: "", fix: "", showUrl: false },
      liveCount: 0
    };
    const behind: OverlaySummary = { ...lost, level: "warning", code: "behind", label: "Behind · 9 s", check: { ...lost.check!, title: "Overlay is behind the feed" } };

    it("still leads with an unreachable feed", () => {
      expect(liveSummary(live({ sourceStatus: "error" }), defaultSettings, theme, now, lost).stateLabel).toBe("Live feed unreachable");
    });

    it("puts a lost overlay ahead of everything else", () => {
      expect(liveSummary(live({ unresolvedTeamNames: ["SGS"] }), defaultSettings, null, now, lost)).toMatchObject({
        tone: "critical",
        stateLabel: "Live overlay lost"
      });
    });

    it("ranks an overlay warning above team names", () => {
      expect(liveSummary(live({ unresolvedTeamNames: ["SGS"] }), defaultSettings, theme, now, behind).stateLabel).toBe("Overlay is behind the feed");
    });

    it("gives the sidebar line a dot and label", () => {
      expect(overlayDot(lost)).toEqual({ tone: "critical", label: "Lost · 12 s ago" });
      expect(overlayDot(null)).toEqual({ tone: undefined, label: "Checking…" });
    });
  });
});
