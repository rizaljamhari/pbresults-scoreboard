import type { RawLiveState } from "./normalize.js";
import { matchTeamName } from "./teamMatching.js";
import type { StoredAsset, TeamRecord, ThemeDefinition } from "./theme.js";

/**
 * Rehearsal test cases: each one is a short script of raw feed messages (what PBResults would send) plus the
 * result the on-air theme should show, written from the theme's own settings. Frames go through the real
 * normalizer and the real overlay, so a rehearsal tests exactly what vMix will show. Nothing here is saved.
 * See docs/rehearsal-mode-technical-plan.md.
 */

export type RehearsalFrame = {
  raw: RawLiveState;
  /** Teams pinned for this frame, as a manual pick would; never stored. Null leaves the name to normal matching. */
  left: TeamRecord | null;
  right: TeamRecord | null;
  /** How long this frame shows before the next one; the last frame of a case holds until the case changes. */
  holdMs: number;
  sourceStatus?: "ok" | "error";
  /** Count this clock down once a second while the frame shows. */
  countdown?: "game" | "break";
};

export type RehearsalCase = {
  id: string;
  group: string;
  title: string;
  /** What the operator should see on vMix. */
  expectation: string;
  /** The settings or data the expectation comes from, so a wrong result points at what to change. */
  source: string | null;
  frames: RehearsalFrame[];
};

export type RehearsalContext = {
  theme: ThemeDefinition;
  teams: TeamRecord[];
  assets: Pick<StoredAsset, "id">[];
};

const STRESS_NAME = "EDMONTON IMPACT CHAMPIONSHIP TEAM";
/** Characters a scoreboard font may not have: accents, ligature-like letters and symbols. */
const ACCENT_NAMES = ["SÃO PAULO ÇA", "ÅRHUS ØRNE & CO."];
/** An asset id that points at nothing, the way a team looks after its logo file was deleted. */
const MISSING_ASSET_ID = "rehearsal-missing-logo-file";
const UNKNOWN_NAMES = ["ZQX UNLISTED SQUAD", "VWK NOT IN REGISTRY"];
const CASE_HOLD_MS = 6_000;
const SAMPLE_TIME = new Date(0).toISOString();

export function displayName(team: TeamRecord) {
  return team.scoreboardDisplayName.trim() || team.canonicalName;
}

function feedName(team: TeamRecord) {
  return team.shortName.trim() || team.canonicalName;
}

function sampleTeam(id: string, name: string): TeamRecord {
  return {
    id: `rehearsal-${id}`,
    canonicalName: name,
    scoreboardDisplayName: name,
    shortName: name,
    aliases: [],
    liveMatchNames: [],
    logoAssetId: null,
    alternateLogoAssetId: null,
    notes: "Rehearsal sample, never saved",
    active: true,
    createdAt: SAMPLE_TIME,
    updatedAt: SAMPLE_TIME
  };
}

/** How many cases a full rehearsal plays; the catalog test keeps this honest. */
export const REHEARSAL_CASE_COUNT = 33;

export type PossibleName = { feedName: string; suggests: TeamRecord };

/**
 * A feed name the matcher gets close to but will not commit to ("uncertain"), built from a real team:
 * a suffix, a dropped letter, a changed letter. Checked against the real matcher, so it only counts if this
 * registry really treats it as a possible match for that team.
 */
export function makePossibleName(source: TeamRecord, teams: TeamRecord[]): PossibleName | null {
  const bases = [...new Set([displayName(source), source.canonicalName].map((name) => name.trim().toUpperCase()).filter((name) => name.length >= 3))];
  for (const base of bases) {
    const variants = [
      `${base} PB`,
      `${base} PAINTBALL`,
      base.slice(0, -1),
      `${base.slice(0, Math.floor(base.length / 2))}X${base.slice(Math.floor(base.length / 2) + 1)}`,
      `THE ${base}`
    ];
    for (const variant of variants) {
      const match = matchTeamName(variant, teams);
      if (match.status === "uncertain" && match.candidates[0]?.teamId === source.id) {
        return { feedName: variant, suggests: source };
      }
    }
  }
  return null;
}

export type RehearsalSamples = {
  typical: [TeamRecord, TeamRecord];
  shortest: [TeamRecord, TeamRecord];
  longest: [TeamRecord, TeamRecord];
  noLogo: TeamRecord;
  /** A team with only an alternate logo; a sample borrowing an existing image when none exists. */
  alternateOnly: TeamRecord | null;
  next: [TeamRecord, TeamRecord];
  unknown: [string, string];
  /** Near-miss feed names for two real teams; null when the registry gives nothing to work from. */
  possible: [PossibleName, PossibleName] | null;
};

/** Real teams from the registry where possible, so real names and logos get tested; samples fill any gap. */
export function pickRehearsalSamples(teams: TeamRecord[], assets: Pick<StoredAsset, "id">[]): RehearsalSamples {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const hasLogo = (team: TeamRecord) => [team.logoAssetId, team.alternateLogoAssetId].some((id) => id && assetIds.has(id));
  const active = teams.filter((team) => team.active && displayName(team).trim());
  const byLength = [...active].sort((left, right) => displayName(left).length - displayName(right).length || displayName(left).localeCompare(displayName(right)));
  const pair = (list: TeamRecord[], fallbackA: string, fallbackB: string): [TeamRecord, TeamRecord] => [
    list[0] ?? sampleTeam(fallbackA.toLowerCase().replace(/\W+/g, "-"), fallbackA),
    list[1] ?? sampleTeam(fallbackB.toLowerCase().replace(/\W+/g, "-"), fallbackB)
  ];

  const withLogos = byLength.filter(hasLogo);
  // Typical: the middle of the teams with logos, so the baseline looks like a normal match.
  const middle = Math.max(0, Math.floor(withLogos.length / 2) - 1);
  const typical = pair(withLogos.slice(middle, middle + 2).length === 2 ? withLogos.slice(middle, middle + 2) : withLogos, "Home Team", "Away Team");
  const shortest = pair(byLength.slice(0, 2), "SL", "RT");
  const longest = pair([...byLength].reverse().slice(0, 2), "Longest Name Sample", "Another Long Sample");
  const noLogo = active.find((team) => !hasLogo(team)) ?? sampleTeam("no-logo", "No Logo Sample");
  const borrowedLogo = active.map((team) => team.logoAssetId).find((id) => id && assetIds.has(id)) ?? null;
  const alternateOnly =
    active.find((team) => !team.logoAssetId && team.alternateLogoAssetId && assetIds.has(team.alternateLogoAssetId)) ??
    (borrowedLogo ? { ...sampleTeam("alternate-only", "Alternate Logo Sample"), alternateLogoAssetId: borrowedLogo } : null);
  const used = new Set(typical.map((team) => team.id));
  const next = pair(byLength.filter((team) => !used.has(team.id)).slice(middle, middle + 2), "Next Match A", "Next Match B");

  // Names the matcher cannot place, checked against this registry.
  const unknown = UNKNOWN_NAMES.map((name, index) => {
    let candidate = name;
    for (let attempt = 2; matchTeamName(candidate, teams).status === "matched" && attempt < 20; attempt += 1) {
      candidate = `${name} ${attempt}${index}`;
    }
    return candidate;
  }) as [string, string];

  // Near misses for two different teams, so both sides show a suggestion on Operations.
  const possibleNames: PossibleName[] = [];
  for (const team of [...typical, ...byLength]) {
    if (possibleNames.length === 2) break;
    if (team.id.startsWith("rehearsal-") || possibleNames.some((item) => item.suggests.id === team.id)) continue;
    const possible = makePossibleName(team, teams);
    if (possible) possibleNames.push(possible);
  }
  const possible = possibleNames.length === 2 ? (possibleNames as [PossibleName, PossibleName]) : null;

  return { typical, shortest, longest, noLogo, alternateOnly, next, unknown, possible };
}

type Side = "left" | "right";

function sideWord(side: Side) {
  return side === "left" ? "LEFT" : "RIGHT";
}

/** What a team logo slot should show for this team, following the slot's fallback setting. */
export function logoExpectation(side: Side, team: TeamRecord | null, ctx: RehearsalContext): string {
  const { theme } = ctx;
  const assetIds = new Set(ctx.assets.map((asset) => asset.id));
  const slot = side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
  const label = side === "left" ? "Left" : "Right";
  if (!slot.visible) return `${label}: no logo, the logo slot is hidden in this theme`;
  // Same rule as the overlay: the primary logo when the team has one, otherwise the alternate.
  const chosenId = team ? team.logoAssetId ?? team.alternateLogoAssetId : null;
  if (team && chosenId && assetIds.has(chosenId)) {
    return `${label}: ${displayName(team)}'s ${team.logoAssetId ? "" : "alternate "}logo from Teams`;
  }
  const slotImage = Boolean(slot.assetId && assetIds.has(slot.assetId));
  const eventLogo = Boolean(theme.components.eventLogo.assetId && assetIds.has(theme.components.eventLogo.assetId));
  switch (slot.teamLogoFallbackMode) {
    case "none":
      return `${label}: no logo (fallback is None)`;
    case "eventLogo":
      return eventLogo ? `${label}: the event logo` : `${label}: no logo, fallback is Event logo but the theme has no event logo`;
    case "slotFallbackThenEventLogo":
      return slotImage
        ? `${label}: the slot's fallback image`
        : eventLogo
          ? `${label}: the event logo (no slot fallback image is set)`
          : `${label}: no logo, neither a slot fallback image nor an event logo is set`;
    case "slotFallback":
    default:
      return slotImage ? `${label}: the slot's fallback image` : `${label}: no logo, fallback is Slot fallback but no fallback image is set`;
  }
}

function fallbackSource(ctx: RehearsalContext) {
  const names: Record<string, string> = {
    none: "None",
    eventLogo: "Event logo",
    slotFallback: "Slot fallback",
    slotFallbackThenEventLogo: "Slot fallback, then event logo"
  };
  const { homeTeamLogo, awayTeamLogo } = ctx.theme.components;
  return `Logo fallback: left ${names[homeTeamLogo.teamLogoFallbackMode]}, right ${names[awayTeamLogo.teamLogoFallbackMode]}`;
}

type CardKind = "concede" | "base" | "winner";
const CARD_NAMES: Record<CardKind, string> = { concede: "towel", base: "base", winner: "winner" };

/** What an event card should look like over a side, or why none should appear. */
export function cardExpectation(kind: CardKind, side: Side, theme: ThemeDefinition): string {
  const general = theme.teamEventOverlay.general;
  const card = theme.teamEventOverlay[kind];
  if (!general.enabled) return "No card: event cards are switched off in this theme.";
  if (!card.enabled) return `No card: the ${CARD_NAMES[kind]} card is switched off.`;
  const logo = side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
  const name = side === "left" ? theme.components.homeName : theme.components.awayName;
  const followed = general.followTarget === "logo" ? logo : general.followTarget === "name" ? name : null;
  const placement = followed?.visible
    ? `on the ${general.followTarget}`
    : general.placementMode === "full-panel"
      ? "covering the team panel"
      : general.placementMode === "top-ribbon"
        ? `as a ribbon ${general.position === "above" ? "above" : "over the top edge of"} the team`
        : `as a stamp ${general.position === "above" ? "above" : "over the top edge of"} the team`;
  const motion =
    general.animationPreset === "none" ? "without motion" : general.animationPreset === "slide-horizontal" ? "sliding sideways" : "sliding up and down";
  const text = card.text.trim() || (kind === "winner" ? "WINNER" : "");
  return `“${text}” card over the ${sideWord(side)} team, ${placement}, ${motion}.`;
}

function cardSource(kind: CardKind, theme: ThemeDefinition) {
  const general = theme.teamEventOverlay.general;
  const card = theme.teamEventOverlay[kind];
  return `Event cards ${general.enabled ? "on" : "off"} · ${CARD_NAMES[kind]} card ${card.enabled ? "on" : "off"} · Card sits: ${general.followTarget === "none" ? "Free" : `On ${general.followTarget}`}`;
}

/** What a too-long team name should look like, from each name piece's long-text setting. */
export function longNameExpectation(theme: ThemeDefinition): string {
  const describe = (fit: ThemeDefinition["components"]["homeName"]) =>
    fit.textFit === "shrink"
      ? `gets smaller to fit (down to ${Math.round(fit.textFitMinScale * 100)}% of its size), then ends in “…”`
      : fit.textFit === "ellipsis"
        ? "ends in “…”"
        : "is cut off at the edge of its box";
  const left = describe(theme.components.homeName);
  const right = describe(theme.components.awayName);
  const how = left === right ? `A name too long for its box ${left}` : `A left name too long for its box ${left}; a right one ${right}`;
  return `Names never overlap the score. ${how}.`;
}

function centreLineExpectation(theme: ThemeDefinition, period: "play" | "break"): string {
  const line = theme.centerSecondary;
  if (!theme.components.breakTime.visible) return "The centre line is hidden in this theme.";
  const mode = period === "play" ? line.gameMode : line.breakMode;
  const text = period === "play" ? line.gameText : line.breakText || "BREAK";
  if (mode === "hidden" || (mode === "staticText" && !text.trim())) return `The centre line shows nothing during ${period === "play" ? "play" : "breaks"}.`;
  if (mode === "staticText") return `The centre line shows “${text}”.`;
  return period === "play" ? "The centre line shows the break clock." : "The centre line shows the break clock counting down from 1:30.";
}

function changeAnimation(theme: ThemeDefinition) {
  const { animation, durationMs } = theme.centerSecondary.transition;
  const names: Record<string, string> = { none: "", fade: "a fade", "slide-up": "a slide up", "slide-left": "a slide left", "slide-right": "a slide right" };
  return animation === "none" ? "straight away (no change animation)" : `with ${names[animation]} over ${durationMs} ms`;
}

function momentPlacement(theme: ThemeDefinition, kind: "timeout" | "gameFinished") {
  const card = theme.momentOverlays[kind];
  if (card.placement === "free") return `at x ${card.x}, y ${card.y}`;
  return theme.components.breakTime.visible ? "on the centre line" : "nowhere: it follows the centre line, which is hidden";
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function rawGame(
  left: string,
  right: string,
  scores: [number, number],
  overrides: Partial<RawLiveState> & { gameClock?: number; breakClock?: number } = {}
): RawLiveState {
  const { gameClock = 300, breakClock = 0, ...rest } = overrides;
  const period = rest.period ?? "GAME";
  return {
    state: "RUNNING",
    round: 1,
    sidesSwitched: 0,
    secondGame: false,
    mainGame: [
      { name: left, score: scores[0], playersAlive: 5 },
      { name: right, score: scores[1], playersAlive: 5 }
    ],
    gameTimer: { value: gameClock, state: period === "GAME" ? 2 : 0 },
    breakTimer: { value: breakClock, state: period === "BREAK" ? 2 : 0 },
    ...rest,
    period
  };
}

function frame(raw: RawLiveState, left: TeamRecord | null, right: TeamRecord | null, extra: Partial<RehearsalFrame> = {}): RehearsalFrame {
  return { raw, left, right, holdMs: CASE_HOLD_MS, ...extra };
}

/** The full rehearsal for the on-air theme, in running order. */
export function buildRehearsalCases(ctx: RehearsalContext): RehearsalCase[] {
  const { theme } = ctx;
  const samples = pickRehearsalSamples(ctx.teams, ctx.assets);
  const [home, away] = samples.typical;
  const pinned = (left: TeamRecord, right: TeamRecord, scores: [number, number], overrides?: Parameters<typeof rawGame>[3], extra?: Partial<RehearsalFrame>) =>
    frame(rawGame(feedName(left), feedName(right), scores, overrides), left, right, extra);
  const typical = (scores: [number, number], overrides?: Parameters<typeof rawGame>[3], extra?: Partial<RehearsalFrame>) => pinned(home, away, scores, overrides, extra);
  const timeout = theme.momentOverlays.timeout;
  const finished = theme.momentOverlays.gameFinished;
  const winnerOn = theme.teamEventOverlay.general.enabled && theme.teamEventOverlay.winner.enabled;
  const jumpTo = 30 + Math.max(90, timeout.minIncreaseSeconds + 15);
  const stress = sampleTeam("stress", STRESS_NAME);
  const stressAway = sampleTeam("stress-away", STRESS_NAME);
  const nameLengths = (teams: TeamRecord[]) => teams.map((team) => `${displayName(team)} (${displayName(team).length})`).join(", ");

  const finishedExpectation = (winner: Side | null) => {
    const card = finished.enabled ? `“${finished.text}” ${momentPlacement(theme, "gameFinished")}` : "No game finished card (switched off)";
    const winnerPart = winner
      ? winnerOn
        ? `, plus ${cardExpectation("winner", winner, theme).replace(/\.$/, "")}`
        : ", and no winner card (switched off)"
      : ", and NO winner card: a tie has no winner";
    return `${card}${winnerPart}.`;
  };

  const cases: Array<Omit<RehearsalCase, "id"> & { key: string }> = [
    {
      key: "normal",
      group: "Baseline",
      title: "Normal game",
      expectation: `Names, scores, logos and the game clock as designed. ${centreLineExpectation(theme, "play")}`,
      source: `${displayName(home)} vs ${displayName(away)} from Teams`,
      frames: [typical([2, 1], {}, { countdown: "game" })]
    },
    {
      key: "names-short",
      group: "Names",
      title: "Short names",
      expectation: "Names fit and stay aligned with the score.",
      source: `Shortest scoreboard names in Teams: ${nameLengths(samples.shortest)}`,
      frames: [pinned(samples.shortest[0], samples.shortest[1], [2, 1])]
    },
    {
      key: "names-long",
      group: "Names",
      title: "Long names",
      expectation: longNameExpectation(theme),
      source: `Longest scoreboard names in Teams: ${nameLengths(samples.longest)}`,
      frames: [pinned(samples.longest[0], samples.longest[1], [2, 1])]
    },
    {
      key: "names-stress",
      group: "Names",
      title: "Stress name",
      expectation: "Same as long names. This is a worst case.",
      source: `Sample name, ${STRESS_NAME.length} characters, never saved`,
      frames: [pinned(stress, stressAway, [2, 1])]
    },
    {
      key: "names-unknown",
      group: "Names",
      title: "Unknown team",
      expectation: `Names show exactly as the feed sends them. ${logoExpectation("left", null, ctx)}. ${logoExpectation("right", null, ctx)}.`,
      source: `Feed names that match no team: ${samples.unknown.join(", ")}`,
      frames: [frame(rawGame(samples.unknown[0], samples.unknown[1], [0, 0]), null, null)]
    },
    {
      key: "names-possible",
      group: "Names",
      title: "Possible team",
      expectation: samples.possible
        ? `Names show exactly as the feed sends them (${samples.possible.map((item) => item.feedName).join(", ")}), not the suggested teams: nothing is picked until someone confirms. ${logoExpectation("left", null, ctx)}. ${logoExpectation("right", null, ctx)}. On Operations, Team names on air suggests ${samples.possible.map((item) => displayName(item.suggests)).join(" and ")}.`
        : "Your Teams list has nothing to build a near-miss name from, so this plays like an unknown team.",
      source: samples.possible
        ? `Near-miss feed names the matcher is unsure about: ${samples.possible.map((item) => `${item.feedName} → ${displayName(item.suggests)}?`).join(", ")}`
        : "No team gave a near-miss name",
      frames: [
        frame(
          rawGame(samples.possible?.[0].feedName ?? samples.unknown[0], samples.possible?.[1].feedName ?? samples.unknown[1], [0, 0]),
          null,
          null
        )
      ]
    },
    {
      key: "names-accents",
      group: "Names",
      title: "Accents and symbols",
      expectation: "Every character shows in the theme's font: no empty boxes, and no letters that look like a different font.",
      source: `Sample names: ${ACCENT_NAMES.join(", ")} · name font: ${theme.components.homeName.fontFamily}`,
      frames: [pinned(sampleTeam("accent-left", ACCENT_NAMES[0]), sampleTeam("accent-right", ACCENT_NAMES[1]), [2, 1])]
    },
    {
      key: "logos-both",
      group: "Logos",
      title: "Both teams have logos",
      expectation: `${logoExpectation("left", home, ctx)}. ${logoExpectation("right", away, ctx)}.`,
      source: `${displayName(home)} and ${displayName(away)} from Teams`,
      frames: [typical([1, 1])]
    },
    {
      key: "logos-none",
      group: "Logos",
      title: "Team without logo",
      expectation: `${logoExpectation("left", samples.noLogo, ctx)}. ${logoExpectation("right", samples.noLogo, ctx)}.`,
      source: `${fallbackSource(ctx)} · ${displayName(samples.noLogo)} has no logo`,
      frames: [pinned(samples.noLogo, { ...samples.noLogo, id: `${samples.noLogo.id}-away` }, [1, 1])]
    },
    {
      key: "logos-mixed",
      group: "Logos",
      title: "Mixed",
      expectation: `${logoExpectation("left", home, ctx)}. ${logoExpectation("right", samples.noLogo, ctx)}.`,
      source: fallbackSource(ctx),
      frames: [pinned(home, samples.noLogo, [1, 1])]
    },
    {
      key: "logos-alternate",
      group: "Logos",
      title: "Alternate logo only",
      expectation: samples.alternateOnly
        ? `${logoExpectation("left", samples.alternateOnly, ctx)}. ${logoExpectation("right", away, ctx)}.`
        : "Your Teams list has no logo image to borrow, so this plays like a team without a logo.",
      source: samples.alternateOnly
        ? `${displayName(samples.alternateOnly)} has an alternate logo but no primary${samples.alternateOnly.id.startsWith("rehearsal-") ? " (sample, never saved)" : ""}`
        : null,
      frames: [pinned(samples.alternateOnly ?? samples.noLogo, away, [1, 1])]
    },
    {
      key: "logos-missing-file",
      group: "Logos",
      title: "Logo file missing",
      expectation: `Never a broken-image icon. ${logoExpectation("left", { ...home, logoAssetId: MISSING_ASSET_ID, alternateLogoAssetId: null }, ctx)}, as if the team had no logo. ${logoExpectation("right", away, ctx)}.`,
      source: `${displayName(home)} pointing at a logo file that no longer exists (sample, never saved)`,
      frames: [pinned({ ...home, id: `${home.id}-missing-logo`, logoAssetId: MISSING_ASSET_ID, alternateLogoAssetId: null }, away, [1, 1])]
    },
    {
      key: "scores-start",
      group: "Scores & clocks",
      title: "Start",
      expectation: "0–0 with the game clock at 10:00.",
      source: null,
      frames: [typical([0, 0], { gameClock: 600, state: "STOPPED" })]
    },
    {
      key: "scores-double",
      group: "Scores & clocks",
      title: "Double digits",
      expectation: "Two-digit scores (12–10) fit their boxes.",
      source: null,
      frames: [typical([12, 10], { gameClock: 151 })]
    },
    {
      key: "clock-zero",
      group: "Scores & clocks",
      title: "Clock at zero",
      expectation: "The game clock reads 00:00.",
      source: null,
      frames: [typical([3, 2], { gameClock: 0, state: "STOPPED" })]
    },
    {
      key: "break",
      group: "Centre line",
      title: "Break",
      expectation: centreLineExpectation(theme, "break"),
      source: `Centre line · during breaks: ${theme.centerSecondary.breakMode === "timer" ? "Break clock" : theme.centerSecondary.breakMode === "staticText" ? "Text" : "Hidden"}`,
      frames: [typical([3, 2], { period: "BREAK", state: "STOPPED", gameClock: 0, breakClock: 90 }, { countdown: "break" })]
    },
    {
      key: "towel-left",
      group: "Events",
      title: "Towel, left",
      expectation: cardExpectation("concede", "left", theme),
      source: cardSource("concede", theme),
      frames: [typical([3, 2], { state: "TOWEL1", gameClock: 190 })]
    },
    {
      key: "towel-right",
      group: "Events",
      title: "Towel, right",
      expectation: cardExpectation("concede", "right", theme),
      source: cardSource("concede", theme),
      frames: [typical([3, 2], { state: "TOWEL2", gameClock: 190 })]
    },
    {
      key: "base-left",
      group: "Events",
      title: "Base, left",
      expectation: cardExpectation("base", "left", theme),
      source: cardSource("base", theme),
      frames: [typical([3, 2], { state: "BASE2", gameClock: 190 })]
    },
    {
      key: "base-right",
      group: "Events",
      title: "Base, right",
      expectation: cardExpectation("base", "right", theme),
      source: cardSource("base", theme),
      frames: [typical([3, 2], { state: "BASE1", gameClock: 190 })]
    },
    {
      key: "sides-switched",
      group: "Events",
      title: "Sides switched",
      expectation: `The teams swap sides (${displayName(away)} on the left). A towel for ${displayName(home)}, the home team: ${cardExpectation("concede", "right", theme)}`,
      source: "Feed: towel for home (TOWEL1) with sides switched",
      // After the switch the feed lists the teams in their new screen order, so the home team is on the right.
      frames: [pinned(away, home, [2, 3], { state: "TOWEL1", sidesSwitched: 1, gameClock: 190 })]
    },
    {
      key: "timeout",
      group: "Moments",
      title: "Timeout",
      expectation: timeout.enabled
        ? `“${timeout.text}” flashes ${momentPlacement(theme, "timeout")} for ${timeout.durationMs} ms when the break clock jumps from 0:30 to ${clock(jumpTo)}${timeout.hideCentreLineContent ? ", with the clock cleared while it shows" : ""}.`
        : "No timeout card: it is switched off in this theme.",
      source: `Timeout card ${timeout.enabled ? "on" : "off"} · shows for ${timeout.durationMs} ms · when time jumps by ${timeout.minIncreaseSeconds} s or more`,
      frames: [
        typical([3, 2], { period: "BREAK", state: "STOPPED", gameClock: 0, breakClock: 30 }, { holdMs: 2_000 }),
        typical([3, 2], { period: "BREAK", state: "STOPPED", gameClock: 0, breakClock: jumpTo }, { countdown: "break" })
      ]
    },
    {
      key: "finished-left",
      group: "Moments",
      title: "Game finished, left wins",
      expectation: finishedExpectation("left"),
      source: `Game finished card ${finished.enabled ? "on" : "off"} · winner card ${winnerOn ? "on" : "off"}`,
      frames: [typical([3, 1], { state: "END", period: "BREAK", gameClock: 0 })]
    },
    {
      key: "finished-right",
      group: "Moments",
      title: "Game finished, right wins",
      expectation: finishedExpectation("right"),
      source: `Game finished card ${finished.enabled ? "on" : "off"} · winner card ${winnerOn ? "on" : "off"}`,
      frames: [typical([1, 3], { state: "END", period: "BREAK", gameClock: 0, round: 2 })]
    },
    {
      key: "finished-tie",
      group: "Moments",
      title: "Game finished, tie",
      expectation: finishedExpectation(null),
      source: "A tie has no winner",
      frames: [typical([2, 2], { state: "END", period: "BREAK", gameClock: 0, round: 3 })]
    },
    {
      key: "game-break-game",
      group: "Transitions",
      title: "Game → break → game",
      expectation: `The centre line changes ${changeAnimation(theme)} each time: ${centreLineExpectation(theme, "play").replace(/\.$/, "")} in play, then ${centreLineExpectation(theme, "break").charAt(0).toLowerCase()}${centreLineExpectation(theme, "break").slice(1).replace(/\.$/, "")}, then back.`,
      source: `Centre line · change animation: ${theme.centerSecondary.transition.animation}, ${theme.centerSecondary.transition.durationMs} ms`,
      frames: [
        typical([3, 2], { gameClock: 12 }, { holdMs: 3_000, countdown: "game" }),
        typical([3, 2], { period: "BREAK", state: "STOPPED", gameClock: 0, breakClock: 90 }, { holdMs: 4_000, countdown: "break" }),
        typical([3, 2], { gameClock: 600, round: 2 }, { countdown: "game" })
      ]
    },
    {
      key: "towel-clears",
      group: "Transitions",
      title: "Towel clears",
      expectation: `${cardExpectation("concede", "left", theme).replace(/\.$/, "")}, then after 3 s it goes away and the scoreboard is back to normal.`,
      source: cardSource("concede", theme),
      frames: [typical([3, 2], { state: "TOWEL1", gameClock: 190 }, { holdMs: 3_000 }), typical([3, 2], { gameClock: 187 }, { countdown: "game" })]
    },
    {
      key: "finished-next",
      group: "Transitions",
      title: "Finished → next match",
      expectation: `${finishedExpectation("left").replace(/\.$/, "")}. After 4 s the next match starts: the game finished and winner cards clear, and ${displayName(samples.next[0])} vs ${displayName(samples.next[1])} come in${theme.teamEventOverlay.general.teamSwitchEnabled ? " with the team-switch animation" : ""}.`,
      source: "Feed: END then a new match",
      frames: [
        typical([3, 1], { state: "END", period: "BREAK", gameClock: 0, round: 6 }, { holdMs: 4_000 }),
        pinned(samples.next[0], samples.next[1], [0, 0], { state: "STOPPED", gameClock: 600, round: 7 })
      ]
    },
    {
      key: "towel-then-base",
      group: "Clashes",
      title: "Towel, then base",
      expectation: `${cardExpectation("concede", "left", theme).replace(/\.$/, "")}. After 3 s it is replaced by: ${cardExpectation("base", "right", theme)}`,
      source: `${cardSource("concede", theme)} · base card ${theme.teamEventOverlay.base.enabled ? "on" : "off"}`,
      frames: [typical([3, 2], { state: "TOWEL1", gameClock: 190 }, { holdMs: 3_000 }), typical([3, 2], { state: "BASE1", gameClock: 188 })]
    },
    {
      key: "timeout-while-finished",
      group: "Clashes",
      title: "Timeout jump after the game ended",
      expectation: `${finishedExpectation("left").replace(/\.$/, "")}. The break clock jumps, but NO timeout flashes: a finished game takes priority.`,
      source: "Feed: END with the break clock jumping from 0:30",
      frames: [
        typical([3, 1], { state: "END", period: "BREAK", gameClock: 0, breakClock: 30, round: 8 }, { holdMs: 2_000 }),
        typical([3, 1], { state: "END", period: "BREAK", gameClock: 0, breakClock: jumpTo, round: 8 })
      ]
    },
    {
      key: "team-switch",
      group: "Transitions",
      title: "Team switch",
      expectation: theme.teamEventOverlay.general.teamSwitchEnabled
        ? `The next match's teams (${displayName(samples.next[0])}, ${displayName(samples.next[1])}) come in with the team-switch animation.`
        : "The next match's teams replace the old ones straight away (team-switch animation is off).",
      source: `Animate team switches: ${theme.teamEventOverlay.general.teamSwitchEnabled ? "on" : "off"}`,
      frames: [
        typical([0, 0], { state: "STOPPED", gameClock: 600, round: 4 }, { holdMs: 2_500 }),
        pinned(samples.next[0], samples.next[1], [0, 0], { state: "STOPPED", gameClock: 600, round: 5 })
      ]
    },
    {
      key: "feed-lost",
      group: "Resilience",
      title: "Feed lost",
      expectation: "The overlay keeps showing the last scoreboard and never goes blank. Operations shows the feed as unreachable.",
      source: "Feed status set to error, data unchanged",
      frames: [pinned(samples.next[0], samples.next[1], [0, 0], { state: "STOPPED", gameClock: 600, round: 5 }, { sourceStatus: "error" })]
    },
    {
      key: "feed-back",
      group: "Resilience",
      title: "Feed back with new data",
      expectation: "The overlay holds the last scoreboard while the feed is down, then shows the new score (1–0) and clock as soon as it is back.",
      source: "Feed status error for 3 s, then ok with new data",
      frames: [
        pinned(samples.next[0], samples.next[1], [0, 0], { state: "STOPPED", gameClock: 600, round: 5 }, { sourceStatus: "error", holdMs: 3_000 }),
        pinned(samples.next[0], samples.next[1], [1, 0], { gameClock: 540, round: 5 }, { countdown: "game" })
      ]
    }
  ];

  return cases.map(({ key, ...rest }) => ({ id: key, ...rest }));
}
