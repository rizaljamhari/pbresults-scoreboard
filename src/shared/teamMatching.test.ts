import { describe, expect, it } from "vitest";
import { generateTeamAliases, matchTeamName, normalizeTeamName } from "./teamMatching";
import type { TeamRecord } from "./theme";

const teams: TeamRecord[] = [
  {
    id: "team-1",
    canonicalName: "Seattle Uprising",
    scoreboardDisplayName: "",
    shortName: "SBJ",
    aliases: ["Uprising", "Seattle Uprising"],
    liveMatchNames: [],
    logoAssetId: null,
    alternateLogoAssetId: null,
    notes: "",
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "team-2",
    canonicalName: "Edmonton Impact",
    scoreboardDisplayName: "",
    shortName: "Impact",
    aliases: ["Edmonton", "E Impact"],
    liveMatchNames: [],
    logoAssetId: null,
    alternateLogoAssetId: null,
    notes: "",
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

describe("normalizeTeamName", () => {
  it("normalizes punctuation and spacing", () => {
    expect(normalizeTeamName(" Seattle  Uprising! ")).toBe("SEATTLE UPRISING");
  });
});

describe("generateTeamAliases", () => {
  it("includes generated acronym aliases", () => {
    const aliases = generateTeamAliases(teams[0]);
    expect(aliases).toContain("SU");
    expect(aliases).toContain("SBJ");
  });

  it("includes the scoreboard display name when provided", () => {
    const aliases = generateTeamAliases({
      ...teams[0],
      scoreboardDisplayName: "Seattle Up"
    });
    expect(aliases).toContain("Seattle Up");
  });

  it("includes learned live match names when provided", () => {
    const aliases = generateTeamAliases({
      ...teams[0],
      liveMatchNames: ["BANDIT"]
    });
    expect(aliases).toContain("BANDIT");
  });
});

describe("matchTeamName", () => {
  it("matches on exact aliases", () => {
    const result = matchTeamName("SBJ", teams);
    expect(result.status).toBe("matched");
    expect(result.team?.id).toBe("team-1");
  });

  it("suggests candidates for fuzzy names without auto-matching", () => {
    const result = matchTeamName("Edmonton Impct", teams);
    expect(result.status).toBe("uncertain");
    expect(result.candidates[0]?.teamId).toBe("team-2");
  });

  it("returns unmatched when no candidates are close enough", () => {
    const result = matchTeamName("Completely Different", teams);
    expect(result.status).toBe("unmatched");
    expect(result.candidates).toEqual([]);
  });

  it("treats learned live match names as strong exact matches", () => {
    const result = matchTeamName("BANDIT", [
      {
        ...teams[0],
        liveMatchNames: ["BANDIT"]
      },
      teams[1]
    ]);

    expect(result.status).toBe("matched");
    expect(result.team?.id).toBe("team-1");
    expect(result.matchedAlias).toBe("BANDIT");
  });

  it("ignores inactive teams even when the alias is an exact match", () => {
    const result = matchTeamName("BANDIT", [
      {
        ...teams[0],
        active: false,
        liveMatchNames: ["BANDIT"]
      },
      teams[1]
    ]);

    expect(result.status).toBe("unmatched");
    expect(result.team).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});
