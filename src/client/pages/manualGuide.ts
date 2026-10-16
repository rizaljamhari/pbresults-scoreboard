import type { ManualMatchAction, ManualMatchView } from "../../shared/manualMatch";

/**
 * Guided mode shows only the controls that make sense at this moment of the match, so a non-technical operator is not
 * choosing from every control mid-point. Full shows everything. Either way the server applies the same chains
 * (a point stops the clock, a break ending starts it); this only decides what the panel offers.
 */
export type ManualControlMode = "guided" | "full";

export type ManualMoment = "ready" | "playing" | "stopped" | "break" | "finished";

export type ManualControl =
  | "scoreUp"
  | "scoreDown"
  | "towelBase"
  | "startClock"
  | "stopClock"
  | "startBreak"
  | "pauseBreak"
  | "resumeBreak"
  | "timeout"
  | "finish"
  | "next";

/** Undo, team changes and Adjust clocks are always offered; they are not listed here. */
const GUIDED_CONTROLS: Record<ManualMoment, readonly ManualControl[]> = {
  // A short break before the first point works as a countdown to the start.
  ready: ["startClock", "startBreak"],
  playing: ["scoreUp", "towelBase", "stopClock", "finish"],
  stopped: ["startBreak", "timeout", "startClock", "finish"],
  break: ["pauseBreak", "resumeBreak", "startBreak", "timeout", "startClock", "finish"],
  // Between matches: a break may run, but nothing about the finished match changes.
  finished: ["next", "startBreak", "pauseBreak", "resumeBreak"]
};

const MOMENT_PHRASE: Record<ManualMoment, string> = {
  ready: "before play starts",
  playing: "while play is running",
  stopped: "between points",
  break: "during a break",
  finished: "after the match"
};

export function manualMoment(phase: ManualMatchView["phase"], gameRunning: boolean): ManualMoment {
  if (phase === "finished") return "finished";
  if (phase === "break") return "break";
  if (gameRunning) return "playing";
  return phase === "idle" ? "ready" : "stopped";
}

export function controlAllowed(control: ManualControl, moment: ManualMoment, mode: ManualControlMode): boolean {
  return mode === "full" || GUIDED_CONTROLS[moment].includes(control);
}

/**
 * The control an action belongs to, or null for actions that are always offered: team changes, Undo, and the
 * corrections under Adjust clocks (set, reset and presets).
 */
export function controlForAction(action: ManualMatchAction, context: { breakResumable: boolean }): ManualControl | null {
  switch (action.type) {
    case "adjustScore":
      return action.delta > 0 ? "scoreUp" : "scoreDown";
    case "startGameClock":
      return "startClock";
    case "stopGameClock":
      return "stopClock";
    case "startBreak":
      if (action.seconds !== undefined) return null;
      return context.breakResumable ? "resumeBreak" : "startBreak";
    case "stopBreak":
      return "pauseBreak";
    case "addBreakTime":
      return "timeout";
    case "finishMatch":
      return "finish";
    case "teamEvent":
      return "towelBase";
    case "nextMatch":
      return "next";
    default:
      return null;
  }
}

/** What a blocked shortcut says, so a key that does nothing never feels broken. */
export function guidedBlockMessage(moment: ManualMoment): string {
  return `Not available ${MOMENT_PHRASE[moment]}. Switch the panel to Full for every control.`;
}
