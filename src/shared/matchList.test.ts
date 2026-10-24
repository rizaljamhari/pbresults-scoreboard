import { describe, expect, it } from "vitest";
import {
  bestOfFromNotes,
  isPlaceholderLabel,
  planNextMatch,
  scheduleForGame,
  OWN_TURN,
  groupPlayOrder,
  manualScheduleSchema,
  withSeriesSwitched,
  seriesScoreOf,
  sideStatus,
  turnGroups,
  unlinkedLabels,
  type ManualSchedule,
  type MatchList,
  type ScheduledGame
} from "./matchList";

function game(id: string, gameId: number | null, home: string, away: string, bestOf: 1 | 3 | 5 = 1): ScheduledGame {
  return {
    id,
    gameId,
    time: "",
    minutes: 5,
    division: "Premier",
    stage: gameId === null ? "Break" : "Prelim",
    kind: gameId === null ? "break" : "game",
    home: { label: home, teamId: null, name: "" },
    away: { label: away, teamId: null, name: "" },
    bestOf,
    notes: "",
    turnGroup: null
  };
}

const list: MatchList = {
  id: "day1",
  name: "Day 1",
  sourceFileName: null,
  backToBackGroups: [],
  createdAt: "",
  updatedAt: "",
  games: [game("g1", 1, "KOVRA UD", "K INTIKAM"), game("b1", null, "Break", ""), game("g2", 2, "Loco Legion", "EJPC JR"), game("q1", 63, "Rank 1", "Rank 8", 3)]
};

describe("match list helpers", () => {
  it("recognises seeding references as placeholders, not teams", () => {
    for (const label of ["Rank 1", "Winner SF1", "Loser SF2", "Highest-ranked Round of 16", "Second-lowest-ranked Quarter-"]) {
      expect(isPlaceholderLabel(label)).toBe(true);
    }
    for (const label of ["3Q", "A.M", "Lunatic Legion", "COMRADES OF DARKNESS “COD”"]) {
      expect(isPlaceholderLabel(label)).toBe(false);
    }
  });

  it("reads best-of from the notes only", () => {
    expect(bestOfFromNotes("Best of 3.")).toBe(3);
    expect(bestOfFromNotes("Best of 1.")).toBe(1);
    expect(bestOfFromNotes("")).toBe(1);
  });

  it("lists each unlinked printed name once, skipping placeholders and mapped sides", () => {
    const mapped: MatchList = {
      ...list,
      games: [...list.games, { ...game("g3", 3, "KOVRA UD", "Spunky"), away: { label: "Spunky", teamId: "spunky", name: "" } }]
    };
    expect(unlinkedLabels(mapped)).toEqual(["KOVRA UD", "K INTIKAM", "Loco Legion", "EJPC JR"]);
    expect(sideStatus({ label: "Rank 1", teamId: null, name: "" })).toBe("placeholder");
    expect(sideStatus({ label: "3Q", teamId: null, name: "3Q" })).toBe("text");
  });
});

describe("saved series from before sides could switch", () => {
  it("reads left and right as home and away, tie-break start included", () => {
    const old = { played: 3, left: 1, right: 1, tiebreak: "overtime", tiebreakFrom: { left: 1, right: 1 }, tiebreaksPlayed: 0 };
    expect(manualScheduleSchema.parse({ listId: "l", gameKey: "g", gameId: 1, series: { g: old } }).series.g).toEqual({
      played: 3,
      home: 1,
      away: 1,
      switched: false,
      tiebreak: "overtime",
      tiebreakFrom: { home: 1, away: 1 },
      tiebreaksPlayed: 0
    });
  });
});

describe("planNextMatch", () => {
  /** Plays games through planNextMatch: each entry is the left and right score of the game being played. */
  function playThrough(target: MatchList, scores: Array<[number, number]>) {
    let schedule: ManualSchedule | null = null;
    const loaded: string[] = [];
    for (const [left, right] of [[0, 0] as [number, number], ...scores]) {
      const plan = planNextMatch(schedule, target, left, right);
      if (plan.kind === "end") {
        loaded.push("end");
        break;
      }
      schedule = plan.schedule;
      loaded.push(plan.kind === "series" ? `${plan.game.id}*` : plan.game.id);
    }
    return { loaded, schedule };
  }

  it("starts at the first game, then moves on skipping breaks", () => {
    expect(playThrough(list, [[3, 1]]).loaded).toEqual(["g1", "g2"]);
  });

  it("starts from the first game when the current game belongs to another list", () => {
    const other = { ...scheduleForGame(list, list.games[2]), listId: "day2" };
    expect(planNextMatch(other, list, 0, 0)).toMatchObject({ kind: "game", game: { id: "g1" } });
  });

  it("carries on after the current game's number when its row was removed", () => {
    const pointer = scheduleForGame(list, list.games[0]);
    const without = { ...list, games: list.games.filter((game) => game.id !== "g1") };
    expect(planNextMatch(pointer, without, 0, 0)).toMatchObject({ kind: "game", game: { id: "g2" } });
  });

  const knockout: MatchList = {
    ...list,
    games: [
      game("p1", 1, "A", "B"),
      game("q1", 63, "Rank 1", "Rank 8", 3),
      game("q2", 64, "Rank 2", "Rank 7", 3),
      game("q3", 65, "Rank 3", "Rank 6", 3),
      { ...game("b", null, "", ""), stage: "Break" },
      { ...game("s1", 67, "W1", "W2", 3), stage: "Semi 1" },
      { ...game("t", 69, "L1", "L2", 3), stage: "3rd Place" },
      { ...game("f", 70, "W1", "W2", 3), stage: "Final" }
    ].map((item) => (item.id.startsWith("q") ? { ...item, stage: `Quarter ${item.id.slice(1)}` } : item))
  };

  it("takes turns by default: set 1 of every series in the stage, then the series still open", () => {
    // Each entry is the board after the set; the score carries from set to set within a series.
    const { loaded } = playThrough(knockout, [
      [1, 0], // p1
      [1, 0], // q1 set 1
      [0, 1], // q2 set 1
      [1, 0], // q3 set 1
      [2, 0], // q1 set 2: 2–0 with one set left, so q1 is over
      [1, 1], // q2 set 2
      [1, 0], // q3 set 2 ends on time: 1–0 with one set left, still open
      [1, 2], // q2 set 3
      [1, 0] // q3 set 3 ends on time: 1–0, left wins
    ]);
    expect(loaded).toEqual(["p1", "q1", "q2", "q3", "q1", "q2", "q3", "q2", "q3", "s1"]);
  });

  /** One series followed by one more game, so the series' record can be read after it ends. */
  const semiThenNext = { ...knockout, games: [knockout.games[5], game("n", 99, "X", "Y")] };
  function playSeries(scores: Array<[number, number]>) {
    let schedule: ManualSchedule = scheduleForGame(semiThenNext, semiThenNext.games[0]);
    const plans = scores.map(([left, right]) => {
      const plan = planNextMatch(schedule, semiThenNext, left, right);
      if (plan.kind !== "end") schedule = plan.schedule;
      return plan;
    });
    return { plans, schedule };
  }

  it("1–0, then two sets ending on time: left wins 1–0", () => {
    const { plans, schedule } = playSeries([
      [1, 0],
      [1, 0],
      [1, 0]
    ]);
    expect(plans.map((plan) => plan.kind)).toEqual(["series", "series", "game"]);
    expect(plans[0]).toMatchObject({ schedule: { seriesGame: 2 } });
    expect(seriesScoreOf(schedule, "s1")).toMatchObject({ played: 3, home: 1, away: 0, tiebreak: null });
  });

  it("1–0, a set on time, then 1–1: overtime, then a one-on-one, keeping the score", () => {
    const { plans, schedule } = playSeries([
      [1, 0],
      [1, 0],
      [1, 1], // level after the last set
      [1, 1], // nobody scores in overtime
      [1, 2] // right scores in the one-on-one
    ]);
    expect(plans[2]).toMatchObject({ kind: "tiebreak", tiebreak: "overtime", from: { home: 1, away: 1 }, schedule: { tiebreak: "overtime", seriesGame: 3 } });
    expect(plans[3]).toMatchObject({ kind: "tiebreak", tiebreak: "oneOnOne", from: { home: 1, away: 1 } });
    expect(plans[4]).toMatchObject({ kind: "game", game: { id: "n" } });
    expect(seriesScoreOf(schedule, "s1")).toMatchObject({ home: 1, away: 2, tiebreak: null });
  });

  it("switches a series' sides after a set with a point, and keeps them after a set on time", () => {
    const { plans } = playSeries([
      [1, 0], // a point: switch
      [1, 0], // on time: stay
      [1, 1], // a point: switch, and the series is level
      [2, 1] // overtime point: decided
    ]);
    const switched = plans.slice(0, 3).map((plan) => (plan.kind === "end" ? null : seriesScoreOf(plan.schedule, "s1").switched));
    expect(switched).toEqual([true, true, false]);
    expect(plans[2]).toMatchObject({ kind: "tiebreak", tiebreak: "overtime" });
  });

  it("records a switch by hand on the current game, even one loaded as a single game", () => {
    const loadedAsSingle = scheduleForGame(list, list.games[0]);
    expect(withSeriesSwitched(loadedAsSingle, true).series.g1).toMatchObject({ switched: true, played: 0, home: 0, away: 0 });
  });

  it("ends a series early only when the trailing side cannot catch up", () => {
    expect(playSeries([[1, 0], [2, 0]]).plans.map((plan) => plan.kind)).toEqual(["series", "game"]);
    expect(playSeries([[1, 0], [1, 0]]).plans.map((plan) => plan.kind)).toEqual(["series", "series"]);
  });

  it("taking turns, tie-breaks wait for the stage's open sets, then go overtimes first, then one-on-ones", () => {
    const semis: MatchList = {
      ...list,
      games: [
        { ...game("s1", 67, "W1", "W2", 3), stage: "Semi 1" },
        { ...game("s2", 68, "W3", "W4", 3), stage: "Semi 2" },
        game("n", 69, "X", "Y")
      ]
    };
    const steps: string[] = [];
    let schedule: ManualSchedule | null = scheduleForGame(semis, semis.games[0]);
    // The board after each turn, for whichever series is on.
    for (const [left, right] of [
      [1, 0], // s1 set 1
      [0, 1], // s2 set 1
      [1, 1], // s1 set 2
      [0, 2], // s2 set 2: 0–2 with one set left, s2 is over
      [1, 1], // s1 set 3: level, overtime is due
      [1, 1], // s1 overtime, level: a one-on-one is due
      [2, 1] // s1 one-on-one: left scores
    ] as Array<[number, number]>) {
      const plan = planNextMatch(schedule, semis, left, right);
      if (plan.kind === "end") break;
      schedule = plan.schedule;
      steps.push(`${plan.game.id} ${plan.schedule.tiebreak ?? `set ${plan.schedule.seriesGame}`}`);
    }
    expect(steps).toEqual(["s2 set 1", "s1 set 2", "s2 set 2", "s1 set 3", "s1 overtime", "s1 oneOnOne", "n set 1"]);

    // Both semis level after set 3: s1's overtime waits for s2's set 3, then both overtimes go before any one-on-one.
    const order: string[] = [];
    schedule = scheduleForGame(semis, semis.games[0]);
    for (const [left, right] of [
      [1, 0], // s1 set 1
      [1, 0], // s2 set 1
      [1, 0], // s1 set 2
      [1, 0], // s2 set 2
      [1, 1], // s1 set 3: level
      [1, 1], // s2 set 3: level
      [1, 1], // s1 overtime: level
      [1, 1], // s2 overtime: level
      [1, 2] // s1 one-on-one: right scores
    ] as Array<[number, number]>) {
      const plan = planNextMatch(schedule, semis, left, right);
      if (plan.kind === "end") break;
      schedule = plan.schedule;
      order.push(`${plan.game.id} ${plan.schedule.tiebreak ?? `set ${plan.schedule.seriesGame}`}`);
    }
    expect(order).toEqual(["s2 set 1", "s1 set 2", "s2 set 2", "s1 set 3", "s2 set 3", "s1 overtime", "s2 overtime", "s1 oneOnOne", "s2 oneOnOne"]);
    // A tie-break loaded from another series keeps that series' level score.
    expect(seriesScoreOf(schedule, "s2")).toMatchObject({ home: 1, away: 1, tiebreak: "oneOnOne" });
  });

  it("back to back, a tie-break follows its series straight away", () => {
    const semis: MatchList = {
      ...list,
      games: [
        { ...game("s1", 67, "W1", "W2", 3), stage: "Semi 1", turnGroup: OWN_TURN },
        { ...game("s2", 68, "W3", "W4", 3), stage: "Semi 2", turnGroup: OWN_TURN }
      ]
    };
    let schedule: ManualSchedule = scheduleForGame(semis, semis.games[0]);
    for (const [left, right] of [[1, 0], [1, 0]] as Array<[number, number]>) {
      const plan = planNextMatch(schedule, semis, left, right);
      if (plan.kind === "end") throw new Error("ended early");
      schedule = plan.schedule;
    }
    expect(planNextMatch(schedule, semis, 1, 1)).toMatchObject({ kind: "tiebreak", game: { id: "s1" }, tiebreak: "overtime" });
  });

  it("puts the 3rd place game and the final in one group, each keeping its own score", () => {
    const start = scheduleForGame(knockout, knockout.games[6]);
    const afterThird = planNextMatch(start, knockout, 1, 0);
    expect(afterThird).toMatchObject({ kind: "game", game: { id: "f" } });
    if (afterThird.kind === "end") throw new Error("expected a game");
    const backToThird = planNextMatch(afterThird.schedule, knockout, 0, 1);
    expect(backToThird).toMatchObject({ kind: "game", game: { id: "t" }, schedule: { seriesGame: 2 } });
    if (backToThird.kind === "end") throw new Error("expected a game");
    expect(seriesScoreOf(backToThird.schedule, "t")).toMatchObject({ home: 1, away: 0 });
    expect(seriesScoreOf(backToThird.schedule, "f")).toMatchObject({ home: 0, away: 1 });
  });

  it("plays a series back to back when it has its own turn", () => {
    const backToBack = { ...knockout, games: knockout.games.map((item) => (item.id.startsWith("q") ? { ...item, turnGroup: OWN_TURN } : item)) };
    const { loaded } = playThrough(backToBack, [
      [1, 0], // p1
      [1, 0], // q1 set 1
      [1, 1], // q1 set 2
      [2, 1], // q1 set 3: left wins
      [1, 0] // q2 set 1
    ]);
    expect(loaded).toEqual(["p1", "q1", "q1*", "q1*", "q2", "q2*"]);
  });

  it("a set that ends on time adds nothing, but counts as played", () => {
    const start = scheduleForGame(knockout, knockout.games[1]);
    const plan = planNextMatch(start, knockout, 0, 0);
    expect(plan.kind !== "end" && seriesScoreOf(plan.schedule, "q1")).toMatchObject({ played: 1, home: 0, away: 0 });
  });

  it("keeps series scores when jumping to another game", () => {
    const start = scheduleForGame(knockout, knockout.games[1]);
    const after = planNextMatch(start, knockout, 1, 0);
    if (after.kind === "end") throw new Error("expected a game");
    const back = scheduleForGame(knockout, knockout.games[1], after.schedule);
    expect(back.seriesGame).toBe(2);
    expect(seriesScoreOf(back, "q1")).toMatchObject({ home: 1, away: 0 });
  });

  it("uses the game's best-of as the list says now", () => {
    const pointer = scheduleForGame(list, list.games[2]);
    const bestOfThree = {
      ...list,
      games: list.games.map((item) => (item.id === "g2" ? { ...item, bestOf: 3 as const, turnGroup: OWN_TURN } : item))
    };
    expect(planNextMatch(pointer, bestOfThree, 1, 0)).toMatchObject({ kind: "series", schedule: { bestOf: 3, seriesGame: 2 } });
  });

  it("ends after the last game", () => {
    expect(planNextMatch(scheduleForGame(list, list.games[3], null), { ...list, games: list.games.slice(0, 3) }, 0, 0)).toEqual({ kind: "end" });
  });

  it("names the automatic turn groups", () => {
    expect(turnGroups(knockout).map((group) => [group.name, group.games.length])).toEqual([
      ["Quarter", 3],
      ["Semi", 1],
      ["3rd place & Final", 2]
    ]);
  });

  // Sunday's end of day: two divisions, game numbers repeating per division.
  const twoDivisions: MatchList = {
    ...list,
    games: [
      { ...game("m51", 51, "L1", "L2", 3), division: "Mechanical", stage: "3rd Place" },
      { ...game("r29", 29, "L1", "L2"), division: "Rookie", stage: "3rd Place" },
      { ...game("m52", 52, "W1", "W2", 3), division: "Mechanical", stage: "Final" },
      { ...game("r30", 30, "W1", "W2"), division: "Rookie", stage: "Final" }
    ]
  };
  function walk(target: MatchList) {
    let schedule: ManualSchedule = scheduleForGame(target, target.games[0]);
    const order = [`${schedule.gameKey} ${schedule.seriesGame}`];
    for (let step = 0; step < 12; step += 1) {
      // Left wins every set, so a best-of-3 is over after two.
      const plan = planNextMatch(schedule, target, seriesScoreOf(schedule, schedule.gameKey).home + 1, 0);
      if (plan.kind === "end") break;
      schedule = plan.schedule;
      order.push(`${schedule.gameKey} ${schedule.seriesGame}`);
    }
    return order;
  }

  it("groups by division, and plays a game the schedule puts between a group's members", () => {
    expect(turnGroups(twoDivisions).map((group) => group.name)).toEqual(["Mechanical 3rd place & Final"]);
    expect(walk(twoDivisions)).toEqual(["m51 1", "m52 1", "m51 2", "m52 2", "r29 1", "r30 1"]);
  });

  it("lets any game join a group: a single game takes its turn in the first round", () => {
    const together = { ...twoDivisions, games: twoDivisions.games.map((item) => (item.id === "r29" ? { ...item, turnGroup: "Mechanical 3rd place & Final" } : item)) };
    expect(walk(together)).toEqual(["m51 1", "r29 1", "m52 1", "m51 2", "m52 2", "r30 1"]);
  });

  it("a group set to back to back plays each game to its end, in schedule order", () => {
    const group = "Mechanical 3rd place & Final";
    const together = {
      ...twoDivisions,
      backToBackGroups: [group],
      games: twoDivisions.games.map((item) => (item.id === "r29" ? { ...item, turnGroup: group } : item))
    };
    expect(walk(together)).toEqual(["m51 1", "m51 2", "r29 1", "m52 1", "m52 2", "r30 1"]);
  });

  it("describes a group's play order before it runs", () => {
    const group = "Mechanical 3rd place & Final";
    const withRookie = { ...twoDivisions, games: twoDivisions.games.map((item) => (item.id === "r29" ? { ...item, turnGroup: group } : item)) };
    const ids = (steps: ReturnType<typeof groupPlayOrder>) => steps.map((step) => [step.label, step.games.map((item) => item.id)]);
    expect(ids(groupPlayOrder(withRookie, group))).toEqual([
      ["Set 1", ["m51", "r29", "m52"]],
      ["Set 2, series still open", ["m51", "m52"]],
      ["Set 3, series still open", ["m51", "m52"]],
      ["Then, for a series still level: overtime, then one-on-ones", []]
    ]);
    expect(ids(groupPlayOrder({ ...withRookie, backToBackGroups: [group] }, group))).toEqual([
      ["up to 3 sets, then its tie-break if level", ["m51"]],
      ["one game", ["r29"]],
      ["up to 3 sets, then its tie-break if level", ["m52"]]
    ]);
  });

  it("plays in printed order when every game has its own turn", () => {
    const printed = { ...twoDivisions, games: twoDivisions.games.map((item) => ({ ...item, turnGroup: OWN_TURN })) };
    expect(walk(printed)).toEqual(["m51 1", "m51 2", "r29 1", "m52 1", "m52 2", "r30 1"]);
  });

});
