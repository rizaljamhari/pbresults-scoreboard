import type { AppSettings, NormalizedLiveState, ThemeDefinition } from "../../shared/theme";

export type LiveSummary = {
  tone: "ok" | "warning" | "critical";
  feedTone: "live" | "warning" | "critical" | undefined;
  feedLabel: string;
  stateLabel: string;
};

function secondsAgo(fetchedAt: string | null, now: number) {
  if (!fetchedAt) return null;
  const at = Date.parse(fetchedAt);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((now - at) / 1000));
}

/**
 * The short status the sidebar shows on every page. Operations holds the full list of checks; this names the
 * most important one so an operator elsewhere in the admin still sees when the broadcast needs attention.
 */
export function liveSummary(
  live: NormalizedLiveState | null,
  settings: AppSettings | null,
  onAirTheme: Pick<ThemeDefinition, "id" | "name"> | null,
  now = Date.now()
): LiveSummary {
  if (!live || live.sourceStatus === "idle") {
    return { tone: "warning", feedTone: undefined, feedLabel: "Waiting", stateLabel: "Waiting for the feed" };
  }
  if (live.sourceStatus === "error") {
    return { tone: "critical", feedTone: "critical", feedLabel: "Unreachable", stateLabel: "Live feed unreachable" };
  }

  const age = secondsAgo(live.fetchedAt, now);
  const staleAfter = Math.max(5, Math.round(((settings?.pollIntervalMs ?? 1000) * 5) / 1000));
  const paused = live.sourceStatus === "paused";
  const stale = !paused && age !== null && age > staleAfter;
  const feedLabel = paused ? "Paused" : age === null ? "Live" : age <= 1 ? "Live · just now" : `Live · ${age}s ago`;
  const feedTone = paused || stale ? "warning" : "live";

  if (!onAirTheme) {
    return { tone: "critical", feedTone, feedLabel, stateLabel: "No theme on air" };
  }
  if (paused) {
    return { tone: "warning", feedTone, feedLabel, stateLabel: "Polling is stopped" };
  }
  if (stale) {
    return { tone: "warning", feedTone, feedLabel, stateLabel: "Feed data is out of date" };
  }
  const unresolved = live.unresolvedTeamNames.length;
  if (unresolved > 0) {
    return {
      tone: "warning",
      feedTone,
      feedLabel,
      stateLabel: unresolved === 1 ? "1 team name needs a team" : `${unresolved} team names need a team`
    };
  }
  return { tone: "ok", feedTone, feedLabel, stateLabel: "All checks clear" };
}
