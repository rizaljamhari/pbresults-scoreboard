import { z } from "zod";

/**
 * Match lists: an event's schedule (usually read from its PDF), so manual scoring's Next match loads the right teams.
 * A list belongs to one day ("SMPL Day 1"); the operator picks which list manual scoring follows.
 */

export const matchBestOfValues = [1, 3, 5] as const;

export const scheduledSideSchema = z.object({
  /** The name as the schedule prints it. Kept so a mapping can be changed later. */
  label: z.string().max(80).default(""),
  /** A registry team; when set, its names and logo are used. */
  teamId: z.string().nullable().default(null),
  /** Shown as typed when there is no registry team ("Keep as text"). Empty means the side is not mapped yet. */
  name: z.string().max(40).default("")
});

export const scheduledGameSchema = z.object({
  id: z.string().min(1),
  /** The schedule's game number; null for a break. */
  gameId: z.number().int().min(0).nullable().default(null),
  time: z.string().max(10).default(""),
  minutes: z.number().int().min(0).nullable().default(null),
  division: z.string().max(60).default(""),
  stage: z.string().max(80).default(""),
  kind: z.enum(["game", "break"]).default("game"),
  home: scheduledSideSchema.default({}),
  away: scheduledSideSchema.default({}),
  bestOf: z.union([z.literal(1), z.literal(3), z.literal(5)]).default(1),
  notes: z.string().max(200).default("")
});

export const seriesOrderValues = ["turns", "backToBack"] as const;
export type SeriesOrder = (typeof seriesOrderValues)[number];

export const matchListSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  sourceFileName: z.string().nullable().default(null),
  /**
   * How each stage's best-of series are played, by series group (see seriesGroup). Missing means taking turns: game 1
   * of every series in the stage, then game 2 of those still open, and so on.
   */
  seriesOrder: z.record(z.enum(seriesOrderValues)).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  games: z.array(scheduledGameSchema).max(500).default([])
});

export const matchListsStateSchema = z.object({
  /** The list manual scoring follows; none means Next match works as it always did. */
  activeListId: z.string().nullable().default(null),
  lists: z.array(matchListSchema).default([])
});

export const tiebreakValues = ["overtime", "oneOnOne"] as const;
export type Tiebreak = (typeof tiebreakValues)[number];

/**
 * One best-of series so far. The score runs across its sets (home is left, away is right): a set ends with a point or
 * on time, and only the clock starts again for the next set.
 */
export const seriesScoreSchema = z.object({
  /** Sets finished. */
  played: z.number().int().min(0).default(0),
  left: z.number().int().min(0).default(0),
  right: z.number().int().min(0).default(0),
  /** A series still level after its last set is decided by overtime, then a one-on-one, with the same teams. */
  tiebreak: z.enum(tiebreakValues).nullable().default(null),
  /** The score when the tie-break started. The score stays on screen and the next point wins. */
  tiebreakFrom: z.object({ left: z.number().int().min(0), right: z.number().int().min(0) }).nullable().default(null),
  /** Tie-breaks finished level (overtime, then each one-on-one), so taking turns can tell whose go it is. */
  tiebreaksPlayed: z.number().int().min(0).default(0)
});

/** Where manual scoring is in a list. Part of the match state, so Undo puts it back too. */
export const manualScheduleSchema = z.object({
  listId: z.string(),
  gameKey: z.string(),
  gameId: z.number().int().nullable(),
  bestOf: z.number().int().min(1).default(1),
  /** Which set of a best-of series is being played, from 1. */
  seriesGame: z.number().int().min(1).default(1),
  /** The tie-break being played, if any. */
  tiebreak: z.enum(tiebreakValues).nullable().default(null),
  /** Every best-of series in this list so far, by game key, so taking turns between series keeps each one's score. */
  series: z.record(seriesScoreSchema).default({})
});

/** A parsed schedule, before it is saved as a list. */
export const parsedScheduleSchema = z.object({
  title: z.string(),
  date: z.string(),
  games: z.array(scheduledGameSchema),
  warnings: z.array(z.string())
});

/** What the operator decides for one printed team name on the Matches page. */
export const teamMappingRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), label: z.string().min(1), teamId: z.string().min(1) }),
  z.object({ action: z.literal("create"), label: z.string().min(1) }),
  z.object({ action: z.literal("text"), label: z.string().min(1) }),
  z.object({ action: z.literal("clear"), label: z.string().min(1) })
]);

export type ScheduledSide = z.infer<typeof scheduledSideSchema>;
export type ScheduledGame = z.infer<typeof scheduledGameSchema>;
export type MatchList = z.infer<typeof matchListSchema>;
export type MatchListsState = z.infer<typeof matchListsStateSchema>;
export type ManualSchedule = z.infer<typeof manualScheduleSchema>;
export type SeriesScore = z.infer<typeof seriesScoreSchema>;
export type ParsedSchedule = z.infer<typeof parsedScheduleSchema>;
export type TeamMappingRequest = z.infer<typeof teamMappingRequestSchema>;
export type MatchBestOf = ScheduledGame["bestOf"];

export const defaultMatchListsState: MatchListsState = { activeListId: null, lists: [] };

/** A seeding reference rather than a team: "Rank 1", "Winner SF1", "Loser QF2", "Highest-ranked Round of 16". */
export function isPlaceholderLabel(label: string): boolean {
  const value = label.trim();
  if (!value) return false;
  return /^rank\s*\d+$/i.test(value) || /^(winner|loser)\b/i.test(value) || /-ranked\b/i.test(value) || /^(tbd|tba|bye)$/i.test(value);
}

export type SideStatus = "linked" | "text" | "placeholder" | "unlinked" | "empty";

/**
 * How a scheduled side is set. With the ids of the teams that exist, a link to a team since deleted from Teams counts
 * as unlinked, so it is flagged for linking again.
 */
export function sideStatus(side: ScheduledSide, knownTeamIds?: ReadonlySet<string>): SideStatus {
  if (side.teamId && (!knownTeamIds || knownTeamIds.has(side.teamId))) return "linked";
  if (side.name) return "text";
  if (!side.label.trim()) return "empty";
  return isPlaceholderLabel(side.label) ? "placeholder" : "unlinked";
}

/** A side still showing a seeding reference: its team is decided during the day and filled in by hand. */
export function gameHasPlaceholder(game: ScheduledGame): boolean {
  return game.kind === "game" && (sideStatus(game.home) === "placeholder" || sideStatus(game.away) === "placeholder");
}

/** Printed team names that are not linked to the team list or kept as text, each once, in schedule order. */
export function unlinkedLabels(list: MatchList, knownTeamIds?: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  for (const game of list.games) {
    if (game.kind !== "game") continue;
    for (const side of [game.home, game.away]) {
      if (sideStatus(side, knownTeamIds) === "unlinked") seen.add(side.label.trim());
    }
  }
  return [...seen];
}

/** Best of N from the schedule's notes ("Best of 3."). Nothing said means a single game. */
export function bestOfFromNotes(notes: string): MatchBestOf {
  const match = /best\s+of\s+(\d+)/i.exec(notes);
  const value = match ? Number(match[1]) : 1;
  return value === 3 || value === 5 ? value : 1;
}


export function gameTitle(game: ScheduledGame) {
  return game.gameId === null ? game.stage || "Break" : `Game ${game.gameId}`;
}

/**
 * The stage a best-of series belongs to, for taking turns: the stage name without its number ("Quarter 2" is
 * "quarter"). The 3rd place game and the final are played as a pair, so they share one group.
 */
export function seriesGroup(game: ScheduledGame): string {
  const stage = game.stage.trim().toLowerCase().replace(/\s*\d+$/, "");
  if (/^(3rd|third|bronze)\b|^(grand\s+)?final$/.test(stage)) return "finals";
  return stage || "series";
}

/** A series group as the operator reads it: "Quarter", "Semi", "3rd place & Final". */
export function seriesGroupLabel(group: string, games: ScheduledGame[]): string {
  if (group === "finals") return "3rd place & Final";
  const stage = games.find((game) => seriesGroup(game) === group)?.stage.replace(/\s*\d+$/, "").trim();
  return stage || "Series";
}

/** The best-of series groups in a list, in schedule order, with their games. */
export function seriesGroups(list: MatchList): Array<{ group: string; label: string; games: ScheduledGame[] }> {
  const groups = new Map<string, ScheduledGame[]>();
  for (const game of list.games) {
    if (game.kind !== "game" || game.bestOf <= 1) continue;
    const key = seriesGroup(game);
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return [...groups].map(([group, games]) => ({ group, label: seriesGroupLabel(group, games), games }));
}

export function seriesOrderOf(list: MatchList, group: string): SeriesOrder {
  return list.seriesOrder?.[group] ?? "turns";
}

const noScore: SeriesScore = { played: 0, left: 0, right: 0, tiebreak: null, tiebreakFrom: null, tiebreaksPlayed: 0 };

/** Turns a series has had: its sets, then its tie-breaks. Taking turns plays the series with the fewest next. */
function turnsTaken(score: SeriesScore) {
  return score.played + (score.tiebreaksPlayed ?? 0);
}

/** A series' score so far, from the match state's record of the list (0–0 before its first set). */
export function seriesScoreOf(schedule: ManualSchedule | null | undefined, gameKey: string): SeriesScore {
  return schedule?.series[gameKey] ?? noScore;
}

/**
 * Over when the trailing side cannot catch up: each set left is worth at most one point, so 2–0 after set 2 of 3 is
 * over and 1–0 is not. After the last set a lead wins; a level series stays open for its tie-break.
 */
export function seriesDecided(score: SeriesScore, bestOf: number) {
  if (score.tiebreak) return false;
  const lead = Math.abs(score.left - score.right);
  const setsLeft = Math.max(0, bestOf - score.played);
  return score.played >= bestOf || lead > setsLeft;
}

export function tiebreakLabel(tiebreak: Tiebreak) {
  return tiebreak === "overtime" ? "Overtime" : "One-on-one";
}

export type NextMatchPlan =
  /** The same series goes on with the same teams (back to back). */
  | { kind: "series"; game: ScheduledGame; schedule: ManualSchedule }
  /** The series is level after its last game: same teams, the score stays, the next point wins. */
  | { kind: "tiebreak"; game: ScheduledGame; schedule: ManualSchedule; tiebreak: Tiebreak; from: { left: number; right: number } }
  | { kind: "game"; game: ScheduledGame; schedule: ManualSchedule }
  | { kind: "end" };

/** Points at one game of a list, keeping the series scores already played in that list. */
export function scheduleForGame(list: MatchList, game: ScheduledGame, previous: ManualSchedule | null = null): ManualSchedule {
  const series = (previous?.listId === list.id ? previous.series : undefined) ?? {};
  const score = series[game.id] ?? noScore;
  return {
    listId: list.id,
    gameKey: game.id,
    gameId: game.gameId,
    bestOf: game.bestOf,
    seriesGame: Math.min(score.played + 1, Math.max(game.bestOf, 1)),
    tiebreak: score.tiebreak ?? null,
    series
  };
}

/**
 * What Next match does with a match list. In a best-of game the set just played is recorded with the series score on
 * the board (the score carries from set to set; a set that ends on time adds nothing). Then:
 * - back to back: an open series goes on with the same teams;
 * - taking turns (the default): the next open series in the stage that has played the fewest games, in schedule
 *   order, so every series plays game 1, then those still open play game 2, and so on;
 * - otherwise the next game in the list after the stage, skipping breaks. A series already decided is skipped.
 * Without a current game in this list, it starts at the first game.
 */
export function planNextMatch(schedule: ManualSchedule | null, list: MatchList, leftScore: number, rightScore: number): NextMatchPlan {
  const inList = schedule?.listId === list.id ? schedule : null;
  const current = inList ? list.games.findIndex((game) => game.id === inList.gameKey) : -1;
  const currentGame = current >= 0 ? list.games[current] : null;
  let series = inList?.series ?? {};

  // The game's Best of as the list says now, so a change made on the Matches page mid-series counts.
  if (inList && currentGame && currentGame.bestOf > 1) {
    const before = series[currentGame.id] ?? noScore;
    let score: SeriesScore;
    if (before.tiebreak && before.tiebreakFrom) {
      // A tie-break is won by whoever scored since it started; still level, overtime becomes a one-on-one, and
      // one-on-ones go on until someone scores. The score on the board is the series score either way.
      const level = leftScore - before.tiebreakFrom.left === rightScore - before.tiebreakFrom.right;
      score = level
        ? {
            ...before,
            left: leftScore,
            right: rightScore,
            tiebreak: "oneOnOne",
            tiebreakFrom: { left: leftScore, right: rightScore },
            tiebreaksPlayed: (before.tiebreaksPlayed ?? 0) + 1
          }
        : { ...before, left: leftScore, right: rightScore, tiebreak: null, tiebreakFrom: null };
    } else {
      // The board shows the series score, carried from set to set, so it is the score after this set.
      score = { played: before.played + 1, left: leftScore, right: rightScore, tiebreak: null, tiebreakFrom: null, tiebreaksPlayed: 0 };
      // Every set played and still level: overtime, with the same teams (straight away back to back; in turn otherwise).
      if (score.played >= currentGame.bestOf && score.left === score.right) {
        score = { ...score, tiebreak: "overtime", tiebreakFrom: { left: leftScore, right: rightScore } };
      }
    }
    series = { ...series, [currentGame.id]: score };
    const group = seriesGroup(currentGame);
    const pointer = (game: ScheduledGame) => scheduleForGame(list, game, { ...inList, series });
    // The same series again: its tie-break, or its next set.
    const sameSeries = (): NextMatchPlan =>
      score.tiebreak && score.tiebreakFrom
        ? { kind: "tiebreak", game: currentGame, schedule: pointer(currentGame), tiebreak: score.tiebreak, from: score.tiebreakFrom }
        : { kind: "series", game: currentGame, schedule: pointer(currentGame) };

    if (seriesOrderOf(list, group) === "backToBack") {
      if (!seriesDecided(score, currentGame.bestOf)) return sameSeries();
    } else {
      // Every open series in the stage gets its next turn before any has another: sets first, then overtimes, then
      // one-on-ones, each round in schedule order.
      const open = list.games
        .filter((game) => game.kind === "game" && game.bestOf > 1 && seriesGroup(game) === group)
        .filter((game) => !seriesDecided(series[game.id] ?? noScore, game.bestOf));
      const fewest = Math.min(...open.map((game) => turnsTaken(series[game.id] ?? noScore)));
      const next = open.find((game) => turnsTaken(series[game.id] ?? noScore) === fewest);
      if (next) return next.id === currentGame.id ? sameSeries() : { kind: "game", game: next, schedule: pointer(next) };
    }
  }

  // Past the current game, or past its whole stage when taking turns; a removed current row carries on after its
  // game number rather than starting the list again.
  const groupEnd =
    currentGame && currentGame.bestOf > 1 && seriesOrderOf(list, seriesGroup(currentGame)) === "turns"
      ? Math.max(...list.games.map((game, index) => (game.bestOf > 1 && game.kind === "game" && seriesGroup(game) === seriesGroup(currentGame) ? index : -1)))
      : current;
  const after =
    current >= 0
      ? (_game: ScheduledGame, index: number) => index > groupEnd
      : inList?.gameId != null
        ? (game: ScheduledGame) => game.gameId !== null && game.gameId > inList.gameId!
        : () => true;
  const isDone = (game: ScheduledGame) => game.bestOf > 1 && seriesDecided(series[game.id] ?? noScore, game.bestOf);
  const next = list.games.find((game, index) => game.kind === "game" && after(game, index) && !isDone(game));
  return next ? { kind: "game", game: next, schedule: scheduleForGame(list, next, inList ? { ...inList, series } : null) } : { kind: "end" };
}
