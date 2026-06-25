import { matchTeamName } from "./teamMatching.js";
import { normalizeTeamName } from "./teamMatching.js";
import type { NormalizedLiveState, TeamRecord, TeamMatchResult } from "./theme.js";

type RawTimer = { value?: number; state?: number } | null | undefined;
type RawTeam = {
  name?: string;
  score?: number;
  playersAlive?: number;
  timer?: RawTimer;
  midName?: string;
  image?: string;
};

type RawLiveState = {
  state?: string;
  period?: string;
  round?: number;
  sidesSwitched?: number;
  secondGame?: false | RawTeam[];
  breakTimer?: RawTimer;
  gameTimer?: RawTimer;
  mainGame?: RawTeam[];
};

function inferPeriod(
  raw: RawLiveState | null,
  state: string,
  gameTimer: ReturnType<typeof sanitizeTimer>,
  breakTimer: ReturnType<typeof sanitizeTimer>,
  previousPeriod?: string | null
) {
  const explicitPeriod = typeof raw?.period === "string" ? raw.period.trim() : "";
  if (explicitPeriod) {
    return raw?.period ?? explicitPeriod;
  }

  if (gameTimer.state === 2) {
    return "GAME";
  }

  if (breakTimer.state === 2) {
    return "BREAK";
  }

  if (state === "END") {
    return "BREAK";
  }

  if (state === "RUNNING") {
    return "GAME";
  }

  if (previousPeriod?.trim()) {
    return previousPeriod;
  }

  return "GAME";
}

function sanitizeTimer(timer: RawTimer) {
  return {
    value: Math.max(0, Number(timer?.value ?? 0)),
    state: Number(timer?.state ?? 0)
  };
}

function sanitizeTeam(team: RawTeam | undefined) {
  return {
    name: team?.name ?? "",
    score: Number(team?.score ?? 0),
    playersAlive: Number(team?.playersAlive ?? 0),
    timer: team?.timer
      ? {
          value: Number(team.timer.value ?? 0),
          state: Number(team.timer.state ?? 0)
        }
      : null,
    midName: team?.midName ?? "",
    image: team?.image ?? ""
  };
}

function applyScoreboardDisplayName(
  team: ReturnType<typeof sanitizeTeam>,
  match: ReturnType<typeof matchTeamName>
) {
  const preferred = match.team?.scoreboardDisplayName?.trim();
  if (!preferred) {
    return team;
  }
  return {
    ...team,
    name: preferred
  };
}

function createManualMatchResult(inputName: string, team: TeamRecord): TeamMatchResult {
  return {
    inputName,
    normalizedInput: normalizeTeamName(inputName),
    status: "matched",
    resolutionSource: "manual",
    confidence: 1,
    matchedAlias: "Manual override",
    teamId: team.id,
    team,
    candidates: []
  };
}

export function normalizeLiveState(
  raw: RawLiveState | null,
  options?: {
    sourceStatus?: "idle" | "ok" | "error" | "paused";
    fetchedAt?: string | null;
    errorMessage?: string | null;
    previousPeriod?: string | null;
    teams?: TeamRecord[];
    teamOverrides?: {
      left?: TeamRecord | null;
      right?: TeamRecord | null;
    };
  }
): NormalizedLiveState {
  const homeTeamRaw = sanitizeTeam(raw?.mainGame?.[0]);
  const awayTeamRaw = sanitizeTeam(raw?.mainGame?.[1]);
  const sidesSwitched = Number(raw?.sidesSwitched ?? 0);
  const state = raw?.state ?? "STOPPED";
  const breakTimer = sanitizeTimer(raw?.breakTimer);
  const gameTimer = sanitizeTimer(raw?.gameTimer);
  const period = inferPeriod(raw, state, gameTimer, breakTimer, options?.previousPeriod);
  const teamEvent =
    state === "TOWEL1"
      ? "towel-home"
      : state === "TOWEL2"
        ? "towel-away"
        : state === "BASE1"
          ? "base-away"
          : state === "BASE2"
            ? "base-home"
            : "none";
  const teams = options?.teams ?? [];
  const homeTeamMatch = options?.teamOverrides?.left ? createManualMatchResult(homeTeamRaw.name, options.teamOverrides.left) : matchTeamName(homeTeamRaw.name, teams);
  const awayTeamMatch = options?.teamOverrides?.right ? createManualMatchResult(awayTeamRaw.name, options.teamOverrides.right) : matchTeamName(awayTeamRaw.name, teams);
  const homeTeam = applyScoreboardDisplayName(homeTeamRaw, homeTeamMatch);
  const awayTeam = applyScoreboardDisplayName(awayTeamRaw, awayTeamMatch);
  // Upstream emits mainGame in display order (left, right).
  const leftTeam = homeTeam;
  const rightTeam = awayTeam;
  const displayLeftTeamMatch = homeTeamMatch;
  const displayRightTeamMatch = awayTeamMatch;
  const unresolvedTeamNames = [homeTeamMatch, awayTeamMatch]
    .filter((match) => match.status !== "matched" && match.inputName.trim())
    .map((match) => match.inputName);

  return {
    sourceStatus: options?.sourceStatus ?? "idle",
    fetchedAt: options?.fetchedAt ?? null,
    errorMessage: options?.errorMessage ?? null,
    state,
    period,
    round: Number(raw?.round ?? 0),
    sidesSwitched,
    secondGame: Array.isArray(raw?.secondGame) ? raw.secondGame.map(sanitizeTeam) : false,
    homeTeam,
    awayTeam,
    displayLeftTeam: leftTeam,
    displayRightTeam: rightTeam,
    homeTeamMatch,
    awayTeamMatch,
    displayLeftTeamMatch,
    displayRightTeamMatch,
    unresolvedTeamNames,
    breakTimer,
    gameTimer,
    teamEvent
  };
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
