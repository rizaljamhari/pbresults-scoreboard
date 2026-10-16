import { generateTeamAliases, normalizeTeamName } from "../../shared/teamMatching";
import type { TeamRecord } from "../../shared/theme";

export type TeamSearchResult = {
  team: TeamRecord;
  via: string | null;
};

// Ranks active teams against the typed query: name prefix, then alias/live-name prefix, then substring.
export function searchTeams(teams: TeamRecord[], query: string, limit = 6): TeamSearchResult[] {
  const needle = normalizeTeamName(query);
  if (!needle) {
    return [];
  }

  const ranked: Array<TeamSearchResult & { rank: number }> = [];
  for (const team of teams) {
    if (!team.active) {
      continue;
    }
    const name = normalizeTeamName(team.canonicalName);
    if (name.startsWith(needle)) {
      ranked.push({ team, via: null, rank: 0 });
      continue;
    }
    const aliases = generateTeamAliases(team);
    const aliasPrefix = aliases.find((alias) => normalizeTeamName(alias).startsWith(needle));
    if (aliasPrefix) {
      ranked.push({ team, via: aliasPrefix, rank: 1 });
      continue;
    }
    if (name.includes(needle)) {
      ranked.push({ team, via: null, rank: 2 });
      continue;
    }
    const aliasContains = aliases.find((alias) => normalizeTeamName(alias).includes(needle));
    if (aliasContains) {
      ranked.push({ team, via: aliasContains, rank: 3 });
    }
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || a.team.canonicalName.localeCompare(b.team.canonicalName))
    .slice(0, limit)
    .map(({ team, via }) => ({ team, via }));
}
