import { matchTeamName } from "./teamMatching.js";
function sanitizeTimer(timer) {
    return {
        value: Math.max(0, Number(timer?.value ?? 0)),
        state: Number(timer?.state ?? 0)
    };
}
function sanitizeTeam(team) {
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
export function normalizeLiveState(raw, options) {
    const homeTeam = sanitizeTeam(raw?.mainGame?.[0]);
    const awayTeam = sanitizeTeam(raw?.mainGame?.[1]);
    const sidesSwitched = Number(raw?.sidesSwitched ?? 0);
    const leftTeam = sidesSwitched === 1 ? awayTeam : homeTeam;
    const rightTeam = sidesSwitched === 1 ? homeTeam : awayTeam;
    const state = raw?.state ?? "STOPPED";
    const towelEvent = state === "TOWEL1" ? "home" : state === "TOWEL2" ? "away" : "none";
    const teams = options?.teams ?? [];
    const homeTeamMatch = matchTeamName(homeTeam.name, teams);
    const awayTeamMatch = matchTeamName(awayTeam.name, teams);
    const displayLeftTeamMatch = sidesSwitched === 1 ? awayTeamMatch : homeTeamMatch;
    const displayRightTeamMatch = sidesSwitched === 1 ? homeTeamMatch : awayTeamMatch;
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
export function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
