import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as Popover from "@radix-ui/react-popover";
import { ArrowLeftRight, ChevronDown, CircleAlert, Flag, ListOrdered, Minus, Pause, Play, Plus, RotateCcw, SkipForward, SlidersHorizontal, Timer, Undo2 } from "lucide-react";
import { formatClock } from "../../shared/normalize";
import type { ManualClock, ManualMatchAction, ManualMatchView, ManualSide } from "../../shared/manualMatch";
import type { AppSettings, NormalizedLiveState, TeamRecord } from "../../shared/theme";
import { ApiError, api } from "../api";
import { confirmAction, modalPromptOpen } from "../confirm";
import { useManualMatch, useMatchLists, useNow } from "../hooks";
import { showToast } from "../toast";
import { Button, Chip, Dot, Segmented, Switch } from "../components/admin/kit";
import { isTypingTarget, manualActionConfirmation, manualShortcutAction, parseClockInput } from "./manualShortcuts";
import { TeamPicker } from "../components/TeamPicker";
import {
  gameTitle,
  listDivisions,
  planNextMatch,
  sideStatus,
  seriesDecided,
  seriesScoreOf,
  tiebreakLabel,
  type MatchList,
  type NextMatchPlan,
  type ScheduledGame,
  type ScheduledSide,
  type SeriesScore
} from "../../shared/matchList";
import { controlAllowed, controlForAction, guidedBlockMessage, manualMoment, type ManualControl, type ManualControlMode } from "./manualGuide";

/** Team name slots in themes are sized for the 8 characters the PBResults tablet sends. */
const NAME_FIT = 8;

/** One-click clock lengths. Game presets set the clock; break presets start a break of that length. */
const GAME_CLOCK_PRESETS = [180, 300, 480, 600];
const BREAK_CLOCK_PRESETS = [10, 15, 30];

function presetLabel(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${seconds / 60} min`;
}

function ClockPresets({
  label,
  presets,
  disabled,
  describe,
  onPick
}: {
  label: string;
  presets: number[];
  disabled: boolean;
  describe: (seconds: number) => string;
  onPick: (seconds: number) => void;
}) {
  return (
    <div className="pba-manual-row pba-manual-presets" role="group" aria-label={label}>
      {presets.map((seconds) => (
        <Button key={seconds} size="sm" variant="ghost" disabled={disabled} title={describe(seconds)} onClick={() => onPick(seconds)}>
          {presetLabel(seconds)}
        </Button>
      ))}
    </div>
  );
}

/** What the match is doing right now, in the operator's words. "Game" alone would hide whether play is running. */
function phaseStatus(phase: ManualMatchView["phase"], gameRunning: boolean): { label: string; playing: boolean } {
  if (phase === "finished") return { label: "Finished", playing: false };
  if (phase === "break") return { label: "Break", playing: false };
  if (gameRunning) return { label: "Playing", playing: true };
  return { label: phase === "idle" ? "Ready" : "Stopped", playing: false };
}

function shortDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function remainingSeconds(clock: ManualClock, now: number) {
  const elapsed = clock.runningSince ? Math.max(0, now - Date.parse(clock.runningSince)) : 0;
  return Math.ceil(Math.max(0, clock.remainingMs - elapsed) / 1000);
}

function clockRunning(clock: ManualClock, now: number) {
  return Boolean(clock.runningSince) && remainingSeconds(clock, now) > 0;
}

/** A scheduled side in words: its team, its typed name, or what the schedule printed. */
function scheduledSideName(side: ScheduledSide, teams: TeamRecord[]) {
  if (side.teamId) return teams.find((team) => team.id === side.teamId)?.canonicalName ?? side.label;
  return side.name || side.label || "?";
}

function gameTeams(game: ScheduledGame, teams: TeamRecord[]) {
  return `${scheduledSideName(game.home, teams)} vs ${scheduledSideName(game.away, teams)}`;
}

/** A best-of game's series so far, for the game list: "set 2 · 1–0", "done 1–0", or nothing before it starts. */
function seriesNote(game: ScheduledGame, series: Record<string, SeriesScore>) {
  const score = series[game.id];
  if (game.bestOf <= 1 || !score?.played) return "";
  const board = `${score.home}–${score.away}`;
  if (score.tiebreak) return `${tiebreakLabel(score.tiebreak).toLowerCase()} ${board}`;
  return seriesDecided(score, game.bestOf) ? `done ${board}` : `set ${score.played + 1} · ${board}`;
}

/** Sides Next match cannot fill properly: a seeding reference ("Rank 1") or a name not linked to the team list. */
function gameGaps(game: ScheduledGame, teams: TeamRecord[]) {
  const known = new Set(teams.map((team) => team.id));
  const statuses = [sideStatus(game.home, known), sideStatus(game.away, known)];
  return { placeholder: statuses.includes("placeholder"), unlinked: statuses.includes("unlinked") };
}

/** The board's scores as home and away, which side each team stands on aside. */
function homeAwayScores(view: ManualMatchView): [number, number] {
  return view.sidesSwitched ? [view.right.score, view.left.score] : [view.left.score, view.right.score];
}

/** "Game 23" reads "game 23" mid-sentence; a division name ("Rookie 23") keeps its capital. */
function inSentence(title: string) {
  return title.replace(/^Game /, "game ");
}

/** What Next match will do, for its question and the schedule strip. */
function describePlan(
  plan: NextMatchPlan,
  teams: TeamRecord[],
  settings: Pick<AppSettings, "manualOvertimeClockSeconds" | "manualOneOnOneClockSeconds">,
  divided: boolean,
  /** Whether the teams on the board now have switched ends, to say if the next set changes that. */
  sidesSwitchedNow: boolean
) {
  // Scores are given home first, as the teams are ("KOVRA UD vs 3Q"), whichever side each stands on.
  const sides = (switched: boolean) => (switched === sidesSwitchedNow ? "same sides" : "teams switch sides");
  if (plan.kind === "tiebreak") {
    const label = tiebreakLabel(plan.tiebreak);
    const seconds = plan.tiebreak === "overtime" ? settings.manualOvertimeClockSeconds : settings.manualOneOnOneClockSeconds;
    const level = `${plan.from.home}–${plan.from.away}`;
    const switching = seriesScoreOf(plan.schedule, plan.game.id).switched !== sidesSwitchedNow;
    return {
      // Worked out from the score now, so it reads as what happens if the game ends like this.
      short: `if it ends ${level}, ${label.toLowerCase()} (next point wins)`,
      message: `${plan.tiebreak === "overtime" ? "The series is level." : "Overtime ended level."} ${label} with the same teams${switching ? ", who switch sides" : ""}: the score stays at ${level} and the next point wins the series. The clock is set to ${formatClock(seconds)}.`
    };
  }
  if (plan.kind === "series") {
    const { home, away, switched } = seriesScoreOf(plan.schedule, plan.game.id);
    const set = `set ${plan.schedule.seriesGame} of ${plan.game.bestOf}`;
    return {
      short: `${set[0].toUpperCase()}${set.slice(1)}, ${sides(switched)}, score stays ${home}–${away}`,
      message: `Starts ${set} with the same teams${switched === sidesSwitchedNow ? ", on the same sides" : ", who switch sides (a point was scored)"}. The score stays at ${home}–${away}; the game clock resets.`
    };
  }
  if (plan.kind === "game") {
    const { seriesGame } = plan.schedule;
    const { home, away, switched } = seriesScoreOf(plan.schedule, plan.game.id);
    const ends = switched ? ", home team on the right" : "";
    const seriesText =
      plan.game.bestOf <= 1
        ? ""
        : plan.schedule.tiebreak
          ? ` (${tiebreakLabel(plan.schedule.tiebreak).toLowerCase()}, score stays ${home}–${away}, next point wins${ends})`
          : ` (set ${seriesGame} of ${plan.game.bestOf}${seriesGame > 1 ? `, score ${home}–${away}${ends}` : ""})`;
    const teamsText = gameTeams(plan.game, teams);
    const gaps = gameGaps(plan.game, teams);
    const warning = gaps.placeholder
      ? ` ${gameTitle(plan.game, divided)} teams aren't set yet; fill them on the Matches page.`
      : gaps.unlinked
        ? " A team isn't linked to the team list, so it shows without a logo."
        : "";
    return {
      short: `${gameTitle(plan.game, divided)}${seriesText}: ${teamsText}`,
      message: `Loads ${inSentence(gameTitle(plan.game, divided))}${seriesText}: ${teamsText}.${warning}`
    };
  }
  return { short: "End of the list", message: "That was the last game in the list. Scores go back to 0, the round moves on and the teams stay." };
}

/** Where manual scoring is in the match list it follows, what Next match does, and a way to jump to any game. */
function ScheduleStrip({
  list,
  view,
  teams,
  settings,
  disabled,
  onLoad
}: {
  list: MatchList;
  view: ManualMatchView;
  teams: TeamRecord[];
  settings: AppSettings;
  disabled: boolean;
  onLoad: (game: ScheduledGame) => void;
}) {
  const [open, setOpen] = useState(false);
  const schedule = view.schedule?.listId === list.id ? view.schedule : null;
  const divided = listDivisions(list).length > 1;
  const current = schedule ? list.games.find((game) => game.id === schedule.gameKey) ?? null : null;
  const plan = planNextMatch(schedule, list, ...homeAwayScores(view));
  const next = describePlan(plan, teams, settings, divided, view.sidesSwitched);
  const nextGaps = plan.kind === "game" ? gameGaps(plan.game, teams) : null;
  const games = list.games.filter((game) => game.kind === "game");

  return (
    <div className="pba-manual-schedule" aria-label="Match list">
      <div className="pba-manual-schedule-line">
        <ListOrdered className="pba-faint" aria-hidden size={15} />
        <b className="pba-manual-schedule-name" title={list.name}>
          {list.name}
        </b>
        {current ? (
          <span>
            {gameTitle(current, divided)}
            {current.time ? ` · ${current.time}` : ""}
            {current.stage ? ` · ${current.stage}` : ""}
            {schedule && current.bestOf > 1
              ? schedule.tiebreak
                ? ` · ${tiebreakLabel(schedule.tiebreak)}`
                : ` · set ${schedule.seriesGame} of ${current.bestOf}`
              : ""}
          </span>
        ) : (
          <span className="pba-muted">Not started: choose the first game</span>
        )}
      </div>
      <div className="pba-manual-schedule-line">
        <span className="pba-muted pba-manual-schedule-next">Next match: {next.short}</span>
        {nextGaps?.placeholder || nextGaps?.unlinked ? (
          <CircleAlert className="pba-ml-warn" aria-label={nextGaps.placeholder ? "Teams not set yet" : "A team is not linked"} />
        ) : null}
        <span className="pba-push" />
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <Button size="sm" variant="ghost" disabled={disabled || games.length === 0}>
              Choose game
              <ChevronDown aria-hidden />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="pba-scope pba-pop pba-game-pick"
              align="end"
              sideOffset={6}
              aria-label="Games"
              onOpenAutoFocus={(event) => {
                // Open at the game being played (or the first one), not always at the top of a 70-game list.
                const row = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-current="true"]');
                if (!row) return;
                event.preventDefault();
                row.focus();
                row.scrollIntoView({ block: "center" });
              }}
            >
              {games.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="pba-game-pick-row"
                  aria-current={game.id === current?.id ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onLoad(game);
                  }}
                >
                  <span className="pba-num" title={gameTitle(game, divided)}>
                    {divided && game.division ? `${game.division.trim().slice(0, 1).toUpperCase()}${game.gameId}` : game.gameId}
                  </span>
                  <span className="pba-faint">{game.time}</span>
                  <span title={gameTeams(game, teams)}>{gameTeams(game, teams)}</span>
                  <span className="pba-faint">{seriesNote(game, view.schedule?.listId === list.id ? view.schedule.series : {})}</span>
                </button>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Link className="pba-btn pba-btn--text pba-btn--sm" to="/admin/matches">
          Edit list
        </Link>
      </div>
    </div>
  );
}

function ManualTeamSide({
  side,
  view,
  live,
  teams,
  logoFor,
  disabled,
  slot,
  onAction
}: {
  side: ManualSide;
  view: ManualMatchView;
  live: NormalizedLiveState | null;
  teams: TeamRecord[];
  logoFor: (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => string | undefined;
  disabled: boolean;
  /** Class for a control's slot: hidden (space kept) when Guided does not offer it now. */
  slot: (control: ManualControl) => string | undefined;
  onAction: (action: ManualMatchAction) => void;
}) {
  const [open, setOpen] = useState(false);
  // A finished match has no point being played: towel and base cards would make no sense on air.
  const finished = view.phase === "finished";
  const entry = view[side];
  const team = entry.teamId ? teams.find((record) => record.id === entry.teamId) ?? null : null;
  const onAir = live?.source === "manual" ? (side === "left" ? live.displayLeftTeam : live.displayRightTeam) : null;
  const name = onAir?.name || team?.scoreboardDisplayName || team?.canonicalName || entry.name;
  const logo = logoFor(team);
  const keys = side === "left" ? ["Q", "A"] : ["P", "L"];
  const missingTeam = Boolean(entry.teamId) && !team;
  const teamLabel = name || (side === "left" ? "Left team" : "Right team");

  return (
    <div className="pba-team-side pba-manual-side">
      <div className="pba-side-label">
        {side === "left" ? "Left" : "Right"}
        {/* Which team is home, as the overlay's towel and base calls are made for home or away. */}
        <span className="pba-manual-home-tag">{(side === "left") !== view.sidesSwitched ? "Home" : "Away"}</span>
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <Button variant="text" size="sm" className="pba-push" disabled={disabled}>
              {entry.teamId || entry.name ? "Change team" : "Choose team"}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="pba-scope pba-pop pba-picker-pop" align="end" sideOffset={6}>
              <TeamPicker
                id={side}
                label={`Team for the ${side} side`}
                teams={teams}
                logoFor={logoFor}
                footer={(typed, hasResults) =>
                  typed.length > NAME_FIT && !hasResults ? <p className="pba-hint">Longer than {NAME_FIT} characters: it may not fit the theme's name slot.</p> : null
                }
                onChoose={(choice) => {
                  setOpen(false);
                  onAction("teamId" in choice ? { type: "setTeam", side, teamId: choice.teamId, name: "" } : { type: "setTeam", side, teamId: null, name: choice.name });
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div className="pba-team-id">
        <span className={`pba-team-logo${logo ? "" : " is-empty"}`}>{logo ? <img src={logo} alt="" /> : null}</span>
        <div className="pba-team-text">
          <div className={`pba-team-name${name ? "" : " is-missing"}`} title={name || undefined}>
            {name || "No team yet"}
          </div>
          <div className="pba-feed-name">
            {missingTeam
              ? "That team was removed from Teams"
              : team
                ? logo
                  ? team.canonicalName
                  : `${team.canonicalName} · no logo yet`
                : entry.name
                  ? "Typed name, no logo"
                  : "Choose a team to show its name and logo"}
          </div>
        </div>
      </div>
      <div className="pba-manual-score" role="group" aria-label={`${teamLabel} score`}>
        <Button className={slot("scoreDown")} aria-label={`${teamLabel} score down`} title={`Take a point back (${keys[1]})`} disabled={disabled || entry.score === 0} onClick={() => onAction({ type: "adjustScore", side, delta: -1 })}>
          <Minus aria-hidden />
          <kbd className="pba-kbd" aria-hidden>
            {keys[1]}
          </kbd>
        </Button>
        <output className="pba-manual-figure" aria-live="polite" aria-label={`${teamLabel} score`}>
          {entry.score}
        </output>
        <Button className={slot("scoreUp")} aria-label={`${teamLabel} score up`} title={`Point to ${teamLabel}; stops the game clock (${keys[0]})`} disabled={disabled} onClick={() => onAction({ type: "adjustScore", side, delta: 1 })}>
          <Plus aria-hidden />
          <kbd className="pba-kbd" aria-hidden>
            {keys[0]}
          </kbd>
        </Button>
        <Button className={`pba-push ${slot("towelBase") ?? ""}`} size="sm" disabled={disabled || finished} onClick={() => onAction({ type: "teamEvent", kind: "towel", side })} title="Shows the theme's towel card on this side">
          Towel
        </Button>
        <Button className={slot("towelBase")} size="sm" disabled={disabled || finished} onClick={() => onAction({ type: "teamEvent", kind: "base", side })} title="Shows the theme's base card on this side">
          Base
        </Button>
      </div>
    </div>
  );
}

const CONTROL_MODE_KEY = "pbresults.admin.manualControlMode";

/** Per computer: the onsite operator can stay Guided while remote staff use Full. */
function readControlMode(): ManualControlMode {
  try {
    return window.localStorage.getItem(CONTROL_MODE_KEY) === "full" ? "full" : "guided";
  } catch {
    return "guided";
  }
}

function saveControlMode(mode: ManualControlMode) {
  try {
    window.localStorage.setItem(CONTROL_MODE_KEY, mode);
  } catch {
    // Remembering it is a convenience only.
  }
}

const ADJUST_OPEN_KEY = "pbresults.admin.manualAdjustOpen";

function readAdjustOpen() {
  try {
    return window.localStorage.getItem(ADJUST_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveAdjustOpen(open: boolean) {
  try {
    window.localStorage.setItem(ADJUST_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Remembering it is a convenience only.
  }
}

/** Set a clock to a typed time, or Reset it to its length from Settings. */
function ClockSetter({
  label,
  resetTo,
  disabled,
  title,
  onSet,
  onReset
}: {
  label: string;
  resetTo: number;
  disabled: boolean;
  title?: string;
  onSet: (seconds: number) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="pba-manual-row"
      title={title}
      onSubmit={(event) => {
        event.preventDefault();
        const seconds = parseClockInput(draft);
        if (seconds === null) {
          showToast({ kind: "error", message: "Type the clock as minutes and seconds, like 7:30." });
          return;
        }
        setDraft("");
        onSet(seconds);
      }}
    >
      <input
        className="pba-input pba-manual-clock-input"
        aria-label={label}
        placeholder="m:ss"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={disabled || !draft.trim()}>
        Set
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onReset} title={`Back to ${formatClock(resetTo)}`}>
        <RotateCcw aria-hidden />
        Reset
      </Button>
    </form>
  );
}

/**
 * Manual scoring: the operator runs the match from here when the event has no PBResults feed. Every action goes to the
 * server, which puts it on air; the panel shows what the server holds.
 */
export function ManualMatchPanel({
  live,
  settings,
  teams,
  logoFor,
  rehearsing
}: {
  live: NormalizedLiveState | null;
  settings: AppSettings;
  teams: TeamRecord[];
  logoFor: (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => string | undefined;
  rehearsing: boolean;
}) {
  const manual = useManualMatch();
  const view = manual.data;
  const matchLists = useMatchLists();
  const activeList = matchLists.data?.lists.find((list) => list.id === matchLists.data?.activeListId) ?? null;
  const divided = activeList ? listDivisions(activeList).length > 1 : false;
  const now = useNow(250);
  const disabled = rehearsing || !view;
  // Actions go out one at a time, in the order pressed, so a quick double tap scores twice and never out of order.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const manualLive = live?.source === "manual" ? live : null;
  const [adjustOpen, setAdjustOpenState] = useState(readAdjustOpen);
  const setAdjustOpen = (open: boolean) => {
    setAdjustOpenState(open);
    saveAdjustOpen(open);
  };

  const gameSeconds = manualLive ? manualLive.gameTimer.value : view ? remainingSeconds(view.gameClock, now) : 0;
  const gameRunning = manualLive ? manualLive.gameTimer.state === 2 : view ? clockRunning(view.gameClock, now) : false;
  const breakSeconds = manualLive ? manualLive.breakTimer.value : view ? remainingSeconds(view.breakClock, now) : 0;
  const breakRunning = manualLive ? manualLive.breakTimer.state === 2 : view ? clockRunning(view.breakClock, now) : false;
  const inBreak = view?.phase === "break" || view?.phase === "finished";
  const breakResumable = inBreak && !breakRunning && breakSeconds > 0;
  const [mode, setModeState] = useState<ManualControlMode>(readControlMode);
  const setMode = (next: ManualControlMode) => {
    setModeState(next);
    saveControlMode(next);
  };
  const moment = view ? manualMoment(view.phase, gameRunning) : "ready";
  const can = (control: ManualControl) => controlAllowed(control, moment, mode);
  // Hidden with its space kept, so switching moments never moves a button under the pointer.
  const slot = (control: ManualControl) => (can(control) ? undefined : "pba-manual-off");
  const breakControl: ManualControl = breakRunning ? "pauseBreak" : breakResumable ? "resumeBreak" : "startBreak";

  function run(action: ManualMatchAction) {
    queueRef.current = queueRef.current.then(async () => {
      try {
        manual.setData?.(await api.manualAction(action));
      } catch (error) {
        showToast({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Couldn't reach the scoreboard server, so nothing changed on air. Check the app is still running."
        });
      }
    });
    return queueRef.current;
  }

  /** Runs an action, first asking when it would finish the match or reopen a finished one. */
  async function act(action: ManualMatchAction, options: { skipConfirm?: boolean } = {}) {
    const question = view && !options.skipConfirm ? manualActionConfirmation(action, view.phase, { gameClockRunning: gameRunning }) : null;
    if (question && !(await confirmAction(question))) return;
    void run(action);
  }

  // Keyboard shortcuts work anywhere on the page, except while typing or in a dialog.
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  shortcutRef.current = (event: KeyboardEvent) => {
    if (disabled || modalPromptOpen() || isTypingTarget(event.target)) return;
    const action = manualShortcutAction(event, { gameClockRunning: gameRunning, timeoutSeconds: settings.manualTimeoutSeconds });
    if (!action) return;
    event.preventDefault();
    const control = controlForAction(action, { breakResumable });
    if (control && !can(control)) {
      showToast({ kind: "info", message: guidedBlockMessage(moment), durationMs: 2500 });
      return;
    }
    // Space on a focused button would also press it when the key comes up.
    if (event.key === " " && event.target instanceof HTMLElement && event.target.tagName === "BUTTON") event.target.blur();
    void act(action, { skipConfirm: action.type === "finishMatch" && event.shiftKey });
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function nextMatch() {
    const plan = activeList && view ? planNextMatch(view.schedule, activeList, ...homeAwayScores(view)) : null;
    const ok = await confirmAction({
      title: "Start the next match?",
      message: plan && view
        ? `${describePlan(plan, teams, settings, divided, view.sidesSwitched).message}${plan.kind === "tiebreak" || plan.kind === "series" ? "" : " The game clock resets."}`
        : "Scores go back to 0, the round moves on and the game clock resets. The teams stay until you change them.",
      confirmLabel: "Next match"
    });
    if (ok) void run({ type: "nextMatch" });
  }

  async function loadGame(list: MatchList, game: ScheduledGame) {
    const ok = await confirmAction({
      title: `Load ${inSentence(gameTitle(game, divided))}?`,
      message: `${gameTeams(game, teams)}. Scores go back to 0 and the game clock resets.`,
      confirmLabel: `Load ${inSentence(gameTitle(game, divided))}`
    });
    if (ok) void run({ type: "loadScheduledGame", listId: list.id, gameKey: game.id });
  }

  // A mid-match call (points starting late), so it is switchable here as well as in Settings. Same shared setting.
  const [autoStartDraft, setAutoStartDraft] = useState<boolean | null>(null);
  const [savingAutoStart, setSavingAutoStart] = useState(false);
  const autoStart = autoStartDraft ?? settings.manualAutoStartGameClock;
  useEffect(() => setAutoStartDraft(null), [settings.manualAutoStartGameClock]);

  async function handleAutoStart(checked: boolean) {
    setAutoStartDraft(checked);
    setSavingAutoStart(true);
    try {
      // On top of the latest saved settings, so this never undoes a change made elsewhere.
      const latest = await api.getSettings();
      await api.updateSettings({ ...latest, manualAutoStartGameClock: checked });
    } catch (error) {
      setAutoStartDraft(null);
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Couldn't save that setting." });
    } finally {
      setSavingAutoStart(false);
    }
  }

  const phase = view ? phaseStatus(view.phase, gameRunning) : null;
  const timeoutLabel = shortDuration(settings.manualTimeoutSeconds);
  const gameNote =
    view?.phase === "finished" ? "Match finished" : gameRunning ? "Running" : gameSeconds === 0 ? "At 0:00: set or reset it in Adjust clocks" : "Stopped";
  const breakNote = !inBreak
    ? "No break running"
    : breakRunning
      ? view?.phase === "break" && autoStart
        ? gameSeconds > 0
          ? "Game clock starts at 0:00"
          : "Game clock is at 0:00, so it won't start"
        : "Running"
      : breakSeconds > 0
        ? "Paused"
        : "Break over";

  return (
    <section className="pba-surface" aria-labelledby="manual-scoring-title">
      <div className="pba-section-head pba-ops-head">
        <h2 id="manual-scoring-title" className="pba-title">
          Manual scoring
        </h2>
        {phase ? (
          <Chip>
            {phase.playing ? <Dot tone="live" flat /> : null}
            {phase.label}
          </Chip>
        ) : null}
        {/* Announces phase changes to screen readers; the chip above is the visible version. */}
        <span className="pba-sr" role="status">
          {phase ? `Match ${phase.label.toLowerCase()}` : ""}
        </span>
        {view ? <span className="pba-hint pba-manual-round">Round {view.round}</span> : null}
        {/* A tie-break changes what a point means (it wins the series), so it is called out beside the phase. */}
        {view?.schedule?.tiebreak ? <Chip tone="warning">{tiebreakLabel(view.schedule.tiebreak)}: next point wins</Chip> : null}
        <Segmented
          label="Panel controls"
          className="pba-push"
          value={mode}
          options={[
            { value: "guided", label: "Guided", title: "Show only what makes sense right now" },
            { value: "full", label: "Full", title: "Show every control" }
          ]}
          onChange={setMode}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !view?.undoLabel}
          onClick={() => void run({ type: "undo" })}
          title="Undo the last action (Ctrl+Z)"
        >
          <Undo2 aria-hidden />
          {view?.undoLabel ? `Undo: ${view.undoLabel}` : "Undo"}
        </Button>
      </div>
      {rehearsing ? (
        <p className="pba-callout pba-callout--info pba-rh-callout">Manual scoring is paused during the rehearsal. Stop the rehearsal to score.</p>
      ) : null}
      {!view ? (
        <p className="pba-hint pba-section">Loading the match…</p>
      ) : (
        <>
          {activeList ? (
            <ScheduleStrip list={activeList} view={view} teams={teams} settings={settings} disabled={disabled} onLoad={(game) => void loadGame(activeList, game)} />
          ) : null}
          <div className="pba-resolve">
            <ManualTeamSide side="left" view={view} live={live} teams={teams} logoFor={logoFor} disabled={disabled} slot={slot} onAction={(action) => void act(action)} />
            <ManualTeamSide side="right" view={view} live={live} teams={teams} logoFor={logoFor} disabled={disabled} slot={slot} onAction={(action) => void act(action)} />
          </div>
          <div className="pba-manual-clocks">
            <div className="pba-manual-clock">
              <div className="pba-manual-clock-head">
                <span className="pba-side-label">Game clock</span>
                <output className={`pba-manual-figure${gameRunning ? " is-running" : ""}`} aria-label="Game clock">
                  {formatClock(gameSeconds)}
                </output>
              </div>
              <p className="pba-manual-note">{gameNote}</p>
              {/* A fixed two-column grid: changing a button's label never moves anything below it. */}
              <div className="pba-manual-actions">
                <Button
                  className={slot(gameRunning ? "stopClock" : "startClock")}
                  disabled={disabled || (!gameRunning && gameSeconds === 0)}
                  onClick={() => void act({ type: gameRunning ? "stopGameClock" : "startGameClock" })}
                >
                  {gameRunning ? <Pause aria-hidden /> : <Play aria-hidden />}
                  {gameRunning ? "Stop" : "Start"}
                  <kbd className="pba-kbd" aria-hidden>
                    Space
                  </kbd>
                </Button>
              </div>

            </div>
            <div className="pba-manual-clock">
              <div className="pba-manual-clock-head">
                <span className="pba-side-label">Break</span>
                <output className={`pba-manual-figure${breakRunning ? " is-running" : ""}${inBreak ? "" : " is-idle"}`} aria-label="Break clock">
                  {inBreak ? formatClock(breakSeconds) : "—"}
                </output>
              </div>
              <p className="pba-manual-note">{breakNote}</p>
              <div className="pba-manual-actions">
                {breakRunning ? (
                  <Button className={slot(breakControl)} disabled={disabled} onClick={() => void run({ type: "stopBreak" })}>
                    <Pause aria-hidden />
                    Pause
                  </Button>
                ) : (
                  <Button className={slot(breakControl)} disabled={disabled} onClick={() => void run({ type: "startBreak" })} title={inBreak && breakSeconds > 0 ? "Resume the break" : `Start a ${formatClock(settings.manualBreakClockSeconds)} break`}>
                    <Play aria-hidden />
                    {inBreak && breakSeconds > 0 ? "Resume" : "Start break"}
                    <kbd className="pba-kbd" aria-hidden>
                    B
                  </kbd>
                  </Button>
                )}
                <Button className={slot("timeout")} disabled={disabled} onClick={() => void run({ type: "addBreakTime", seconds: settings.manualTimeoutSeconds })} title="Adds time to the break clock; the theme's timeout card shows">
                  <Timer aria-hidden />
                  Timeout +{timeoutLabel}
                  <kbd className="pba-kbd" aria-hidden>
                    T
                  </kbd>
                </Button>
              </div>

            </div>
          </div>
          <div className="pba-manual-match">
            <Button
              className={slot("finish")}
              disabled={disabled || view.phase === "finished"}
              onClick={(event) => void act({ type: "finishMatch" }, { skipConfirm: event.shiftKey })}
              title="Ends the match: the theme's game finished and winner cards show. Asks first; Shift skips the question."
            >
              <Flag aria-hidden />
              Finish match
              <kbd className="pba-kbd" aria-hidden>
                F
              </kbd>
            </Button>
            {/* Once the match is finished, Next match is the obvious next step. */}
            <Button className={slot("next")} variant={view.phase === "finished" ? "default" : "ghost"} disabled={disabled} onClick={() => void nextMatch()}>
              <SkipForward aria-hidden />
              Next match
            </Button>
            {/* Always offered: a correction when the teams changed ends and the board did not follow, or the reverse. */}
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => void act({ type: "switchSides" })}
              title={
                `The teams swap sides on the board with their scores (S). ${
                  view.schedule && view.schedule.bestOf > 1 ? "In a best-of this happens by itself after a set with a point. " : ""
                }Asks first while the game clock is running.`
              }
            >
              <ArrowLeftRight aria-hidden />
              Switch sides
              <kbd className="pba-kbd" aria-hidden>
                S
              </kbd>
            </Button>
            {/* The only keys not printed on a button. */}
            <span className="pba-hint pba-push pba-manual-hidden-keys">
              <kbd className="pba-kbd">Shift</kbd> <kbd className="pba-kbd">F</kbd> finish now · <kbd className="pba-kbd">Ctrl</kbd>{" "}
              <kbd className="pba-kbd">Z</kbd> undo
            </span>
          </div>
          {/* Corrections, not live controls: kept closed so the live controls fit on a laptop screen. */}
          <details className="pba-disclose pba-manual-adjust" open={adjustOpen} onToggle={(event) => setAdjustOpen(event.currentTarget.open)}>
            <summary>
              <SlidersHorizontal aria-hidden />
              <b>Adjust clocks</b>
              <span className="pba-muted">Set a time, reset, presets</span>
              <ChevronDown className="pba-disclose-chevron" aria-hidden />
            </summary>
            <div className="pba-manual-adjust-body">
              <div className="pba-manual-clock">
                <span className="pba-side-label">Game clock</span>
                  <ClockSetter
                    label="Set the game clock"
                    resetTo={settings.manualGameClockSeconds}
                    disabled={disabled}
                    onSet={(seconds) => void run({ type: "setGameClock", seconds })}
                    onReset={() => void run({ type: "resetGameClock" })}
                  />
                  <ClockPresets
                    label="Game clock presets"
                    presets={GAME_CLOCK_PRESETS}
                    disabled={disabled}
                    describe={(seconds) => `Set the game clock to ${formatClock(seconds)}`}
                    onPick={(seconds) => void run({ type: "setGameClock", seconds })}
                  />
              </div>
              <div className="pba-manual-clock">
                <span className="pba-side-label">
                  Break
                  {inBreak ? null : <span className="pba-hint pba-manual-label-hint">Set and Reset need a break</span>}
                </span>
                  <ClockSetter
                    label="Set the break clock"
                    resetTo={settings.manualBreakClockSeconds}
                    disabled={disabled || !inBreak}
                    // Raising the break clock reads to the overlay like a timeout.
                    title={inBreak ? "A higher time shows the theme's timeout card, like Timeout" : "Start a break to set its clock"}
                    onSet={(seconds) => void run({ type: "setBreakClock", seconds })}
                    onReset={() => void run({ type: "resetBreakClock" })}
                  />
                  <ClockPresets
                    label="Break presets"
                    presets={BREAK_CLOCK_PRESETS}
                    disabled={disabled}
                    describe={(seconds) => `Start a ${presetLabel(seconds)} break now`}
                    onPick={(seconds) => void run({ type: "startBreak", seconds })}
                  />
              </div>
            </div>
            {/* Event rules live in Settings; the panel shows them so Reset and Start break are never a guess. */}
            <div className="pba-manual-defaults">
              <p className="pba-hint">
                Defaults: game {formatClock(settings.manualGameClockSeconds)} · break {formatClock(settings.manualBreakClockSeconds)} · timeout +{timeoutLabel}
                {" · "}
                <Link to="/admin/settings#set-feed">Change in Settings</Link>
              </p>
              <label className="pba-manual-autostart">
                <Switch
                  label="Start the clock when a break ends"
                  checked={autoStart}
                  disabled={savingAutoStart}
                  onChange={(checked) => void handleAutoStart(checked)}
                />
                <span>Start the clock when a break ends</span>
              </label>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
