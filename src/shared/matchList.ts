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
  notes: z.string().max(200).default(""),
  /**
   * The games this one takes turns with: a group name set on the Matches page, "" for its own turn (a series plays
   * back to back), or null for the automatic group (best-of series by division and stage; single games on their own).
   */
  turnGroup: z.string().max(60).nullable().default(null)
});

/** A game's turn group when it plays on its own. */
export const OWN_TURN = "";

export const matchListSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  sourceFileName: z.string().nullable().default(null),
  /** Turn groups whose games play back to back (each to its end, in schedule order) instead of taking turns. */
  backToBackGroups: z.array(z.string().max(60)).default([]),
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
/**
 * Series records saved before sides could switch kept left and right, with home always on the left. They read as
 * home and away, so a match saved mid-series by an older version carries on after an update.
 */
function migrateSeriesScore(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const record = input as Record<string, unknown>;
  const fromSides = (value: unknown) =>
    value && typeof value === "object" && "left" in value && !("home" in value)
      ? { home: (value as { left: unknown }).left, away: (value as { right?: unknown }).right }
      : value;
  const migrated = fromSides(record) as Record<string, unknown>;
  return { ...record, ...(migrated === record ? {} : migrated), tiebreakFrom: fromSides(record.tiebreakFrom) };
}

export const seriesScoreSchema = z.preprocess(
  migrateSeriesScore,
  z.object({
    /** Sets finished. */
    played: z.number().int().min(0).default(0),
    /** Points so far, by team rather than by side, so switching sides never mixes them up. */
    home: z.number().int().min(0).default(0),
    away: z.number().int().min(0).default(0),
    /** The home team is on the right for this series' next set. Sides switch after a set in which a point was scored. */
    switched: z.boolean().default(false),
    /** A series still level after its last set is decided by overtime, then a one-on-one, with the same teams. */
    tiebreak: z.enum(tiebreakValues).nullable().default(null),
    /** The score when the tie-break started. The score stays on screen and the next point wins. */
    tiebreakFrom: z.object({ home: z.number().int().min(0), away: z.number().int().min(0) }).nullable().default(null),
    /** Tie-breaks finished level (overtime, then each one-on-one), so taking turns can tell whose go it is. */
    tiebreaksPlayed: z.number().int().min(0).default(0)
  })
);

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


/** "Game 23", or "Rookie 23" in a list with more than one division, where game numbers repeat per division. */
export function gameTitle(game: ScheduledGame, divided = false) {
  if (game.gameId === null) return game.stage || "Break";
  return divided && game.division.trim() ? `${game.division.trim()} ${game.gameId}` : `Game ${game.gameId}`;
}

/** "Quarter 2" → "Quarter"; the 3rd place game and the final share "3rd place & Final", as they are played as a pair. */
function stageFamily(game: ScheduledGame): string {
  const stage = game.stage.trim().replace(/\s*\d+$/, "");
  if (/^(3rd|third|bronze)\b|^(grand\s+)?final$/i.test(stage)) return "3rd place & Final";
  return stage || "Series";
}

/** The divisions a list's games belong to ("Mechanical", "Rookie"), in schedule order. */
export function listDivisions(list: MatchList): string[] {
  return [...new Set(list.games.filter((game) => game.kind === "game" && game.division.trim()).map((game) => game.division.trim()))];
}

/**
 * Every game's turn group, by game key; null plays on its own. Automatic groups put a best-of series with the others of
 * its division and stage ("Mechanical Quarter"; just "Quarter" in a one-division list); single games play on their own.
 */
export function turnGroupMap(list: MatchList): Map<string, string | null> {
  const divided = listDivisions(list).length > 1;
  return new Map(
    list.games.map((game) => {
      if (game.kind !== "game" || game.turnGroup === OWN_TURN) return [game.id, null];
      if (game.turnGroup) return [game.id, game.turnGroup];
      if (game.bestOf <= 1) return [game.id, null];
      return [game.id, divided && game.division.trim() ? `${game.division.trim()} ${stageFamily(game)}` : stageFamily(game)];
    })
  );
}

export function isBackToBack(list: MatchList, group: string) {
  return (list.backToBackGroups ?? []).includes(group);
}

export type PlayOrderStep = { label: string; games: ScheduledGame[] };

/**
 * The order a turn group plays in, for the Matches page to show before it runs: taking turns, set 1 of every game,
 * then set 2 of those still open, and so on, then any tie-breaks; back to back, each game to its end in schedule order.
 */
export function groupPlayOrder(list: MatchList, group: string): PlayOrderStep[] {
  const games = turnGroups(list).find((item) => item.name === group)?.games ?? [];
  const bestOf = Math.max(1, ...games.map((game) => game.bestOf));
  const tiebreaks = bestOf > 1 ? [{ label: "Then, for a series still level: overtime, then one-on-ones", games: [] as ScheduledGame[] }] : [];
  if (isBackToBack(list, group)) {
    return games.map((game) => ({ label: game.bestOf > 1 ? `up to ${game.bestOf} sets, then its tie-break if level` : "one game", games: [game] }));
  }
  const rounds = Array.from({ length: bestOf }, (_, index) => {
    const set = index + 1;
    const playing = games.filter((game) => game.bestOf >= set);
    const label = set === 1 ? "Set 1" : `Set ${set}, series still open`;
    return { label, games: playing };
  });
  return [...rounds, ...tiebreaks];
}

/** The turn groups in a list, in schedule order, with their games. */
export function turnGroups(list: MatchList): Array<{ name: string; games: ScheduledGame[] }> {
  const map = turnGroupMap(list);
  const groups = new Map<string, ScheduledGame[]>();
  for (const game of list.games) {
    const name = map.get(game.id);
    if (name) groups.set(name, [...(groups.get(name) ?? []), game]);
  }
  return [...groups].map(([name, games]) => ({ name, games }));
}

const noScore: SeriesScore = { played: 0, home: 0, away: 0, switched: false, tiebreak: null, tiebreakFrom: null, tiebreaksPlayed: 0 };

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
  const lead = Math.abs(score.home - score.away);
  const setsLeft = Math.max(0, bestOf - score.played);
  return score.played >= bestOf || lead > setsLeft;
}

export function tiebreakLabel(tiebreak: Tiebreak) {
  return tiebreak === "overtime" ? "Overtime" : "One-on-one";
}

/** The record after the operator switches sides by hand during a series, so its next automatic switch starts from there. */
export function withSeriesSwitched(schedule: ManualSchedule, switched: boolean): ManualSchedule {
  // Recorded whatever Best of the game had when it was loaded: it may have become a best-of since on the Matches page.
  const score = schedule.series[schedule.gameKey] ?? noScore;
  return { ...schedule, series: { ...schedule.series, [schedule.gameKey]: { ...score, switched } } };
}

export type NextMatchPlan =
  /** The same series goes on with the same teams (back to back). */
  | { kind: "series"; game: ScheduledGame; schedule: ManualSchedule }
  /** The series is level after its last game: same teams, the score stays, the next point wins. */
  | { kind: "tiebreak"; game: ScheduledGame; schedule: ManualSchedule; tiebreak: Tiebreak; from: { home: number; away: number } }
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
 * What Next match does with a match list, given the home and away scores on the board. A best-of game's set is
 * recorded with the series score (it carries from set to set; a set that ends on time adds nothing), and the series
 * switches sides for its next set when a point was scored in this one. Then, within the game's turn group (see
 * turnGroupMap), the open game that has had the fewest turns goes next, in schedule order: every member plays its set
 * 1, then set 2 of those still open, then any overtimes, then one-on-ones. On its own, a series plays on to its end.
 * Once the group is done, the list carries on from where the group started, skipping games already played. Without a
 * current game in this list, it starts at the first game.
 */
export function planNextMatch(schedule: ManualSchedule | null, list: MatchList, homeScore: number, awayScore: number): NextMatchPlan {
  const inList = schedule?.listId === list.id ? schedule : null;
  const current = inList ? list.games.findIndex((game) => game.id === inList.gameKey) : -1;
  const currentGame = current >= 0 ? list.games[current] : null;
  let series = inList?.series ?? {};

  const groups = turnGroupMap(list);
  const groupOf = (game: ScheduledGame) => groups.get(game.id) ?? null;
  let resumeAfter = current;

  // The game's Best of as the list says now, so a change made on the Matches page mid-series counts.
  if (inList && currentGame && currentGame.kind === "game") {
    const group = groupOf(currentGame);
    const team = group ? list.games.filter((game) => groupOf(game) === group) : [currentGame];
    // A single game is only recorded when it takes turns, so the group knows it has had its go.
    if (currentGame.bestOf > 1 || team.length > 1) {
      const before = series[currentGame.id] ?? noScore;
      let score: SeriesScore;
      // A point in this set (or tie-break) means the teams change ends for the next one; a set that ends on time
      // keeps them where they are.
      const scored = homeScore + awayScore > before.home + before.away;
      const switched = currentGame.bestOf > 1 && scored ? !before.switched : before.switched;
      if (before.tiebreak && before.tiebreakFrom) {
        // A tie-break is won by whoever scored since it started; still level, overtime becomes a one-on-one, and
        // one-on-ones go on until someone scores. The score on the board is the series score either way.
        const level = homeScore - before.tiebreakFrom.home === awayScore - before.tiebreakFrom.away;
        score = level
          ? {
              ...before,
              home: homeScore,
              away: awayScore,
              switched,
              tiebreak: "oneOnOne",
              tiebreakFrom: { home: homeScore, away: awayScore },
              tiebreaksPlayed: (before.tiebreaksPlayed ?? 0) + 1
            }
          : { ...before, home: homeScore, away: awayScore, switched, tiebreak: null, tiebreakFrom: null };
      } else {
        // The board shows the series score, carried from set to set, so it is the score after this set.
        score = { played: before.played + 1, home: homeScore, away: awayScore, switched, tiebreak: null, tiebreakFrom: null, tiebreaksPlayed: 0 };
        // Every set of a best-of played and still level: overtime, with the same teams, when its turn comes.
        if (currentGame.bestOf > 1 && score.played >= currentGame.bestOf && score.home === score.away) {
          score = { ...score, tiebreak: "overtime", tiebreakFrom: { home: homeScore, away: awayScore } };
        }
      }
      series = { ...series, [currentGame.id]: score };
      const pointer = (game: ScheduledGame) => scheduleForGame(list, game, { ...inList, series });

      // Every open game in the group gets its next turn before any has another: sets first, then overtimes, then
      // one-on-ones, each round in schedule order. On its own, a series simply plays on (back to back).
      const open = team.filter((game) => !seriesDecided(series[game.id] ?? noScore, game.bestOf));
      const fewest = Math.min(...open.map((game) => turnsTaken(series[game.id] ?? noScore)));
      // Back to back, the group plays its games one after another, each to its end, in schedule order.
      const next =
        group && isBackToBack(list, group)
          ? (open.find((game) => game.id === currentGame.id) ?? open[0])
          : open.find((game) => turnsTaken(series[game.id] ?? noScore) === fewest);
      if (next && next.id === currentGame.id) {
        return score.tiebreak && score.tiebreakFrom
          ? { kind: "tiebreak", game: currentGame, schedule: pointer(currentGame), tiebreak: score.tiebreak, from: score.tiebreakFrom }
          : { kind: "series", game: currentGame, schedule: pointer(currentGame) };
      }
      if (next) return { kind: "game", game: next, schedule: pointer(next) };
      // The group is done: carry on from where it started, so games the schedule puts between its members (another
      // division's 3rd place game between this one's 3rd place and final) are played, not skipped.
      if (team.length > 1) resumeAfter = list.games.indexOf(team[0]);
    }
  }

  // A removed current row carries on after its game number rather than starting the list again.
  const after =
    current >= 0
      ? (_game: ScheduledGame, index: number) => index > resumeAfter
      : inList?.gameId != null
        ? (game: ScheduledGame) => game.gameId !== null && game.gameId > inList.gameId!
        : () => true;
  const isDone = (game: ScheduledGame) => game.id === currentGame?.id || (series[game.id] ? seriesDecided(series[game.id], game.bestOf) : false);
  const next = list.games.find((game, index) => game.kind === "game" && after(game, index) && !isDone(game));
  return next ? { kind: "game", game: next, schedule: scheduleForGame(list, next, inList ? { ...inList, series } : null) } : { kind: "end" };
}
