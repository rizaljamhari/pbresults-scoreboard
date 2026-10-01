import { normalizeLiveState } from "../shared/normalize.js";
import {
  REHEARSAL_IDLE_STOP_MS,
  feedShowsRunningMatch,
  idleRehearsalStatus,
  type RehearsalStatus,
  type RehearsalStopReason
} from "../shared/rehearsal.js";
import { buildRehearsalCases, type RehearsalCase, type RehearsalContext, type RehearsalFrame } from "../shared/rehearsalCases.js";
import type { NormalizedLiveState } from "../shared/theme.js";
import type { LiveGate } from "./liveGate.js";

const TICK_MS = 1_000;

export class RehearsalRefusedError extends Error {}

type RunnerOptions = {
  gate: LiveGate;
  /** The real feed, to refuse or stop around a running match. */
  getFeedState: () => NormalizedLiveState;
  /** The on-air theme with teams and assets, or null when nothing is on air. */
  getContext: () => (RehearsalContext & { theme: RehearsalContext["theme"] }) | null;
  onChange: (status: RehearsalStatus) => void;
  now?: () => number;
};

/**
 * Plays rehearsal cases through the live gate. In memory only: a restart ends a rehearsal, and nothing it
 * shows is ever written to themes, teams, overrides or settings.
 */
export class RehearsalRunner {
  private status: RehearsalStatus = { ...idleRehearsalStatus };
  private cases: RehearsalCase[] = [];
  private context: RehearsalContext | null = null;
  private frameIndex = 0;
  private frameStartedAt = 0;
  private frameTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly options: RunnerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  getStatus(): RehearsalStatus {
    return this.status;
  }

  get running() {
    return this.status.phase === "running";
  }

  start(options: { autoPlay?: boolean } = {}): RehearsalStatus {
    if (this.running) return this.status;
    const feed = this.options.getFeedState();
    if (feedShowsRunningMatch(feed)) {
      throw new RehearsalRefusedError("A match is running. Rehearse when the feed is stopped, paused or unreachable, or during a break.");
    }
    const context = this.options.getContext();
    if (!context) {
      throw new RehearsalRefusedError("No theme is on air. Put a theme on air first: rehearsal tests what vMix shows.");
    }
    this.context = context;
    this.cases = buildRehearsalCases(context);
    this.status = {
      phase: "running",
      themeId: context.theme.id,
      themeName: context.theme.name,
      startedAt: new Date(this.now()).toISOString(),
      endedAt: null,
      stopReason: null,
      caseIndex: 0,
      autoPlay: Boolean(options.autoPlay),
      cases: this.cases.map(({ frames: _frames, ...info }) => info),
      marks: {}
    };
    this.showCase(0);
    return this.status;
  }

  go(to: "next" | "prev" | string): RehearsalStatus {
    if (!this.running) return this.status;
    this.touch();
    const index =
      to === "next" ? this.status.caseIndex + 1 : to === "prev" ? this.status.caseIndex - 1 : this.cases.findIndex((item) => item.id === to);
    if (index >= this.cases.length) {
      this.end("finished");
      return this.status;
    }
    if (index < 0) return this.status;
    this.showCase(index);
    return this.status;
  }

  mark(caseId: string, result: "pass" | "issue", note = ""): RehearsalStatus {
    if (!this.cases.some((item) => item.id === caseId)) return this.status;
    this.status = { ...this.status, marks: { ...this.status.marks, [caseId]: { result, note: note.slice(0, 200) } } };
    if (this.running) this.touch();
    this.changed();
    return this.status;
  }

  setAutoPlay(on: boolean): RehearsalStatus {
    if (!this.running) return this.status;
    this.status = { ...this.status, autoPlay: on };
    this.touch();
    this.scheduleFrame();
    this.changed();
    return this.status;
  }

  stop(reason: RehearsalStopReason = "operator"): RehearsalStatus {
    if (this.running) this.end(reason);
    return this.status;
  }

  /** Back to idle after the summary has been read. */
  dismiss(): RehearsalStatus {
    if (this.running) return this.status;
    this.status = { ...idleRehearsalStatus };
    this.changed();
    return this.status;
  }

  /** Every real feed update: a match starting ends the rehearsal at once. */
  onFeed(state: NormalizedLiveState) {
    if (this.running && feedShowsRunningMatch(state)) this.end("match-started");
  }

  dispose() {
    this.clearTimers();
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  private showCase(index: number) {
    this.status = { ...this.status, caseIndex: index };
    this.frameIndex = 0;
    this.touch();
    this.playFrame();
    this.changed();
  }

  private playFrame() {
    this.clearTimers();
    this.frameStartedAt = this.now();
    this.publishFrame();
    this.tickTimer = setInterval(() => this.publishFrame(), TICK_MS);
    this.tickTimer.unref?.();
    this.scheduleFrame();
  }

  /** Moves to the next frame of a case, and in auto-play to the next case, when the frame's time is up. */
  private scheduleFrame() {
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    const current = this.cases[this.status.caseIndex];
    if (!current) return;
    const frame = current.frames[this.frameIndex];
    const isLast = this.frameIndex >= current.frames.length - 1;
    if (isLast && !this.status.autoPlay) return;
    const wait = Math.max(0, this.frameStartedAt + frame.holdMs - this.now());
    this.frameTimer = setTimeout(() => {
      if (!isLast) {
        this.frameIndex += 1;
        this.playFrame();
      } else {
        this.go("next");
      }
    }, wait);
    this.frameTimer.unref?.();
  }

  private publishFrame() {
    const current = this.cases[this.status.caseIndex];
    const frame = current?.frames[this.frameIndex];
    if (!frame || !this.context) return;
    this.options.gate.showRehearsal(this.normalize(frame, Math.floor((this.now() - this.frameStartedAt) / 1000)));
  }

  private normalize(frame: RehearsalFrame, elapsedSeconds: number): NormalizedLiveState {
    const raw = structuredClone(frame.raw);
    if (frame.countdown === "game" && raw.gameTimer) raw.gameTimer.value = Math.max(0, (raw.gameTimer.value ?? 0) - elapsedSeconds);
    if (frame.countdown === "break" && raw.breakTimer) raw.breakTimer.value = Math.max(0, (raw.breakTimer.value ?? 0) - elapsedSeconds);
    const sourceStatus = frame.sourceStatus ?? "ok";
    return normalizeLiveState(raw, {
      sourceStatus,
      fetchedAt: new Date(this.now()).toISOString(),
      errorMessage: sourceStatus === "error" ? "Rehearsal: feed lost (simulated)" : null,
      teams: this.context?.teams ?? [],
      teamOverrides: { left: frame.left, right: frame.right }
    });
  }

  private end(reason: RehearsalStopReason) {
    this.clearTimers();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.status = { ...this.status, phase: "ended", stopReason: reason, endedAt: new Date(this.now()).toISOString(), autoPlay: false };
    this.options.gate.endRehearsal();
    this.changed();
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop("idle"), REHEARSAL_IDLE_STOP_MS);
    this.idleTimer.unref?.();
  }

  private clearTimers() {
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.frameTimer = null;
    this.tickTimer = null;
  }

  private changed() {
    this.options.onChange(this.status);
  }
}
