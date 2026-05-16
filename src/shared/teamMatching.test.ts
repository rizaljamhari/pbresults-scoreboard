import { describe, expect, it } from "vitest";
import { generateTeamAliases, matchTeamName, normalizeTeamName } from "./teamMatching";
import type { TeamRecord } from "./theme";

const teams: TeamRecord[] = [
  {
    id: "team-1",
    canonicalName: "Seattle Uprising",
    shortName: "SBJ",
    aliases: ["Uprising", "Seattle Uprising"],
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
    shortName: "Impact",
    aliases: ["Edmonton", "E Impact"],
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
});
