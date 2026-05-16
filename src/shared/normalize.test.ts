import { describe, expect, it } from "vitest";
import { formatClock, normalizeLiveState } from "./normalize";
import type { TeamRecord } from "./theme";

const registry: TeamRecord[] = [
  {
    id: "team-sbj",
    canonicalName: "Seattle Uprising",
    shortName: "SBJ",
    aliases: ["Uprising", "Seattle Uprising", "Seattle"],
    logoAssetId: null,
    alternateLogoAssetId: null,
    notes: "",
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

describe("normalizeLiveState", () => {
  it("keeps rendered left/right teams aligned with mainGame payload order", () => {
    const result = normalizeLiveState({
      state: "RUNNING",
      period: "GAME",
      sidesSwitched: 1,
      mainGame: [
        { name: "Alpha", score: 2 },
        { name: "SBJ", score: 3 }
      ],
      breakTimer: { value: 0, state: 0 },
      gameTimer: { value: 42, state: 2 },
      secondGame: false
    });

    expect(result.homeTeam.name).toBe("Alpha");
    expect(result.awayTeam.name).toBe("SBJ");
    expect(result.displayLeftTeam.name).toBe("Alpha");
    expect(result.displayRightTeam.name).toBe("SBJ");
    expect(result.displayLeftTeamMatch.status).toBe("unmatched");
  });

  it("maps towel events from top-level state", () => {
    expect(
      normalizeLiveState({
        state: "TOWEL1",
        mainGame: [{ name: "H", score: 0 }, { name: "A", score: 0 }]
      }).towelEvent
    ).toBe("home");

    expect(
      normalizeLiveState({
        state: "TOWEL2",
        mainGame: [{ name: "H", score: 0 }, { name: "A", score: 0 }]
      }).towelEvent
    ).toBe("away");
  });

  it("resolves team records and reports unmatched names", () => {
    const result = normalizeLiveState(
      {
        state: "RUNNING",
        period: "GAME",
        mainGame: [{ name: "SBJ", score: 1 }, { name: "Unknown Squad", score: 0 }]
      },
      { teams: registry }
    );

    expect(result.homeTeamMatch.status).toBe("matched");
    expect(result.homeTeamMatch.team?.canonicalName).toBe("Seattle Uprising");
    expect(result.displayLeftTeamMatch.team?.canonicalName).toBe("Seattle Uprising");
    expect(result.awayTeamMatch.status).toBe("unmatched");
    expect(result.unresolvedTeamNames).toEqual(["Unknown Squad"]);
  });
});

describe("formatClock", () => {
  it("formats mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
  });
});
