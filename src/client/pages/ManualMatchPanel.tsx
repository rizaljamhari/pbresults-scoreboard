import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Flag, Minus, Pause, Play, Plus, RotateCcw, SkipForward, Timer, Undo2 } from "lucide-react";
import { formatClock } from "../../shared/normalize";
import type { ManualClock, ManualMatchAction, ManualMatchView, ManualSide } from "../../shared/manualMatch";
import type { AppSettings, NormalizedLiveState, TeamRecord } from "../../shared/theme";
import { api } from "../api";
import { confirmAction, modalPromptOpen } from "../confirm";
import { useManualMatch, useNow } from "../hooks";
import { showToast } from "../toast";
import { Button, Chip, type Tone } from "../components/admin/kit";
import { MANUAL_SHORTCUTS, isTypingTarget, manualShortcutAction, parseClockInput } from "./manualShortcuts";
import { searchTeams } from "./teamSearch";

/** Team name slots in themes are sized for the 8 characters the PBResults tablet sends. */
const NAME_FIT = 8;

const PHASE_LABEL: Record<ManualMatchView["phase"], { label: string; tone: Tone }> = {
  idle: { label: "Ready", tone: "neutral" },
  game: { label: "Game", tone: "ok" },
  break: { label: "Break", tone: "warning" },
  finished: { label: "Finished", tone: "neutral" }
};

function remainingSeconds(clock: ManualClock, now: number) {
  const elapsed = clock.runningSince ? Math.max(0, now - Date.parse(clock.runningSince)) : 0;
  return Math.ceil(Math.max(0, clock.remainingMs - elapsed) / 1000);
}

function clockRunning(clock: ManualClock, now: number) {
  return Boolean(clock.runningSince) && remainingSeconds(clock, now) > 0;
}

/** Finds a registry team, or takes the typed name as it is. */
function ManualTeamPicker({
  side,
  teams,
  logoFor,
  onChoose
}: {
  side: ManualSide;
  teams: TeamRecord[];
  logoFor: (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => string | undefined;
  onChoose: (choice: { teamId: string } | { name: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const typed = query.trim();
  const results = useMemo(() => searchTeams(teams, query, 6), [teams, query]);
  const options = [
    ...results.map((result) => ({ key: result.team.id, label: result.team.canonicalName, tag: result.via ? `as ${result.via}` : null, team: result.team as TeamRecord | null })),
    ...(typed ? [{ key: "__typed", label: `Use “${typed}” as typed`, tag: "no logo", team: null }] : [])
  ];
  const listId = `manual-picker-${side}`;

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChoose(option.team ? { teamId: option.team.id } : { name: typed });
  }

  return (
    <div className="pba-picker">
      <input
        className="pba-input"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={`Team for the ${side} side`}
        aria-activedescendant={options[highlight] ? `${listId}-${options[highlight].key}` : undefined}
        autoComplete="off"
        autoFocus
        placeholder="Search teams or type a name"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            setHighlight((current) => (current + 1) % options.length);
          } else if (event.key === "ArrowUp" && options.length) {
            event.preventDefault();
            setHighlight((current) => (current - 1 + options.length) % options.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(highlight);
          }
        }}
      />
      <ul id={listId} role="listbox" className="pba-picker-list" aria-label="Teams">
        {options.length === 0 ? (
          <li className="pba-picker-empty">Type to search the team registry, or to use a name that is not in it.</li>
        ) : (
          options.map((option, index) => {
            const logo = option.team ? logoFor(option.team) : undefined;
            return (
              <li
                key={option.key}
                id={`${listId}-${option.key}`}
                role="option"
                aria-selected={index === highlight}
                className="pba-picker-option"
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(index);
                }}
              >
                <span className="pba-picker-logo">{logo ? <img src={logo} alt="" /> : null}</span>
                <span className="pba-picker-name">{option.label}</span>
                {option.tag ? <span className="pba-picker-tag">{option.tag}</span> : null}
              </li>
            );
          })
        )}
      </ul>
      {typed.length > NAME_FIT && !results.length ? (
        <p className="pba-hint">Longer than {NAME_FIT} characters: it may not fit the theme's name slot.</p>
      ) : null}
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
  onAction
}: {
  side: ManualSide;
  view: ManualMatchView;
  live: NormalizedLiveState | null;
  teams: TeamRecord[];
  logoFor: (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => string | undefined;
  disabled: boolean;
  onAction: (action: ManualMatchAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const entry = view[side];
  const team = entry.teamId ? teams.find((record) => record.id === entry.teamId) ?? null : null;
  const onAir = live?.source === "manual" ? (side === "left" ? live.displayLeftTeam : live.displayRightTeam) : null;
  const name = onAir?.name || team?.scoreboardDisplayName || team?.canonicalName || entry.name;
  const logo = logoFor(team);
  const keys = side === "left" ? ["Q", "A"] : ["P", "L"];
  const missingTeam = Boolean(entry.teamId) && !team;

  return (
    <div className="pba-team-side pba-manual-side">
      <div className="pba-side-label">
        {side === "left" ? "Left" : "Right"}
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <Button variant="text" size="sm" className="pba-push" disabled={disabled}>
              {entry.teamId || entry.name ? "Change team" : "Choose team"}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="pba-scope pba-pop pba-picker-pop" align="end" sideOffset={6}>
              <ManualTeamPicker
                side={side}
                teams={teams}
                logoFor={logoFor}
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
            {missingTeam ? "That team was removed from Teams" : team ? team.canonicalName : entry.name ? "Typed name, no logo" : "Choose a team to show its name and logo"}
          </div>
        </div>
      </div>
      <div className="pba-manual-score" role="group" aria-label={`${side === "left" ? "Left" : "Right"} score`}>
        <Button aria-label={`${side} score down`} title={`Score down (${keys[1]})`} disabled={disabled || entry.score === 0} onClick={() => onAction({ type: "adjustScore", side, delta: -1 })}>
          <Minus aria-hidden />
        </Button>
        <output className="pba-manual-figure" aria-live="polite">
          {entry.score}
        </output>
        <Button aria-label={`${side} score up`} title={`Score up (${keys[0]})`} disabled={disabled} onClick={() => onAction({ type: "adjustScore", side, delta: 1 })}>
          <Plus aria-hidden />
        </Button>
        <span className="pba-hint pba-manual-keys">
          <kbd className="pba-kbd">{keys[0]}</kbd> <kbd className="pba-kbd">{keys[1]}</kbd>
        </span>
      </div>
      <div className="pba-team-actions">
        <Button size="sm" disabled={disabled} onClick={() => onAction({ type: "teamEvent", kind: "towel", side })} title="Shows the theme's towel card on this side">
          Towel
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => onAction({ type: "teamEvent", kind: "base", side })} title="Shows the theme's base card on this side">
          Base
        </Button>
      </div>
    </div>
  );
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
  const now = useNow(250);
  const disabled = rehearsing || !view;
  // Actions go out one at a time, in the order pressed, so a quick double tap scores twice and never out of order.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const manualLive = live?.source === "manual" ? live : null;

  const gameSeconds = manualLive ? manualLive.gameTimer.value : view ? remainingSeconds(view.gameClock, now) : 0;
  const gameRunning = manualLive ? manualLive.gameTimer.state === 2 : view ? clockRunning(view.gameClock, now) : false;
  const breakSeconds = manualLive ? manualLive.breakTimer.value : view ? remainingSeconds(view.breakClock, now) : 0;
  const breakRunning = manualLive ? manualLive.breakTimer.state === 2 : view ? clockRunning(view.breakClock, now) : false;
  const inBreak = view?.phase === "break" || view?.phase === "finished";

  function run(action: ManualMatchAction) {
    queueRef.current = queueRef.current.then(async () => {
      try {
        manual.setData?.(await api.manualAction(action));
      } catch (error) {
        showToast({ kind: "error", message: error instanceof Error ? error.message : "That action did not go through." });
      }
    });
    return queueRef.current;
  }

  // Keyboard shortcuts work anywhere on the page, except while typing or in a dialog.
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  shortcutRef.current = (event: KeyboardEvent) => {
    if (disabled || modalPromptOpen() || isTypingTarget(event.target)) return;
    const action = manualShortcutAction(event, { gameClockRunning: gameRunning, timeoutSeconds: settings.manualTimeoutSeconds });
    if (!action) return;
    event.preventDefault();
    // Space on a focused button would also press it when the key comes up.
    if (event.key === " " && event.target instanceof HTMLElement && event.target.tagName === "BUTTON") event.target.blur();
    void run(action);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function nextMatch() {
    const ok = await confirmAction({
      title: "Start the next match?",
      message: "Scores go back to 0, the round moves on and the game clock resets. The teams stay until you change them.",
      confirmLabel: "Next match"
    });
    if (ok) void run({ type: "nextMatch" });
  }

  const phase = view ? PHASE_LABEL[view.phase] : null;
  const timeoutLabel = formatClock(settings.manualTimeoutSeconds).replace(/^0/, "");

  return (
    <section className="pba-surface" aria-labelledby="manual-scoring-title">
      <div className="pba-section-head pba-ops-head">
        <h2 id="manual-scoring-title" className="pba-title">
          Manual scoring
        </h2>
        {phase ? <Chip tone={phase.tone}>{phase.label}</Chip> : null}
        {view ? <span className="pba-hint">Round {view.round}</span> : null}
        <Button
          variant="ghost"
          size="sm"
          className="pba-push"
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
          <div className="pba-resolve">
            <ManualTeamSide side="left" view={view} live={live} teams={teams} logoFor={logoFor} disabled={disabled} onAction={(action) => void run(action)} />
            <ManualTeamSide side="right" view={view} live={live} teams={teams} logoFor={logoFor} disabled={disabled} onAction={(action) => void run(action)} />
          </div>
          <div className="pba-manual-clocks">
            <div className="pba-manual-clock">
              <div className="pba-side-label">Game clock</div>
              <div className="pba-manual-row">
                <output className={`pba-manual-figure${gameRunning ? " is-running" : ""}`}>{formatClock(gameSeconds)}</output>
                <Button disabled={disabled || (!gameRunning && gameSeconds === 0)} onClick={() => void run({ type: gameRunning ? "stopGameClock" : "startGameClock" })}>
                  {gameRunning ? <Pause aria-hidden /> : <Play aria-hidden />}
                  {gameRunning ? "Stop" : "Start"}
                  <kbd className="pba-kbd">Space</kbd>
                </Button>
              </div>
              <ClockSetter
                label="Set the game clock"
                resetTo={settings.manualGameClockSeconds}
                disabled={disabled}
                onSet={(seconds) => void run({ type: "setGameClock", seconds })}
                onReset={() => void run({ type: "resetGameClock" })}
              />
            </div>
            <div className="pba-manual-clock">
              <div className="pba-side-label">Break</div>
              <div className="pba-manual-row">
                <output className={`pba-manual-figure${breakRunning ? " is-running" : ""}${inBreak ? "" : " is-idle"}`}>{formatClock(breakSeconds)}</output>
                {breakRunning ? (
                  <Button disabled={disabled} onClick={() => void run({ type: "stopBreak" })}>
                    <Pause aria-hidden />
                    Pause
                  </Button>
                ) : (
                  <Button disabled={disabled} onClick={() => void run({ type: "startBreak" })} title={inBreak && breakSeconds > 0 ? "Resume the break" : `Start a ${formatClock(settings.manualBreakClockSeconds)} break`}>
                    <Play aria-hidden />
                    {inBreak && breakSeconds > 0 ? "Resume" : "Start break"}
                    <kbd className="pba-kbd">B</kbd>
                  </Button>
                )}
                <Button disabled={disabled} onClick={() => void run({ type: "addBreakTime", seconds: settings.manualTimeoutSeconds })} title="Adds time to the break clock; the theme's timeout card shows">
                  <Timer aria-hidden />
                  Timeout +{timeoutLabel}
                  <kbd className="pba-kbd">T</kbd>
                </Button>
              </div>
              <ClockSetter
                label="Set the break clock"
                resetTo={settings.manualBreakClockSeconds}
                disabled={disabled || !inBreak}
                // Raising the break clock reads to the overlay like a timeout.
                title={inBreak ? "A higher time shows the theme's timeout card, like Timeout" : "Start a break to set its clock"}
                onSet={(seconds) => void run({ type: "setBreakClock", seconds })}
                onReset={() => void run({ type: "resetBreakClock" })}
              />
            </div>
          </div>
          <div className="pba-manual-match">
            <Button disabled={disabled || view.phase === "finished"} onClick={() => void run({ type: "finishMatch" })} title="Ends the match: the theme's game finished and winner cards show">
              <Flag aria-hidden />
              Finish match
              <kbd className="pba-kbd">F</kbd>
            </Button>
            <Button variant="ghost" disabled={disabled} onClick={() => void nextMatch()}>
              <SkipForward aria-hidden />
              Next match
            </Button>
          </div>
          <div className="pba-manual-legend pba-hint" aria-label="Keyboard shortcuts">
            {MANUAL_SHORTCUTS.map((shortcut) => (
              <span key={shortcut.label}>
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="pba-kbd">
                    {key}
                  </kbd>
                ))}{" "}
                {shortcut.label}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
