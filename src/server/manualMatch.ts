import { normalizeLiveState, type RawLiveState } from "../shared/normalize.js";
import {
  MANUAL_HISTORY_LIMIT,
  MANUAL_TEAM_EVENT_MS,
  type ManualClock,
  type ManualMatchAction,
  type ManualMatchCore,
  type ManualMatchState,
  type ManualMatchView,
  type ManualSide
} from "../shared/manualMatch.js";
import type { AppSettings, NormalizedLiveState, TeamRecord } from "../shared/theme.js";

type ManualSettings = Pick<AppSettings, "manualGameClockSeconds" | "manualBreakClockSeconds">;

export class ManualActionError extends Error {}

/** Milliseconds left on a clock at `now`. */
export function clockRemainingMs(clock: ManualClock, now: number): number {
  if (!clock.runningSince) return clock.remainingMs;
  const startedAt = Date.parse(clock.runningSince);
  return Math.max(0, clock.remainingMs - Math.max(0, now - startedAt));
}

/** Running and not yet at zero. A clock that ran out counts as stopped. */
export function clockRunning(clock: ManualClock, now: number): boolean {
  return Boolean(clock.runningSince) && clockRemainingMs(clock, now) > 0;
}

/** Whole seconds as a countdown shows them: 9.2 s left reads 10. */
export function clockSeconds(clock: ManualClock, now: number): number {
  return Math.ceil(clockRemainingMs(clock, now) / 1000);
}

function stopped(clock: ManualClock, now: number): ManualClock {
  return { remainingMs: clockRemainingMs(clock, now), runningSince: null };
}

function started(remainingMs: number, now: number): ManualClock {
  return { remainingMs, runningSince: remainingMs > 0 ? new Date(now).toISOString() : null };
}

function sideLabel(side: ManualSide) {
  return side === "left" ? "Left" : "Right";
}

function formatSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function core(state: ManualMatchState): ManualMatchCore {
  const { history: _history, ...rest } = state;
  return rest;
}

/**
 * Applies one operator action. Returns the next state with the previous one on the undo stack, or the same object
 * when the action changes nothing.
 */
export function applyManualAction(state: ManualMatchState, action: ManualMatchAction, now: number, settings: ManualSettings): ManualMatchState {
  if (action.type === "undo") {
    const previous = state.history.at(-1);
    if (!previous) throw new ManualActionError("Nothing to undo");
    return { ...previous.state, updatedAt: new Date(now).toISOString(), history: state.history.slice(0, -1) };
  }

  const result = nextCore(core(state), action, now, settings);
  if (!result) return state;
  return {
    ...result.next,
    updatedAt: new Date(now).toISOString(),
    history: [...state.history, { label: result.label, state: core(state) }].slice(-MANUAL_HISTORY_LIMIT)
  };
}

function nextCore(
  state: ManualMatchCore,
  action: Exclude<ManualMatchAction, { type: "undo" }>,
  now: number,
  settings: ManualSettings
): { next: ManualMatchCore; label: string } | null {
  switch (action.type) {
    case "setTeam": {
      const team = { ...state[action.side], teamId: action.teamId, name: action.teamId ? "" : action.name };
      return { next: { ...state, [action.side]: team }, label: `${sideLabel(action.side)} team` };
    }
    case "adjustScore": {
      const score = Math.max(0, state[action.side].score + action.delta);
      if (score === state[action.side].score) return null;
      return {
        next: { ...state, [action.side]: { ...state[action.side], score } },
        label: `${sideLabel(action.side)} ${action.delta > 0 ? "+" : ""}${action.delta}`
      };
    }
    case "setScore":
      if (action.value === state[action.side].score) return null;
      return { next: { ...state, [action.side]: { ...state[action.side], score: action.value } }, label: `${sideLabel(action.side)} score ${action.value}` };
    case "startGameClock": {
      if (clockRunning(state.gameClock, now)) return null;
      const remaining = clockRemainingMs(state.gameClock, now);
      if (remaining === 0) throw new ManualActionError("The game clock is at 0:00. Set or reset it first.");
      // Play starting ends a break.
      return {
        next: { ...state, phase: "game", gameClock: started(remaining, now), breakClock: stopped(state.breakClock, now), teamEvent: null },
        label: "Start clock"
      };
    }
    case "stopGameClock":
      if (!clockRunning(state.gameClock, now)) return null;
      return { next: { ...state, gameClock: stopped(state.gameClock, now) }, label: "Stop clock" };
    case "setGameClock": {
      const remainingMs = action.seconds * 1000;
      const gameClock = clockRunning(state.gameClock, now) ? started(remainingMs, now) : { remainingMs, runningSince: null };
      return { next: { ...state, gameClock }, label: `Clock ${formatSeconds(action.seconds)}` };
    }
    case "resetGameClock":
      return { next: { ...state, gameClock: { remainingMs: settings.manualGameClockSeconds * 1000, runningSince: null } }, label: "Reset clock" };
    case "startBreak": {
      const resuming = action.seconds === undefined && (state.phase === "break" || state.phase === "finished") && clockRemainingMs(state.breakClock, now) > 0;
      if (resuming && clockRunning(state.breakClock, now)) return null;
      const remainingMs = resuming ? clockRemainingMs(state.breakClock, now) : (action.seconds ?? settings.manualBreakClockSeconds) * 1000;
      return {
        next: {
          ...state,
          // A break after a finished match keeps it finished, so the result stays on screen as PBResults does.
          phase: state.phase === "finished" ? "finished" : "break",
          gameClock: stopped(state.gameClock, now),
          breakClock: started(remainingMs, now),
          teamEvent: null
        },
        label: resuming ? "Resume break" : "Start break"
      };
    }
    case "addBreakTime": {
      const inBreak = state.phase === "break" || state.phase === "finished";
      const remainingMs = (inBreak ? clockRemainingMs(state.breakClock, now) : 0) + action.seconds * 1000;
      const keepPaused = inBreak && !clockRunning(state.breakClock, now) && clockRemainingMs(state.breakClock, now) > 0;
      return {
        next: {
          ...state,
          phase: inBreak ? state.phase : "break",
          gameClock: stopped(state.gameClock, now),
          breakClock: keepPaused ? { remainingMs, runningSince: null } : started(remainingMs, now),
          teamEvent: null
        },
        label: `Timeout +${formatSeconds(action.seconds)}`
      };
    }
    case "stopBreak":
      if (!clockRunning(state.breakClock, now)) return null;
      return { next: { ...state, breakClock: stopped(state.breakClock, now) }, label: "Pause break" };
    case "finishMatch":
      if (state.phase === "finished") return null;
      return { next: { ...state, phase: "finished", gameClock: stopped(state.gameClock, now), teamEvent: null }, label: "Finish match" };
    case "teamEvent":
      return {
        next: { ...state, teamEvent: { kind: action.kind, side: action.side, until: new Date(now + MANUAL_TEAM_EVENT_MS).toISOString() } },
        label: `${action.kind === "towel" ? "Towel" : "Base"} ${action.side}`
      };
    case "nextMatch":
      return {
        next: {
          ...state,
          left: { ...state.left, score: 0 },
          right: { ...state.right, score: 0 },
          round: state.round + 1,
          // A running break carries on into the next match's setup.
          phase: clockRunning(state.breakClock, now) ? "break" : "idle",
          gameClock: { remainingMs: settings.manualGameClockSeconds * 1000, runningSince: null },
          teamEvent: null
        },
        label: "Next match"
      };
  }
}

function teamEventActive(state: ManualMatchCore, now: number) {
  return state.teamEvent && Date.parse(state.teamEvent.until) > now ? state.teamEvent : null;
}

/** The codes PBResults uses: TOWEL1 shows on the left (home), BASE1 on the right (away). */
function teamEventCode(event: NonNullable<ManualMatchCore["teamEvent"]>) {
  if (event.kind === "towel") return event.side === "left" ? "TOWEL1" : "TOWEL2";
  return event.side === "left" ? "BASE2" : "BASE1";
}

export function resolveManualTeam(team: ManualMatchCore["left"], teams: TeamRecord[]): TeamRecord | null {
  return team.teamId ? teams.find((record) => record.id === team.teamId) ?? null : null;
}

/** The manual match in the shape PBResults `/live` sends, so it goes through the same normalizer as the feed. */
export function manualToRaw(state: ManualMatchCore, teams: TeamRecord[], now: number): RawLiveState {
  const event = teamEventActive(state, now);
  const inBreak = state.phase === "break" || state.phase === "finished";
  const name = (side: ManualSide) => resolveManualTeam(state[side], teams)?.canonicalName ?? state[side].name;
  return {
    state: event ? teamEventCode(event) : state.phase === "finished" ? "END" : clockRunning(state.gameClock, now) ? "RUNNING" : "STOPPED",
    period: inBreak ? "BREAK" : "GAME",
    round: state.round,
    sidesSwitched: 0,
    secondGame: false,
    mainGame: [
      { name: name("left"), score: state.left.score },
      { name: name("right"), score: state.right.score }
    ],
    gameTimer: { value: clockSeconds(state.gameClock, now), state: clockRunning(state.gameClock, now) ? 2 : 0 },
    breakTimer: { value: clockSeconds(state.breakClock, now), state: clockRunning(state.breakClock, now) ? 2 : 0 }
  };
}

export function manualToLiveState(state: ManualMatchCore, teams: TeamRecord[], now: number): NormalizedLiveState {
  const live = normalizeLiveState(manualToRaw(state, teams, now), {
    sourceStatus: "ok",
    source: "manual",
    fetchedAt: new Date(now).toISOString(),
    errorMessage: null,
    teams,
    // Teams the operator chose directly count as resolved by hand: no unresolved warning, no pick alert.
    teamOverrides: { left: resolveManualTeam(state.left, teams), right: resolveManualTeam(state.right, teams) }
  });
  // A typed name is the operator's choice, not a feed name to resolve: it never counts as unresolved.
  return { ...live, unresolvedTeamNames: [] };
}

export function manualMatchView(state: ManualMatchState): ManualMatchView {
  return { ...core(state), undoLabel: state.history.at(-1)?.label ?? null };
}

/** Everything the overlay shows, without the timestamp, to tell a real change from a heartbeat. */
function visibleKey(state: NormalizedLiveState) {
  return JSON.stringify({ ...state, fetchedAt: null });
}

type ManualMatchEngineOptions = {
  load: () => ManualMatchState;
  save: (state: ManualMatchState) => ManualMatchState;
  getTeams: () => TeamRecord[];
  getSettings: () => ManualSettings;
  now?: () => number;
  tickMs?: number;
  /** A live state goes out at least this often while active, like a feed poll, so overlays never look behind. */
  heartbeatMs?: number;
};

type Listener = (state: NormalizedLiveState) => void;

/**
 * Runs the manual match: applies operator actions, persists them, and publishes the live state whenever something
 * on screen changes (a clock second, a score, an event ending), plus a heartbeat. The match is held in memory and
 * written only on an action; teams are re-read with each heartbeat, as often as the feed poller reads them.
 */
export class ManualMatchEngine {
  private readonly now: () => number;
  private readonly tickMs: number;
  private readonly heartbeatMs: number;
  private readonly listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;
  private state: ManualMatchState;
  private teams: TeamRecord[];
  private live: NormalizedLiveState;
  private lastKey = "";
  private lastPublishedAt = 0;

  constructor(private readonly options: ManualMatchEngineOptions) {
    this.now = options.now ?? Date.now;
    this.tickMs = options.tickMs ?? 250;
    this.heartbeatMs = options.heartbeatMs ?? 1_000;
    this.state = options.load();
    this.teams = options.getTeams();
    this.live = manualToLiveState(this.state, this.teams, this.now());
  }

  /** Starts ticking; only while manual scoring is the active source. */
  setActive(active: boolean) {
    if (active && !this.timer) {
      this.timer = setInterval(() => this.tick(), this.tickMs);
      this.timer.unref?.();
      this.tick(true);
    } else if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get active() {
    return this.timer !== null;
  }

  stop() {
    this.setActive(false);
  }

  getState(): NormalizedLiveState {
    return this.live;
  }

  getView(): ManualMatchView {
    return manualMatchView(this.state);
  }

  apply(action: ManualMatchAction): ManualMatchView {
    const next = applyManualAction(this.state, action, this.now(), this.options.getSettings());
    if (next !== this.state) this.state = this.options.save(next);
    this.teams = this.options.getTeams();
    this.tick(true);
    return manualMatchView(this.state);
  }

  /** Re-reads the saved match and teams, after a backup restore or import replaced them. */
  reload() {
    this.state = this.options.load();
    this.teams = this.options.getTeams();
    this.tick(true);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private tick(force = false) {
    const now = this.now();
    const heartbeatDue = now - this.lastPublishedAt >= this.heartbeatMs;
    if (heartbeatDue) this.teams = this.options.getTeams();
    const live = manualToLiveState(this.state, this.teams, now);
    const key = visibleKey(live);
    this.live = live;
    if (!force && key === this.lastKey && !heartbeatDue) return;
    this.lastKey = key;
    this.lastPublishedAt = now;
    for (const listener of this.listeners) listener(live);
  }
}
