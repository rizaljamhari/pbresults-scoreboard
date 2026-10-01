import { describe, expect, it } from "vitest";
import { isTimeoutJump } from "../client/components/momentTriggers";
import { builtinThemes } from "./builtinThemes";
import { normalizeLiveState } from "./normalize";
import {
  REHEARSAL_CASE_COUNT,
  buildRehearsalCases,
  cardExpectation,
  logoExpectation,
  makePossibleName,
  pickRehearsalSamples,
  type RehearsalContext,
  type RehearsalFrame
} from "./rehearsalCases";
import type { TeamRecord, ThemeDefinition } from "./theme";

function team(id: string, name: string, logo: string | null = null): TeamRecord {
  return {
    id,
    canonicalName: name,
    scoreboardDisplayName: name.toUpperCase(),
    shortName: id.toUpperCase(),
    aliases: [id.toUpperCase()],
    liveMatchNames: [],
    logoAssetId: logo,
    alternateLogoAssetId: null,
    notes: "",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

const registry = [
  team("sl", "SL", "logo-sl"),
  team("kuda", "Kuda", "logo-kuda"),
  team("saus", "Sausage Squad", "logo-saus"),
  team("anarki", "Anarki Legion", null),
  team("beruang", "Beruang X Paintball Club", "logo-beruang"),
  team("old", "Retired Team", "logo-old")
];
registry[5].active = false;
const assets = ["logo-sl", "logo-kuda", "logo-saus", "logo-beruang", "logo-old", "slot-left", "event-logo"].map((id) => ({ id }));

function context(adjust?: (theme: ThemeDefinition) => void): RehearsalContext {
  const theme = structuredClone(builtinThemes[0]);
  adjust?.(theme);
  return { theme, teams: registry, assets };
}

function normalized(frame: RehearsalFrame) {
  return normalizeLiveState(frame.raw, {
    sourceStatus: frame.sourceStatus ?? "ok",
    fetchedAt: "2026-10-02T10:00:00.000Z",
    teams: registry,
    teamOverrides: { left: frame.left, right: frame.right }
  });
}

describe("rehearsal samples", () => {
  const samples = pickRehearsalSamples(registry, assets);

  it("uses the registry's shortest and longest active names", () => {
    expect(samples.shortest.map((item) => item.id)).toEqual(["sl", "kuda"]);
    expect(samples.longest[0].id).toBe("beruang");
    expect([...samples.shortest, ...samples.longest].some((item) => item.id === "old")).toBe(false);
  });

  it("picks a real team without a logo, and teams with logos for the baseline", () => {
    expect(samples.noLogo.id).toBe("anarki");
    expect(samples.typical.every((item) => item.logoAssetId)).toBe(true);
  });

  it("makes up a no-logo sample when every team has one, without saving it", () => {
    const withLogos = registry.filter((item) => item.logoAssetId);
    expect(pickRehearsalSamples(withLogos, assets).noLogo.id).toMatch(/^rehearsal-/);
  });

  it("uses names the matcher cannot place", () => {
    const sections = buildRehearsalCases(context());
    const unknown = sections.find((item) => item.id === "names-unknown")!;
    const live = normalized(unknown.frames[0]);
    expect(live.displayLeftTeamMatch.status).not.toBe("matched");
    expect(live.displayRightTeamMatch.status).not.toBe("matched");
  });
});

describe("possible team", () => {
  it("builds near-miss names the real matcher is unsure about, suggesting the right team", () => {
    const cases = buildRehearsalCases(context());
    const possible = cases.find((item) => item.id === "names-possible")!;
    const live = normalized(possible.frames[0]);
    for (const match of [live.displayLeftTeamMatch, live.displayRightTeamMatch]) {
      expect(match.status).toBe("uncertain");
      expect(match.team).toBeNull();
      expect(match.candidates.length).toBeGreaterThan(0);
    }
    expect(live.displayLeftTeamMatch.candidates[0].teamId).not.toBe(live.displayRightTeamMatch.candidates[0].teamId);
    expect(possible.expectation).toContain("not the suggested teams");
  });

  it("only accepts a name when the matcher points at that team", () => {
    const kuda = registry.find((item) => item.id === "kuda")!;
    const possible = makePossibleName(kuda, registry);
    expect(possible?.suggests.id).toBe("kuda");
    expect(possible && makePossibleName(kuda, [])).toBeNull();
  });

  it("falls back to an unknown team when there is nothing to build from", () => {
    const cases = buildRehearsalCases({ theme: structuredClone(builtinThemes[0]), teams: [], assets: [] });
    expect(cases.find((item) => item.id === "names-possible")!.expectation).toContain("plays like an unknown team");
  });
});

describe("rehearsal cases", () => {
  const cases = buildRehearsalCases(context());

  it("runs the full catalog once, with unique ids", () => {
    expect(cases).toHaveLength(REHEARSAL_CASE_COUNT);
    expect(new Set(cases.map((item) => item.id)).size).toBe(REHEARSAL_CASE_COUNT);
    expect(cases.every((item) => item.frames.length > 0 && item.expectation)).toBe(true);
  });

  it("puts each event on the right side through the real normalizer", () => {
    const event = (id: string) => normalized(cases.find((item) => item.id === id)!.frames[0]).teamEvent;
    expect(event("towel-left")).toBe("towel-home");
    expect(event("towel-right")).toBe("towel-away");
    expect(event("base-left")).toBe("base-home");
    expect(event("base-right")).toBe("base-away");
  });

  it("keeps the home team on the right when sides are switched", () => {
    const live = normalized(cases.find((item) => item.id === "sides-switched")!.frames[0]);
    expect(live.sidesSwitched).toBe(1);
    expect(live.teamEvent).toBe("towel-home");
    const [home] = pickRehearsalSamples(registry, assets).typical;
    expect(live.displayRightTeamMatch.team?.id).toBe(home.id);
  });

  it("trips the real timeout rule with the theme's threshold", () => {
    const timeoutCase = cases.find((item) => item.id === "timeout")!;
    const [before, after] = timeoutCase.frames.map(normalized);
    expect(isTimeoutJump(before, after, builtinThemes[0].momentOverlays.timeout.minIncreaseSeconds)).toBe(true);
  });

  it("follows a raised timeout threshold", () => {
    const timeoutCase = buildRehearsalCases(context((theme) => (theme.momentOverlays.timeout.minIncreaseSeconds = 300))).find((item) => item.id === "timeout")!;
    const [before, after] = timeoutCase.frames.map(normalized);
    expect(isTimeoutJump(before, after, 300)).toBe(true);
  });

  it("ends games with a real END in a break", () => {
    const live = normalized(cases.find((item) => item.id === "finished-tie")!.frames[0]);
    expect([live.state, live.period]).toEqual(["END", "BREAK"]);
    expect(cases.find((item) => item.id === "finished-tie")!.expectation).toContain("NO winner card");
  });

  it("marks the lost-feed case as an error without changing the data", () => {
    const lost = cases.find((item) => item.id === "feed-lost")!;
    expect(normalized(lost.frames[0]).sourceStatus).toBe("error");
  });
});

describe("transition and clash cases", () => {
  const cases = buildRehearsalCases(context());
  const frames = (id: string) => cases.find((item) => item.id === id)!.frames.map(normalized);

  it("goes game, break, game", () => {
    expect(frames("game-break-game").map((live) => live.period)).toEqual(["GAME", "BREAK", "GAME"]);
  });

  it("clears the towel back to no event", () => {
    expect(frames("towel-clears").map((live) => live.teamEvent)).toEqual(["towel-home", "none"]);
  });

  it("ends the game, then starts a new match with other teams", () => {
    const [ended, next] = frames("finished-next");
    expect([ended.state, ended.period]).toEqual(["END", "BREAK"]);
    expect(next.state).not.toBe("END");
    expect(next.displayLeftTeamMatch.team?.id).not.toBe(ended.displayLeftTeamMatch.team?.id);
  });

  it("replaces a towel with a base on the other side", () => {
    expect(frames("towel-then-base").map((live) => live.teamEvent)).toEqual(["towel-home", "base-away"]);
  });

  it("jumps the break clock after the game ended without tripping the timeout rule", () => {
    const [before, after] = frames("timeout-while-finished");
    expect(after.breakTimer.value - before.breakTimer.value).toBeGreaterThanOrEqual(builtinThemes[0].momentOverlays.timeout.minIncreaseSeconds);
    expect(isTimeoutJump(before, after, builtinThemes[0].momentOverlays.timeout.minIncreaseSeconds)).toBe(false);
    expect(cases.find((item) => item.id === "timeout-while-finished")!.expectation).toContain("NO timeout flashes");
  });

  it("comes back from a lost feed with new data", () => {
    const [lost, back] = frames("feed-back");
    expect([lost.sourceStatus, back.sourceStatus]).toEqual(["error", "ok"]);
    expect(back.displayLeftTeam.score).toBe(1);
  });
});

describe("name and logo edge cases", () => {
  const ctx = context((theme) => {
    theme.components.homeTeamLogo.visible = true;
    theme.components.homeTeamLogo.teamLogoFallbackMode = "slotFallback";
    theme.components.homeTeamLogo.assetId = "slot-left";
  });
  const cases = buildRehearsalCases(ctx);

  it("shows accented and symbol names as sent", () => {
    const live = normalized(cases.find((item) => item.id === "names-accents")!.frames[0]);
    expect(live.displayLeftTeam.name).toBe("SÃO PAULO ÇA");
    expect(live.displayRightTeam.name).toBe("ÅRHUS ØRNE & CO.");
  });

  it("uses a team's alternate logo when it has no primary, borrowing an image when the registry has no such team", () => {
    const alternate = cases.find((item) => item.id === "logos-alternate")!;
    const live = normalized(alternate.frames[0]);
    expect(live.displayLeftTeamMatch.team?.logoAssetId).toBeNull();
    expect(live.displayLeftTeamMatch.team?.alternateLogoAssetId).toBeTruthy();
    expect(alternate.expectation).toMatch(/^Left: .*'s alternate logo from Teams/);
  });

  it("falls back, never a broken image, when the logo file is gone", () => {
    const missing = cases.find((item) => item.id === "logos-missing-file")!;
    expect(normalized(missing.frames[0]).displayLeftTeamMatch.team?.logoAssetId).toBe("rehearsal-missing-logo-file");
    expect(missing.expectation).toContain("Left: the slot's fallback image, as if the team had no logo");
  });

  it("follows the overlay's rule: a missing primary is not rescued by the alternate", () => {
    const team = { ...registry[1], logoAssetId: "gone", alternateLogoAssetId: "logo-saus" };
    expect(logoExpectation("left", team, ctx)).toBe("Left: the slot's fallback image");
  });
});

describe("expectations from theme settings", () => {
  const noLogo = registry.find((item) => item.id === "anarki")!;

  it.each([
    ["none", false, false, "Left: no logo (fallback is None)"],
    ["slotFallback", true, false, "Left: the slot's fallback image"],
    ["slotFallback", false, false, "Left: no logo, fallback is Slot fallback but no fallback image is set"],
    ["eventLogo", false, true, "Left: the event logo"],
    ["slotFallbackThenEventLogo", false, true, "Left: the event logo (no slot fallback image is set)"],
    ["slotFallbackThenEventLogo", true, true, "Left: the slot's fallback image"]
  ] as const)("logo fallback %s (slot image %s, event logo %s)", (mode, slotImage, eventLogo, expected) => {
    const ctx = context((theme) => {
      theme.components.homeTeamLogo.visible = true;
      theme.components.homeTeamLogo.teamLogoFallbackMode = mode;
      theme.components.homeTeamLogo.assetId = slotImage ? "slot-left" : null;
      theme.components.eventLogo.assetId = eventLogo ? "event-logo" : null;
    });
    expect(logoExpectation("left", noLogo, ctx)).toBe(expected);
  });

  it("names the team's own logo when it has one, and a hidden slot", () => {
    const ctx = context((theme) => (theme.components.homeTeamLogo.visible = true));
    expect(logoExpectation("left", registry[1], ctx)).toBe("Left: KUDA's logo from Teams");
    ctx.theme.components.homeTeamLogo.visible = false;
    expect(logoExpectation("left", registry[1], ctx)).toContain("hidden");
  });

  it("says when a card should not appear", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.teamEventOverlay.base.enabled = false;
    expect(cardExpectation("base", "left", theme)).toBe("No card: the base card is switched off.");
    theme.teamEventOverlay.general.enabled = false;
    expect(cardExpectation("concede", "left", theme)).toBe("No card: event cards are switched off in this theme.");
  });

  it("describes where and how a card shows", () => {
    const theme = structuredClone(builtinThemes[0]);
    Object.assign(theme.teamEventOverlay.general, { enabled: true, followTarget: "none", placementMode: "top-ribbon", position: "above", animationPreset: "slide-horizontal" });
    theme.teamEventOverlay.concede.enabled = true;
    theme.teamEventOverlay.concede.text = "Conceded";
    expect(cardExpectation("concede", "right", theme)).toBe("“Conceded” card over the RIGHT team, as a ribbon above the team, sliding sideways.");
  });

  it("says the timeout card is off when it is", () => {
    const cases = buildRehearsalCases(context((theme) => (theme.momentOverlays.timeout.enabled = false)));
    expect(cases.find((item) => item.id === "timeout")!.expectation).toBe("No timeout card: it is switched off in this theme.");
  });
});
