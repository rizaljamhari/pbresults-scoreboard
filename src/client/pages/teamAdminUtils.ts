import type { TeamRecord } from "../../shared/theme";

export type TeamStatusFilter = "all" | "active" | "inactive";
export type TeamSort = "nameAsc" | "nameDesc" | "updatedDesc" | "updatedAsc";

export function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

export function filterAndSortTeams(
  teams: TeamRecord[],
  search: string,
  statusFilter: TeamStatusFilter,
  sortBy: TeamSort
): TeamRecord[] {
  const query = search.trim().toLowerCase();
  const base = [...teams].filter((team) => {
    if (statusFilter === "active" && !team.active) {
      return false;
    }
    if (statusFilter === "inactive" && team.active) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [team.canonicalName, team.shortName, ...team.aliases].some((value) => value.toLowerCase().includes(query));
  });

  base.sort((left, right) => {
    if (sortBy === "nameAsc") {
      return left.canonicalName.localeCompare(right.canonicalName);
    }
    if (sortBy === "nameDesc") {
      return right.canonicalName.localeCompare(left.canonicalName);
    }

    const leftUpdatedAt = Date.parse(left.updatedAt);
    const rightUpdatedAt = Date.parse(right.updatedAt);
    const leftValue = Number.isNaN(leftUpdatedAt) ? 0 : leftUpdatedAt;
    const rightValue = Number.isNaN(rightUpdatedAt) ? 0 : rightUpdatedAt;
    return sortBy === "updatedDesc" ? rightValue - leftValue : leftValue - rightValue;
  });

  return base;
}

export function toComparableTeam(team: TeamRecord | null) {
  if (!team) {
    return null;
  }

  return {
    canonicalName: team.canonicalName,
    shortName: team.shortName,
    aliases: [...team.aliases],
    notes: team.notes,
    active: team.active,
    logoAssetId: team.logoAssetId,
    alternateLogoAssetId: team.alternateLogoAssetId
  };
}

export function hasTeamUnsavedChanges(draft: TeamRecord | null, selectedTeam: TeamRecord | null): boolean {
  return JSON.stringify(toComparableTeam(draft)) !== JSON.stringify(toComparableTeam(selectedTeam));
}
