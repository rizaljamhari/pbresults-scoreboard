import { describe, expect, it } from "vitest";
import { defaultManualMatchState, type ManualMatchAction, type ManualMatchState } from "../shared/manualMatch";
import type { NormalizedLiveState, TeamRecord } from "../shared/theme";
import { ManualActionError, ManualMatchEngine, applyManualAction, clockSeconds, manualToLiveState, manualToRaw } from "./manualMatch";

function team(id: string, name: string): TeamRecord {
  return {
    id,
    canonicalName: name,
    scoreboardDisplayName: name.toUpperCase(),
    shortName: "",
    aliases: [],
    liveMatchNames: [],
    logoAssetId: null,
    alternateLogoAssetId: null,
    notes: "",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

const teams = [team("kuda", "Kuda"), team("saus", "Sausage")];
const settings = { manualGameClockSeconds: 600, manualBreakClockSeconds: 120 };
const T0 = Date.parse("2026-10-16T10:00:00.000Z");

function run(actions: Array<[number, ManualMatchAction]>, start: ManualMatchState = defaultManualMatchState) {
  return actions.reduce((state, [at, action]) => applyManualAction(state, action, at, settings), start);
}

describe("manual match actions", () => {
  it("counts the game clock down from its start time and stops it where it was", () => {
    const state = run([
      [T0, { type: "startGameClock" }],
      [T0 + 30_000, { type: "stopGameClock" }]
    ]);
    expect(state.phase).toBe("game");
    expect(state.gameClock).toEqual({ remainingMs: 570_000, runningSince: null });
    // Stopped: time passing changes nothing.
    expect(clockSeconds(state.gameClock, T0 + 120_000)).toBe(570);
  });

  it("shows a countdown's partial second as the higher second, and stops at zero", () => {
    const state = run([
      [T0, { type: "setGameClock", seconds: 10 }],
      [T0, { type: "startGameClock" }]
    ]);
    expect(manualToRaw(state, teams, T0 + 800).gameTimer).toEqual({ value: 10, state: 2 });
    expect(manualToRaw(state, teams, T0 + 1_200).gameTimer).toEqual({ value: 9, state: 2 });
    // A clock that ran out reads as stopped, so the match no longer shows as running.
    const out = manualToRaw(state, teams, T0 + 60_000);
    expect(out.gameTimer).toEqual({ value: 0, state: 0 });
    expect(out.state).toBe("STOPPED");
  });

  it("refuses to start a clock at zero", () => {
    const state = run([[T0, { type: "setGameClock", seconds: 0 }]]);
    expect(() => applyManualAction(state, { type: "startGameClock" }, T0, settings)).toThrow(ManualActionError);
  });

  it("never takes a score below zero, and records nothing for a no-op", () => {
    const state = run([[T0, { type: "adjustScore", side: "left", delta: -1 }]]);
    expect(state).toBe(defaultManualMatchState);
    const scored = run([
      [T0, { type: "adjustScore", side: "right", delta: 1 }],
      [T0, { type: "adjustScore", side: "right", delta: 1 }]
    ]);
    expect(scored.right.score).toBe(2);
    expect(scored.history.map((entry) => entry.label)).toEqual(["Right +1", "Right +1"]);
  });

  it("undoes the last action, clocks included", () => {
    const running = run([[T0, { type: "startGameClock" }]]);
    const stopped = applyManualAction(running, { type: "stopGameClock" }, T0 + 5_000, settings);
    const undone = applyManualAction(stopped, { type: "undo" }, T0 + 10_000, settings);
    // Back to running since T0, as if the stop never happened.
    expect(undone.gameClock).toEqual(running.gameClock);
    expect(clockSeconds(undone.gameClock, T0 + 10_000)).toBe(590);
    expect(undone.history).toHaveLength(1);
    expect(() => applyManualAction(defaultManualMatchState, { type: "undo" }, T0, settings)).toThrow("Nothing to undo");
  });

  it("keeps the undo stack bounded", () => {
    const actions = Array.from({ length: 40 }, (_, index) => [T0 + index, { type: "adjustScore", side: "left", delta: 1 }] as [number, ManualMatchAction]);
    expect(run(actions).history).toHaveLength(30);
  });

  it("starting a break stops play; starting play ends the break", () => {
    const inBreak = run([
      [T0, { type: "startGameClock" }],
      [T0 + 10_000, { type: "startBreak" }]
    ]);
    expect(inBreak.phase).toBe("break");
    expect(inBreak.gameClock.runningSince).toBeNull();
    expect(manualToRaw(inBreak, teams, T0 + 20_000)).toMatchObject({ period: "BREAK", state: "STOPPED", breakTimer: { value: 110, state: 2 } });

    const playing = applyManualAction(inBreak, { type: "startGameClock" }, T0 + 20_000, settings);
    expect(playing.phase).toBe("game");
    expect(playing.breakClock).toEqual({ remainingMs: 110_000, runningSince: null });
  });

  it("a timeout adds to the running break clock, so the overlay sees it jump up", () => {
    const state = run([
      [T0, { type: "startBreak", seconds: 30 }],
      [T0 + 10_000, { type: "addBreakTime", seconds: 60 }]
    ]);
    expect(manualToRaw(state, teams, T0 + 10_000).breakTimer).toEqual({ value: 80, state: 2 });
  });

  it("a timeout during play starts a break of that length", () => {
    const state = run([
      [T0, { type: "startGameClock" }],
      [T0 + 5_000, { type: "addBreakTime", seconds: 60 }]
    ]);
    expect(state.phase).toBe("break");
    expect(manualToRaw(state, teams, T0 + 5_000)).toMatchObject({ period: "BREAK", gameTimer: { value: 595, state: 0 }, breakTimer: { value: 60, state: 2 } });
  });

  it("pauses and resumes a break", () => {
    const paused = run([
      [T0, { type: "startBreak", seconds: 60 }],
      [T0 + 20_000, { type: "stopBreak" }]
    ]);
    const resumed = applyManualAction(paused, { type: "startBreak" }, T0 + 50_000, settings);
    expect(clockSeconds(resumed.breakClock, T0 + 60_000)).toBe(30);
    expect(resumed.history.at(-1)?.label).toBe("Resume break");
  });

  it("finishing sends END in BREAK, which fires the game-finished and winner cards, and stays finished through the break", () => {
    const state = run([
      [T0, { type: "startGameClock" }],
      [T0, { type: "adjustScore", side: "left", delta: 1 }],
      [T0 + 1_000, { type: "finishMatch" }],
      [T0 + 2_000, { type: "startBreak" }]
    ]);
    expect(state.phase).toBe("finished");
    expect(manualToRaw(state, teams, T0 + 3_000)).toMatchObject({ state: "END", period: "BREAK", breakTimer: { state: 2 } });
  });

  it("maps towel and base events to the PBResults codes for the right side, then clears them", () => {
    const at = (kind: "towel" | "base", side: "left" | "right") => {
      const state = run([[T0, { type: "teamEvent", kind, side }]]);
      return [manualToLiveState(state, teams, T0 + 1_000).teamEvent, manualToLiveState(state, teams, T0 + 5_000).teamEvent];
    };
    expect(at("towel", "left")).toEqual(["towel-home", "none"]);
    expect(at("towel", "right")).toEqual(["towel-away", "none"]);
    expect(at("base", "left")).toEqual(["base-home", "none"]);
    expect(at("base", "right")).toEqual(["base-away", "none"]);
  });

  it("next match clears scores, moves the round on and keeps the teams", () => {
    const state = run([
      [T0, { type: "setTeam", side: "left", teamId: "kuda", name: "" }],
      [T0, { type: "adjustScore", side: "left", delta: 3 }],
      [T0, { type: "setGameClock", seconds: 12 }],
      [T0, { type: "finishMatch" }],
      [T0, { type: "nextMatch" }]
    ]);
    expect(state).toMatchObject({ round: 2, phase: "idle", left: { teamId: "kuda", score: 0 }, gameClock: { remainingMs: 600_000, runningSince: null } });
  });
});

describe("manual match as live state", () => {
  it("resolves chosen registry teams by hand, with their scoreboard names", () => {
    const state = run([
      [T0, { type: "setTeam", side: "left", teamId: "kuda", name: "" }],
      [T0, { type: "setTeam", side: "right", teamId: null, name: "Guests" }]
    ]);
    const live = manualToLiveState(state, teams, T0);
    expect(live.source).toBe("manual");
    expect(live.sourceStatus).toBe("ok");
    expect(live.displayLeftTeam.name).toBe("KUDA");
    expect(live.displayLeftTeamMatch).toMatchObject({ status: "matched", resolutionSource: "manual", teamId: "kuda" });
    expect(live.displayRightTeam.name).toBe("Guests");
    expect(live.unresolvedTeamNames).toEqual([]);
    expect(live.secondGame).toBe(false);
  });

  it("falls back to the typed name when a chosen team was deleted", () => {
    const state = run([[T0, { type: "setTeam", side: "left", teamId: "gone", name: "" }]]);
    expect(manualToLiveState(state, teams, T0).displayLeftTeam.name).toBe("");
  });
});

describe("ManualMatchEngine", () => {
  function engine(start: ManualMatchState = defaultManualMatchState) {
    let saved = start;
    let now = T0;
    const published: NormalizedLiveState[] = [];
    const instance = new ManualMatchEngine({
      load: () => saved,
      save: (next) => (saved = next),
      getTeams: () => teams,
      getSettings: () => settings,
      now: () => now
    });
    instance.subscribe((state) => published.push(state));
    return {
      instance,
      published,
      saved: () => saved,
      advance: (ms: number) => {
        now += ms;
        (instance as unknown as { tick: () => void }).tick();
      }
    };
  }

  it("saves each action and publishes the new state at once", () => {
    const { instance, published, saved } = engine();
    const view = instance.apply({ type: "adjustScore", side: "left", delta: 1 });
    expect(view).toMatchObject({ left: { score: 1 }, undoLabel: "Left +1" });
    expect(saved().left.score).toBe(1);
    expect(published.at(-1)?.displayLeftTeam.score).toBe(1);
  });

  it("publishes when a clock second changes, and otherwise only as a heartbeat", () => {
    const { instance, published, advance } = engine();
    instance.apply({ type: "startGameClock" });
    const count = published.length;
    advance(250);
    expect(published).toHaveLength(count);
    advance(800);
    expect(published).toHaveLength(count + 1);
    expect(published.at(-1)?.gameTimer.value).toBe(599);
  });

  it("restores a running clock from the saved start time after a restart", () => {
    const first = engine();
    first.instance.apply({ type: "startGameClock" });
    const restarted = new ManualMatchEngine({
      load: first.saved,
      save: (next) => next,
      getTeams: () => teams,
      getSettings: () => settings,
      now: () => T0 + 65_000
    });
    expect(restarted.getState().gameTimer).toEqual({ value: 535, state: 2 });
  });
});
