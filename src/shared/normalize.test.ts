import { describe, expect, it } from "vitest";
import { formatClock, normalizeLiveState } from "./normalize";
import type { TeamRecord } from "./theme";

const registry: TeamRecord[] = [
  {
    id: "team-sbj",
    canonicalName: "Seattle Uprising",
    scoreboardDisplayName: "SBJ Prime",
    shortName: "SBJ",
    aliases: ["Uprising", "Seattle Uprising", "Seattle"],
    liveMatchNames: [],
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
    const towel1 = normalizeLiveState({
      state: "TOWEL1",
      mainGame: [{ name: "H", score: 0 }, { name: "A", score: 0 }]
    });
    expect(towel1.teamEvent).toBe("towel-home");

    expect(
      normalizeLiveState({
        state: "TOWEL2",
        mainGame: [{ name: "H", score: 0 }, { name: "A", score: 0 }]
      }).teamEvent
    ).toBe("towel-away");

    expect(
      normalizeLiveState({
        state: "BASE1",
        mainGame: [{ name: "H", score: 0 }, { name: "A", score: 0 }]
      }).teamEvent
    ).toBe("base-away");

    expect(
      normalizeLiveState({
        state: "BASE2",
        mainGame: [{ name: "H", score: 0 }, { name: "A", score: 0 }]
      }).teamEvent
    ).toBe("base-home");
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
    expect(result.homeTeam.name).toBe("SBJ Prime");
    expect(result.displayLeftTeam.name).toBe("SBJ Prime");
    expect(result.displayLeftTeamMatch.team?.canonicalName).toBe("Seattle Uprising");
    expect(result.awayTeamMatch.status).toBe("unmatched");
    expect(result.unresolvedTeamNames).toEqual(["Unknown Squad"]);
  });

  it("applies manual team overrides to the current raw live names", () => {
    const overrideTeam: TeamRecord = {
      id: "team-override",
      canonicalName: "Override Squad",
      scoreboardDisplayName: "OVERRIDE",
      shortName: "OVR",
      aliases: [],
      liveMatchNames: [],
      logoAssetId: null,
      alternateLogoAssetId: null,
      notes: "",
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = normalizeLiveState(
      {
        state: "RUNNING",
        period: "GAME",
        mainGame: [{ name: "Unknown Squad", score: 1 }, { name: "SBJ", score: 0 }]
      },
      {
        teams: registry,
        teamOverrides: {
          left: overrideTeam
        }
      }
    );

    expect(result.displayLeftTeamMatch.status).toBe("matched");
    expect(result.displayLeftTeamMatch.resolutionSource).toBe("manual");
    expect(result.displayLeftTeamMatch.team?.canonicalName).toBe("Override Squad");
    expect(result.displayLeftTeam.name).toBe("OVERRIDE");
  });

  it("infers GAME when period is missing and the game timer is running", () => {
    const result = normalizeLiveState({
      mainGame: [{ name: "MPKK", score: 0 }, { name: "MPS", score: 0 }],
      sidesSwitched: 0,
      secondGame: false,
      breakTimer: { value: 0, state: 0 },
      gameTimer: { value: 146, state: 2 }
    });

    expect(result.state).toBe("STOPPED");
    expect(result.period).toBe("GAME");
  });

  it("reuses the previous period when upstream omits period and both timers are idle", () => {
    const result = normalizeLiveState(
      {
        state: "STOPPED",
        mainGame: [{ name: "MPKK", score: 0 }, { name: "MPS", score: 0 }],
        breakTimer: { value: 0, state: 0 },
        gameTimer: { value: 0, state: 0 }
      },
      {
        previousPeriod: "BREAK"
      }
    );

    expect(result.period).toBe("BREAK");
  });
});

describe("formatClock", () => {
  it("formats mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
  });
});
