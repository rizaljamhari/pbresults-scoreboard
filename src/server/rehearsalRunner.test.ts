import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinThemes } from "../shared/builtinThemes";
import { normalizeLiveState } from "../shared/normalize";
import { REHEARSAL_IDLE_STOP_MS, rehearsalReport, type RehearsalStatus } from "../shared/rehearsal";
import type { NormalizedLiveState, TeamRecord } from "../shared/theme";
import { REHEARSAL_CASE_COUNT } from "../shared/rehearsalCases";
import { LiveGate } from "./liveGate";
import { RehearsalRefusedError, RehearsalRunner } from "./rehearsalRunner";

function team(id: string, name: string, logo: string | null): TeamRecord {
  return {
    id,
    canonicalName: name,
    scoreboardDisplayName: name.toUpperCase(),
    shortName: id.toUpperCase(),
    aliases: [],
    liveMatchNames: [],
    logoAssetId: logo,
    alternateLogoAssetId: null,
    notes: "",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

const teams = [team("kuda", "Kuda", "a"), team("saus", "Sausage", "b"), team("anarki", "Anarki", null), team("beruang", "Beruang", "c")];

function feed(state: string, sourceStatus: "ok" | "error" | "paused" = "ok"): NormalizedLiveState {
  return normalizeLiveState({ state, period: "GAME", mainGame: [{ name: "REAL LEFT", score: 7 }, { name: "REAL RIGHT", score: 6 }] }, { sourceStatus, fetchedAt: new Date().toISOString() });
}

let feedState: NormalizedLiveState;
let published: NormalizedLiveState[];
let statuses: RehearsalStatus[];
let gate: LiveGate;
let runner: RehearsalRunner;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T10:00:00.000Z"));
  feedState = feed("STOPPED");
  published = [];
  statuses = [];
  gate = new LiveGate(() => feedState, (state) => published.push(state));
  runner = new RehearsalRunner({
    gate,
    getFeedState: () => feedState,
    getContext: () => ({ theme: structuredClone(builtinThemes[0]), teams, assets: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
    onChange: (status) => statuses.push(status)
  });
});

afterEach(() => {
  runner.dispose();
  vi.useRealTimers();
});

const last = () => published[published.length - 1];

describe("starting", () => {
  it("refuses while a real match is running", () => {
    feedState = feed("RUNNING");
    expect(() => runner.start()).toThrow(RehearsalRefusedError);
    feedState = feed("TOWEL1");
    expect(() => runner.start()).toThrow(RehearsalRefusedError);
    expect(published).toHaveLength(0);
  });

  it("is allowed when the feed is down even if it last said running", () => {
    feedState = feed("RUNNING", "error");
    expect(runner.start().phase).toBe("running");
  });

  it("refuses with nothing on air", () => {
    runner = new RehearsalRunner({ gate, getFeedState: () => feedState, getContext: () => null, onChange: () => undefined });
    expect(() => runner.start()).toThrow(/No theme is on air/);
  });

  it("takes over what the overlay sees and joins instead of restarting", () => {
    const status = runner.start();
    expect(status.cases).toHaveLength(REHEARSAL_CASE_COUNT);
    expect(gate.source).toBe("rehearsal");
    expect(last().displayLeftTeam.name).not.toBe("REAL LEFT");
    runner.go("next");
    expect(runner.start().caseIndex).toBe(1);
  });
});

describe("while running", () => {
  it("keeps real feed updates off the overlay", () => {
    runner.start();
    const count = published.length;
    gate.feedChanged(feed("STOPPED"));
    expect(published).toHaveLength(count);
  });

  it("counts the clock down once a second", () => {
    runner.start();
    const startClock = last().gameTimer.value;
    vi.advanceTimersByTime(3_000);
    expect(last().gameTimer.value).toBe(startClock - 3);
  });

  it("plays a case's frames in order, and holds the last until moved on", () => {
    const status = runner.start();
    runner.go("timeout");
    expect(last().breakTimer.value).toBe(30);
    vi.advanceTimersByTime(2_000);
    expect(last().breakTimer.value).toBeGreaterThan(100);
    vi.advanceTimersByTime(60_000);
    expect(runner.getStatus().caseIndex).toBe(status.cases.findIndex((item) => item.id === "timeout"));
  });

  it("moves through cases by itself in auto-play and ends after the last", () => {
    runner.start({ autoPlay: true });
    vi.advanceTimersByTime(6_100);
    expect(runner.getStatus().caseIndex).toBe(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(runner.getStatus()).toMatchObject({ phase: "ended", stopReason: "finished" });
    expect(gate.source).toBe("feed");
  });

  it("records pass and issue marks with notes", () => {
    runner.start();
    runner.mark("normal", "pass");
    runner.mark("names-long", "issue", "Right name clips the score");
    expect(runner.getStatus().marks).toEqual({ normal: { result: "pass", note: "" }, "names-long": { result: "issue", note: "Right name clips the score" } });
  });
});

describe("stopping", () => {
  it("stops the moment a real match starts and puts the real feed back", () => {
    runner.start();
    feedState = feed("RUNNING");
    runner.onFeed(feedState);
    expect(runner.getStatus()).toMatchObject({ phase: "ended", stopReason: "match-started" });
    expect(last().displayLeftTeam.name).toBe("REAL LEFT");
  });

  it("stops after ten idle minutes", () => {
    runner.start();
    vi.advanceTimersByTime(REHEARSAL_IDLE_STOP_MS + 1);
    expect(runner.getStatus().stopReason).toBe("idle");
  });

  it("keeps marks after stopping, until dismissed", () => {
    runner.start();
    runner.mark("normal", "pass");
    runner.stop();
    expect(runner.getStatus()).toMatchObject({ phase: "ended", stopReason: "operator" });
    expect(runner.getStatus().marks.normal.result).toBe("pass");
    expect(runner.dismiss().phase).toBe("idle");
  });

  it("does nothing to the screen when stopped twice", () => {
    runner.start();
    runner.stop();
    const count = published.length;
    runner.stop();
    expect(published).toHaveLength(count);
  });
});

describe("report", () => {
  it("lists issues with their notes and expectations", () => {
    runner.start();
    runner.mark("normal", "pass");
    runner.mark("names-long", "issue", "Right name clips the score");
    const report = rehearsalReport(runner.getStatus(), new Date("2026-10-02T10:00:00.000Z"));
    expect(report).toContain(`1 passed · 1 issue · ${REHEARSAL_CASE_COUNT - 2} not marked`);
    expect(report).toContain("3. Names · Long names — Right name clips the score");
    expect(report).toContain("Expected: Names never overlap the score.");
  });
});
