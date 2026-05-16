import { matchTeamName } from "./teamMatching.js";
import type { NormalizedLiveState, TeamRecord } from "./theme.js";

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

export function normalizeLiveState(
  raw: RawLiveState | null,
  options?: {
    sourceStatus?: "idle" | "ok" | "error";
    fetchedAt?: string | null;
    errorMessage?: string | null;
    teams?: TeamRecord[];
  }
): NormalizedLiveState {
  const homeTeam = sanitizeTeam(raw?.mainGame?.[0]);
  const awayTeam = sanitizeTeam(raw?.mainGame?.[1]);
  const sidesSwitched = Number(raw?.sidesSwitched ?? 0);
  // Upstream already emits mainGame in display order (left, right).
  // Keep display slots aligned to payload order to avoid double swapping.
  const leftTeam = homeTeam;
  const rightTeam = awayTeam;
  const state = raw?.state ?? "STOPPED";
  const towelEvent = state === "TOWEL1" ? "home" : state === "TOWEL2" ? "away" : "none";
  const teams = options?.teams ?? [];
  const homeTeamMatch = matchTeamName(homeTeam.name, teams);
  const awayTeamMatch = matchTeamName(awayTeam.name, teams);
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
    period: raw?.period ?? "BREAK",
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
    breakTimer: sanitizeTimer(raw?.breakTimer),
    gameTimer: sanitizeTimer(raw?.gameTimer),
    towelEvent
  };
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
