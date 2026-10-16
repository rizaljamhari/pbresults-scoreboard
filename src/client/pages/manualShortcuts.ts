import { MANUAL_MAX_CLOCK_SECONDS, type ManualMatchAction, type ManualMatchView } from "../../shared/manualMatch";

/** The manual scoring keys, as the legend under the panel shows them. */
export const MANUAL_SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["Space"], label: "Start / stop clock" },
  { keys: ["Q", "A"], label: "Left + / −" },
  { keys: ["P", "L"], label: "Right + / −" },
  { keys: ["B"], label: "Break" },
  { keys: ["T"], label: "Timeout" },
  { keys: ["F"], label: "Finish (asks first)" },
  { keys: ["Shift", "F"], label: "Finish now" },
  { keys: ["Ctrl", "Z"], label: "Undo" }
];

type KeyInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat">;

/** Typing in a field must never score a point. */
export function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}

/** The action a key press stands for, or null when the key is not a manual scoring shortcut. */
export function manualShortcutAction(event: KeyInput, context: { gameClockRunning: boolean; timeoutSeconds: number }): ManualMatchAction | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    return key === "z" && !event.shiftKey && !event.repeat ? { type: "undo" } : null;
  }
  // Holding a key down must not run up a score.
  if (event.repeat) return null;
  switch (key) {
    case " ":
      return { type: context.gameClockRunning ? "stopGameClock" : "startGameClock" };
    case "q":
      return { type: "adjustScore", side: "left", delta: 1 };
    case "a":
      return { type: "adjustScore", side: "left", delta: -1 };
    case "p":
      return { type: "adjustScore", side: "right", delta: 1 };
    case "l":
      return { type: "adjustScore", side: "right", delta: -1 };
    case "b":
      return { type: "startBreak" };
    case "t":
      return { type: "addBreakTime", seconds: context.timeoutSeconds };
    case "f":
      return { type: "finishMatch" };
    default:
      return null;
  }
}

export type ManualConfirmation = { title: string; message: string; confirmLabel: string };

/**
 * The question an action needs before it goes on air, or null when it can go straight away. Finishing puts the winner
 * on air, and changing a finished match reopens it, so both ask; Shift+F is the deliberate way to finish without asking.
 */
export function manualActionConfirmation(action: ManualMatchAction, phase: ManualMatchView["phase"]): ManualConfirmation | null {
  if (action.type === "finishMatch") {
    return {
      title: "Finish the match?",
      message: "The game finished and winner cards go on air now. Undo takes it back.",
      confirmLabel: "Finish match"
    };
  }
  if (phase !== "finished") return null;
  if (action.type === "adjustScore" || action.type === "setScore") {
    return {
      title: "Change the final score?",
      message: "This match is finished. The new score goes on air straight away.",
      confirmLabel: "Change score"
    };
  }
  if (action.type === "startGameClock") {
    return {
      title: "Restart play?",
      message: "This match is finished. Starting the clock puts it back in play.",
      confirmLabel: "Restart play"
    };
  }
  return null;
}

/** Reads a clock the operator typed: "7:30", "7.30" or whole minutes ("10"). Null when it is not a time. */
export function parseClockInput(value: string): number | null {
  const text = value.trim();
  const match = /^(\d{1,2})(?:[:.](\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = match[2] === undefined ? 0 : Number(match[2]);
  if (seconds > 59) return null;
  const total = minutes * 60 + seconds;
  return total <= MANUAL_MAX_CLOCK_SECONDS ? total : null;
}
