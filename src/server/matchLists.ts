import { randomUUID } from "node:crypto";
import {
  isPlaceholderLabel,
  matchListSchema,
  sideStatus,
  type MatchList,
  type MatchListsState,
  type ScheduledGame,
  type ScheduledSide,
  type TeamMappingRequest
} from "../shared/matchList.js";
import { listExplicitTeamMatchNames, normalizeTeamName } from "../shared/teamMatching.js";
import type { TeamRecord } from "../shared/theme.js";
import {
  createTeamRecord,
  getMatchListsState,
  getTeamRecord,
  listTeamRecords,
  rememberTeamLiveMatchName,
  saveMatchListsState,
  saveTeamRecord
} from "./storage.js";

export class MatchListError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

const sameLabel = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * The one team that has this exact name among the names it was given (name, scoreboard name, short name, aliases,
 * remembered names), or null. Names the matcher derives (initials, last word) do not count: a printed "Legion" must
 * not become "Anarki Legion", nor "Loco Legion" anything at all.
 */
export function exactTeamFor(label: string, teams: TeamRecord[], options: { includeInactive?: boolean } = {}): TeamRecord | null {
  const wanted = normalizeTeamName(label);
  if (!wanted) return null;
  const hits = teams.filter(
    (team) => (team.active || options.includeInactive) && listExplicitTeamMatchNames(team).some((name) => normalizeTeamName(name) === wanted)
  );
  return hits.length === 1 ? hits[0] : null;
}

/** Links each printed name that is exactly one active team's name. Anything less certain is left for the operator. */
export function autoLinkGames(games: ScheduledGame[], teams: TeamRecord[]): ScheduledGame[] {
  const cache = new Map<string, string | null>();
  const link = (side: ScheduledSide): ScheduledSide => {
    if (sideStatus(side) !== "unlinked") return side;
    const key = normalizeTeamName(side.label);
    if (!cache.has(key)) cache.set(key, exactTeamFor(side.label, teams)?.id ?? null);
    const teamId = cache.get(key) ?? null;
    return teamId ? { ...side, teamId, name: "" } : side;
  };
  return games.map((game) => (game.kind === "game" ? { ...game, home: link(game.home), away: link(game.away) } : game));
}

function requireList(state: MatchListsState, id: string): MatchList {
  const list = state.lists.find((item) => item.id === id);
  if (!list) throw new MatchListError("Match list not found", 404);
  return list;
}

function replaceList(state: MatchListsState, list: MatchList): MatchListsState {
  return { ...state, lists: state.lists.map((item) => (item.id === list.id ? list : item)) };
}

export function createMatchList(input: { name: string; sourceFileName?: string | null; games: ScheduledGame[] }): MatchList {
  const now = new Date().toISOString();
  const list = matchListSchema.parse({
    id: `matches-${randomUUID()}`,
    name: input.name,
    sourceFileName: input.sourceFileName ?? null,
    createdAt: now,
    updatedAt: now,
    // New ids, so a list made twice from one PDF never shares games.
    games: autoLinkGames(
      input.games.map((game) => ({ ...game, id: randomUUID() })),
      listTeamRecords()
    )
  });
  const state = getMatchListsState();
  saveMatchListsState({ ...state, lists: [...state.lists, list] });
  return list;
}

export function updateMatchList(id: string, input: { name: string; games: ScheduledGame[]; backToBackGroups?: string[] }): MatchList {
  const state = getMatchListsState();
  const current = requireList(state, id);
  const list = matchListSchema.parse({
    ...current,
    name: input.name,
    games: input.games,
    backToBackGroups: input.backToBackGroups ?? current.backToBackGroups,
    updatedAt: new Date().toISOString()
  });
  saveMatchListsState(replaceList(state, list));
  return list;
}

export function deleteMatchList(id: string) {
  const state = getMatchListsState();
  requireList(state, id);
  saveMatchListsState({ activeListId: state.activeListId === id ? null : state.activeListId, lists: state.lists.filter((item) => item.id !== id) });
}

export function setActiveMatchList(id: string | null): MatchListsState {
  const state = getMatchListsState();
  if (id) requireList(state, id);
  return saveMatchListsState({ ...state, activeListId: id });
}

/**
 * Applies one decision for a printed team name to every game in the list that prints it. Linking also teaches the
 * team that name (and switches the team back on), so the next day's schedule links by itself.
 */
export function applyTeamMapping(listId: string, request: TeamMappingRequest): { list: MatchList; changedTeamIds: string[] } {
  const state = getMatchListsState();
  const list = requireList(state, listId);
  const label = request.label.trim();
  if (isPlaceholderLabel(label)) throw new MatchListError(`"${label}" is a seeding reference, not a team. Set the game's team directly.`);
  const changedTeamIds: string[] = [];

  let side: Pick<ScheduledSide, "teamId" | "name">;
  if (request.action === "link") {
    let team = getTeamRecord(request.teamId);
    if (!team) throw new MatchListError("Team not found", 404);
    if (!team.active) team = saveTeamRecord({ ...team, active: true });
    try {
      rememberTeamLiveMatchName(team.id, label, { forceReassign: true });
    } catch {
      // The name already belongs to another team's own names: link this list anyway, without remembering it.
    }
    changedTeamIds.push(team.id);
    side = { teamId: team.id, name: "" };
  } else if (request.action === "create") {
    // Already in Teams under this exact name (a second click, or added since): use it rather than make a twin.
    const existing = exactTeamFor(label, listTeamRecords(), { includeInactive: true });
    const team = existing ? (existing.active ? existing : saveTeamRecord({ ...existing, active: true })) : createTeamRecord({ canonicalName: label.slice(0, 80) });
    changedTeamIds.push(team.id);
    side = { teamId: team.id, name: "" };
  } else if (request.action === "text") {
    side = { teamId: null, name: label.slice(0, 40) };
  } else {
    side = { teamId: null, name: "" };
  }

  const apply = (current: ScheduledSide): ScheduledSide => (sameLabel(current.label, label) ? { ...current, ...side } : current);
  const next = matchListSchema.parse({
    ...list,
    updatedAt: new Date().toISOString(),
    games: list.games.map((game) => (game.kind === "game" ? { ...game, home: apply(game.home), away: apply(game.away) } : game))
  });
  saveMatchListsState(replaceList(state, next));
  return { list: next, changedTeamIds };
}
