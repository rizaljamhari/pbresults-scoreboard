import type { ThemeComponentEntry } from "../../../shared/themeComponents";

// Names people see for the fixed scoreboard pieces; custom pieces use their own label.
const FULL_NAMES: Record<string, string> = {
  homeName: "Left team name",
  homeTeamLogo: "Left team logo",
  homeScore: "Left score",
  awayName: "Right team name",
  awayTeamLogo: "Right team logo",
  awayScore: "Right score",
  gameTime: "Game clock",
  breakTime: "Centre line",
  eventLogo: "Event logo"
};

// Shorter names inside a Layers group that already says which side.
const SHORT_NAMES: Record<string, string> = {
  homeName: "Name",
  homeTeamLogo: "Logo",
  homeScore: "Score",
  awayName: "Name",
  awayTeamLogo: "Logo",
  awayScore: "Score",
  gameTime: "Game clock",
  breakTime: "Centre line",
  eventLogo: "Event logo"
};

export function pieceName(entry: ThemeComponentEntry) {
  return entry.source === "fixed" ? FULL_NAMES[entry.id] ?? entry.label : entry.label;
}

export function pieceShortName(entry: ThemeComponentEntry) {
  return entry.source === "fixed" ? SHORT_NAMES[entry.id] ?? entry.label : entry.label;
}
