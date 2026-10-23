import { describe, expect, it } from "vitest";
import { defaultManualMatchState, type ManualMatchAction, type ManualMatchState } from "../shared/manualMatch";
import type { NormalizedLiveState, TeamRecord } from "../shared/theme";
import { ManualActionError, ManualMatchEngine, applyManualAction, autoStartAfterBreak, clockSeconds, manualToLiveState, manualToRaw } from "./manualMatch";

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
const settings = { manualGameClockSeconds: 600, manualBreakClockSeconds: 120, manualAutoStartGameClock: true };
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

  it("sets and resets the break clock during a break only", () => {
    expect(() => applyManualAction(defaultManualMatchState, { type: "setBreakClock", seconds: 30 }, T0, settings)).toThrow("Start a break first.");
    const running = run([
      [T0, { type: "startBreak", seconds: 60 }],
      [T0 + 10_000, { type: "setBreakClock", seconds: 90 }]
    ]);
    // Still running, now from 1:30.
    expect(clockSeconds(running.breakClock, T0 + 20_000)).toBe(80);
    const reset = applyManualAction(running, { type: "resetBreakClock" }, T0 + 20_000, settings);
    expect(reset.breakClock).toEqual({ remainingMs: 120_000, runningSince: null });
    expect(reset.history.at(-1)?.label).toBe("Reset break");
    // Paused at the break length: B resumes it from there.
    const resumed = applyManualAction(reset, { type: "startBreak" }, T0 + 30_000, settings);
    expect(clockSeconds(resumed.breakClock, T0 + 40_000)).toBe(110);
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

describe("match lists", () => {
  const side = (label: string, teamId: string | null = null) => ({ label, teamId, name: "" });
  const scheduled = (id: string, gameId: number, home: ReturnType<typeof side>, away: ReturnType<typeof side>, bestOf: 1 | 3 = 1) => ({
    id,
    gameId,
    time: "",
    minutes: 5,
    division: "",
    stage: "",
    kind: "game" as const,
    home,
    away,
    bestOf,
    notes: ""
  });
  const matchLists = {
    activeListId: "day1",
    lists: [
      {
        id: "day1",
        name: "Day 1",
        sourceFileName: null,
        createdAt: "",
        updatedAt: "",
        games: [
          scheduled("g1", 1, side("Kuda", "kuda"), side("KOVRA UD")),
          scheduled("g2", 2, side("Sausage", "saus"), side("Kuda", "kuda")),
          scheduled("q1", 63, side("Rank 1"), side("Kuda", "kuda"), 3)
        ]
      }
    ]
  };
  const play = (actions: Array<ManualMatchAction>, start: ManualMatchState = defaultManualMatchState) =>
    actions.reduce((state, action) => applyManualAction(state, action, T0, settings, matchLists), start);

  it("next match loads the list's games in order, with the game number as the round", () => {
    const first = play([{ type: "nextMatch" }]);
    // An unmapped team still shows by its printed name.
    expect(first).toMatchObject({ round: 1, left: { teamId: "kuda" }, right: { teamId: null, name: "KOVRA UD" }, schedule: { gameKey: "g1" } });
    const second = play([{ type: "adjustScore", side: "left", delta: 2 }, { type: "nextMatch" }], first);
    expect(second).toMatchObject({ round: 2, left: { teamId: "saus", score: 0 }, right: { teamId: "kuda", score: 0 }, schedule: { gameKey: "g2" } });
    // Undo puts the previous game back, list position included.
    expect(play([{ type: "undo" }], second)).toMatchObject({ round: 1, left: { teamId: "kuda", score: 2 }, schedule: { gameKey: "g1" } });
  });

  it("a best-of-3 keeps its teams and its score from set to set", () => {
    const loaded = play([{ type: "loadScheduledGame", listId: "day1", gameKey: "q1" }]);
    // The placeholder side loads empty until its team is filled in.
    expect(loaded).toMatchObject({ round: 63, left: { teamId: null, name: "" }, right: { teamId: "kuda" }, schedule: { bestOf: 3, seriesGame: 1 } });
    const set2 = play([{ type: "adjustScore", side: "right", delta: 1 }, { type: "nextMatch" }], loaded);
    // The score carries into set 2; only the clock starts again.
    expect(set2).toMatchObject({ round: 63, right: { teamId: "kuda", score: 1 }, gameClock: { remainingMs: 600_000 }, schedule: { seriesGame: 2 } });
    expect(set2.history.at(-1)?.label).toBe("Set 2 of 3");
    const done = play([{ type: "adjustScore", side: "right", delta: 1 }, { type: "nextMatch" }], set2);
    // 0–2 with one set left is over; it was the last game in the list, so the teams stay and the round moves on.
    expect(done).toMatchObject({ round: 64, right: { teamId: "kuda", score: 0 } });
  });

  it("a series level after its last set goes to overtime keeping its score, with the overtime clock", () => {
    const tiebreakSettings = { ...settings, manualOvertimeClockSeconds: 120, manualOneOnOneClockSeconds: 45 };
    const step = (state: ManualMatchState, actions: ManualMatchAction[]) =>
      actions.reduce((current, action) => applyManualAction(current, action, T0, tiebreakSettings, matchLists), state);
    let state = step(defaultManualMatchState, [{ type: "loadScheduledGame", listId: "day1", gameKey: "q1" }]);
    state = step(state, [{ type: "adjustScore", side: "left", delta: 1 }, { type: "nextMatch" }]); // set 1: 1–0
    state = step(state, [{ type: "nextMatch" }]); // set 2 ends on time: still 1–0
    expect(state).toMatchObject({ left: { score: 1 }, right: { score: 0 }, schedule: { seriesGame: 3 } });
    state = step(state, [{ type: "adjustScore", side: "right", delta: 1 }, { type: "nextMatch" }]); // set 3: 1–1
    expect(state).toMatchObject({
      round: 63,
      left: { score: 1 },
      right: { teamId: "kuda", score: 1 },
      gameClock: { remainingMs: 120_000, runningSince: null },
      schedule: { tiebreak: "overtime" }
    });
    expect(state.history.at(-1)?.label).toBe("Overtime");
    state = step(state, [{ type: "nextMatch" }]);
    expect(state).toMatchObject({ left: { score: 1 }, right: { score: 1 }, gameClock: { remainingMs: 45_000 }, schedule: { tiebreak: "oneOnOne" } });
  });

  it("every set starts with a full clock, never the time left from the set before", () => {
    const lists = (order: "turns" | "backToBack") => ({
      ...matchLists,
      lists: [
        {
          ...matchLists.lists[0],
          games: [
            { ...scheduled("q1", 63, side("Kuda", "kuda"), side("Sausage", "saus"), 3), stage: "Quarter 1", turnGroup: order === "turns" ? null : "" },
            { ...scheduled("q2", 64, side("Sausage", "saus"), side("Kuda", "kuda"), 3), stage: "Quarter 2", turnGroup: order === "turns" ? null : "" }
          ]
        }
      ]
    });
    const clockSettings = { ...settings, manualOvertimeClockSeconds: 180, manualOneOnOneClockSeconds: 60 };
    // Plays a set with the clock running for 3:20, a point, the set finished, then Next match.
    const playSet = (state: ManualMatchState, list: typeof matchLists, at: number, left: number, right: number) => {
      let next = applyManualAction(state, { type: "startGameClock" }, at, clockSettings, list);
      if (left) next = applyManualAction(next, { type: "adjustScore", side: "left", delta: left }, at + 200_000, clockSettings, list);
      if (right) next = applyManualAction(next, { type: "adjustScore", side: "right", delta: right }, at + 200_000, clockSettings, list);
      if (!left && !right) next = applyManualAction(next, { type: "stopGameClock" }, at + 200_000, clockSettings, list);
      next = applyManualAction(next, { type: "finishMatch" }, at + 200_000, clockSettings, list);
      return applyManualAction(next, { type: "nextMatch" }, at + 210_000, clockSettings, list);
    };
    const fullClock = { remainingMs: 600_000, runningSince: null };

    for (const order of ["turns", "backToBack"] as const) {
      const list = lists(order);
      let state = applyManualAction(defaultManualMatchState, { type: "loadScheduledGame", listId: "day1", gameKey: "q1" }, T0, clockSettings, list);
      expect(state.gameClock).toEqual(fullClock);
      state = playSet(state, list, T0, 1, 0);
      expect(state.gameClock, `${order}: set after a set`).toEqual(fullClock);
      state = playSet(state, list, T0 + 300_000, 0, 1);
      expect(state.gameClock, `${order}: next set`).toEqual(fullClock);
    }

    // Overtime and one-on-one start from their own full lengths too.
    const list = lists("backToBack");
    let state = applyManualAction(defaultManualMatchState, { type: "loadScheduledGame", listId: "day1", gameKey: "q1" }, T0, clockSettings, list);
    state = playSet(state, list, T0, 1, 0);
    state = playSet(state, list, T0 + 300_000, 0, 1);
    state = playSet(state, list, T0 + 600_000, 0, 0);
    expect(state).toMatchObject({ schedule: { tiebreak: "overtime" }, gameClock: { remainingMs: 180_000, runningSince: null } });
    state = playSet(state, list, T0 + 900_000, 0, 0);
    expect(state).toMatchObject({ schedule: { tiebreak: "oneOnOne" }, gameClock: { remainingMs: 60_000, runningSince: null } });
    state = playSet(state, list, T0 + 1_200_000, 0, 0);
    expect(state).toMatchObject({ schedule: { tiebreak: "oneOnOne" }, gameClock: { remainingMs: 60_000, runningSince: null } });
  });

  it("without an active list, next match works as before", () => {
    const state = applyManualAction(defaultManualMatchState, { type: "nextMatch" }, T0, settings, { ...matchLists, activeListId: null });
    expect(state).toMatchObject({ round: 2, schedule: null });
  });

  it("refuses a game that is not in the list", () => {
    expect(() => play([{ type: "loadScheduledGame", listId: "day1", gameKey: "nope" }])).toThrow(ManualActionError);
  });
});

describe("chained actions", () => {
  it("a point stops the game clock; taking one back does not", () => {
    const scored = run([
      [T0, { type: "startGameClock" }],
      [T0 + 30_000, { type: "adjustScore", side: "left", delta: 1 }]
    ]);
    expect(scored.gameClock).toEqual({ remainingMs: 570_000, runningSince: null });

    const corrected = run([
      [T0, { type: "adjustScore", side: "left", delta: 1 }],
      [T0, { type: "startGameClock" }],
      [T0 + 10_000, { type: "adjustScore", side: "left", delta: -1 }]
    ]);
    expect(corrected.gameClock.runningSince).not.toBeNull();
  });

  it("towel and base stop the game clock and leave the score alone", () => {
    for (const kind of ["towel", "base"] as const) {
      const state = run([
        [T0, { type: "startGameClock" }],
        [T0 + 20_000, { type: "teamEvent", kind, side: "right" }]
      ]);
      expect(state.gameClock).toEqual({ remainingMs: 580_000, runningSince: null });
      expect([state.left.score, state.right.score]).toEqual([0, 0]);
    }
  });

  it("starts the game clock from the moment a break between points ends, as one Undo step", () => {
    const inBreak = run([[T0, { type: "startBreak", seconds: 60 }]]);
    expect(autoStartAfterBreak(inBreak, T0 + 59_000, settings)).toBeNull();
    const started = autoStartAfterBreak(inBreak, T0 + 60_250, settings);
    expect(started).toMatchObject({ phase: "game", breakClock: { remainingMs: 0, runningSince: null } });
    expect(started?.gameClock.runningSince).toBe(new Date(T0 + 60_000).toISOString());
    expect(clockSeconds(started!.gameClock, T0 + 70_000)).toBe(590);
    expect(started?.history.at(-1)?.label).toBe("Clock started after break");
    const undone = applyManualAction(started!, { type: "undo" }, T0 + 61_000, settings);
    expect(undone.phase).toBe("break");
  });

  it("does not start the clock when switched off, after a finished match, or for a paused break", () => {
    const inBreak = run([[T0, { type: "startBreak", seconds: 60 }]]);
    expect(autoStartAfterBreak(inBreak, T0 + 61_000, { ...settings, manualAutoStartGameClock: false })).toBeNull();
    const finished = run([
      [T0, { type: "finishMatch" }],
      [T0, { type: "startBreak", seconds: 60 }]
    ]);
    expect(autoStartAfterBreak(finished, T0 + 61_000, settings)).toBeNull();
    const paused = applyManualAction(inBreak, { type: "stopBreak" }, T0 + 30_000, settings);
    expect(autoStartAfterBreak(paused, T0 + 120_000, settings)).toBeNull();
  });

  it("noticed long after the break ended (a restart), starts from now rather than the past", () => {
    const inBreak = run([[T0, { type: "startBreak", seconds: 60 }]]);
    const started = autoStartAfterBreak(inBreak, T0 + 300_000, settings);
    expect(started?.gameClock.runningSince).toBe(new Date(T0 + 300_000).toISOString());
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

  it("starts the clock on its own when the break ends, and reports the change", () => {
    let saved = run([[T0, { type: "startBreak", seconds: 2 }]]);
    let now = T0;
    const changes: string[] = [];
    const instance = new ManualMatchEngine({
      load: () => saved,
      save: (next) => (saved = next),
      getTeams: () => teams,
      getSettings: () => settings,
      onMatchChange: (view) => changes.push(view.phase),
      now: () => now
    });
    now = T0 + 2_100;
    (instance as unknown as { tick: () => void }).tick();
    expect(changes).toEqual(["game"]);
    expect(saved.phase).toBe("game");
    expect(instance.getState()).toMatchObject({ state: "RUNNING", period: "GAME" });
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
