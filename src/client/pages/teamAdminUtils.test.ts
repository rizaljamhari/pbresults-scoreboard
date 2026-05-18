import { describe, expect, it } from "vitest";
import type { TeamRecord } from "../../shared/theme";
import { filterAndSortTeams, hasTeamUnsavedChanges } from "./teamAdminUtils";

function makeTeam(overrides: Partial<TeamRecord>): TeamRecord {
  return {
    id: overrides.id ?? "team-1",
    canonicalName: overrides.canonicalName ?? "SBJ",
    scoreboardDisplayName: overrides.scoreboardDisplayName ?? "",
    shortName: overrides.shortName ?? "",
    aliases: overrides.aliases ?? [],
    liveMatchNames: overrides.liveMatchNames ?? [],
    logoAssetId: overrides.logoAssetId ?? null,
    alternateLogoAssetId: overrides.alternateLogoAssetId ?? null,
    notes: overrides.notes ?? "",
    active: overrides.active ?? true,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-02T00:00:00.000Z"
  };
}

describe("filterAndSortTeams", () => {
  const teams: TeamRecord[] = [
    makeTeam({ id: "a", canonicalName: "SBJ", shortName: "SBJ", aliases: ["Seattle"], active: true, updatedAt: "2026-01-02T10:00:00.000Z" }),
    makeTeam({ id: "b", canonicalName: "ALPHA", shortName: "ALP", aliases: ["Alpha Squad"], active: false, updatedAt: "2026-01-02T09:00:00.000Z" }),
    makeTeam({ id: "c", canonicalName: "BRAVO", shortName: "BRV", aliases: ["B-Team"], active: true, updatedAt: "2026-01-02T11:00:00.000Z" })
  ];

  it("filters by search across name, shortName, aliases, and learned live names", () => {
    const byAlias = filterAndSortTeams(teams, "alpha squad", "all", "nameAsc");
    expect(byAlias.map((team) => team.id)).toEqual(["b"]);

    const byShort = filterAndSortTeams(teams, "brv", "all", "nameAsc");
    expect(byShort.map((team) => team.id)).toEqual(["c"]);

    const byDisplayName = filterAndSortTeams(
      [
        ...teams,
        makeTeam({ id: "d", canonicalName: "Omega Squad", scoreboardDisplayName: "OSQ", aliases: [] })
      ],
      "osq",
      "all",
      "nameAsc"
    );
    expect(byDisplayName.map((team) => team.id)).toEqual(["d"]);

    const byLearnedLiveName = filterAndSortTeams(
      [...teams, makeTeam({ id: "e", canonicalName: "Bandits Project", liveMatchNames: ["BANDIT"] })],
      "bandit",
      "all",
      "nameAsc"
    );
    expect(byLearnedLiveName.map((team) => team.id)).toEqual(["e"]);
  });

  it("filters by active status", () => {
    const activeOnly = filterAndSortTeams(teams, "", "active", "nameAsc");
    expect(activeOnly.map((team) => team.id)).toEqual(["c", "a"]);

    const inactiveOnly = filterAndSortTeams(teams, "", "inactive", "nameAsc");
    expect(inactiveOnly.map((team) => team.id)).toEqual(["b"]);
  });

  it("sorts by update timestamp", () => {
    const newestFirst = filterAndSortTeams(teams, "", "all", "updatedDesc");
    expect(newestFirst.map((team) => team.id)).toEqual(["c", "a", "b"]);

    const oldestFirst = filterAndSortTeams(teams, "", "all", "updatedAsc");
    expect(oldestFirst.map((team) => team.id)).toEqual(["b", "a", "c"]);
  });
});

describe("hasTeamUnsavedChanges", () => {
  it("returns false for identical draft and source", () => {
    const source = makeTeam({ id: "sbj" });
    const draft = { ...source };
    expect(hasTeamUnsavedChanges(draft, source)).toBe(false);
  });

  it("returns true when editable field changes", () => {
    const source = makeTeam({ id: "sbj" });
    const draft = { ...source, notes: "updated notes" };
    expect(hasTeamUnsavedChanges(draft, source)).toBe(true);
  });
});
