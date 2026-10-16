import { describe, expect, it } from "vitest";
import { isTypingTarget, manualShortcutAction, parseClockInput } from "./manualShortcuts";

const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...extra });
const context = { gameClockRunning: false, timeoutSeconds: 60 };

describe("manual scoring shortcuts", () => {
  it("maps the scoring keys, upper or lower case", () => {
    expect(manualShortcutAction(key("q"), context)).toEqual({ type: "adjustScore", side: "left", delta: 1 });
    expect(manualShortcutAction(key("A"), context)).toEqual({ type: "adjustScore", side: "left", delta: -1 });
    expect(manualShortcutAction(key("p"), context)).toEqual({ type: "adjustScore", side: "right", delta: 1 });
    expect(manualShortcutAction(key("l"), context)).toEqual({ type: "adjustScore", side: "right", delta: -1 });
    expect(manualShortcutAction(key("t"), context)).toEqual({ type: "addBreakTime", seconds: 60 });
    expect(manualShortcutAction(key("b"), context)).toEqual({ type: "startBreak" });
    expect(manualShortcutAction(key("f"), context)).toEqual({ type: "finishMatch" });
  });

  it("toggles the game clock with Space", () => {
    expect(manualShortcutAction(key(" "), context)).toEqual({ type: "startGameClock" });
    expect(manualShortcutAction(key(" "), { ...context, gameClockRunning: true })).toEqual({ type: "stopGameClock" });
  });

  it("undoes with Ctrl or Cmd+Z and ignores other modified keys", () => {
    expect(manualShortcutAction(key("z", { ctrlKey: true }), context)).toEqual({ type: "undo" });
    expect(manualShortcutAction(key("z", { metaKey: true }), context)).toEqual({ type: "undo" });
    expect(manualShortcutAction(key("z", { metaKey: true, shiftKey: true }), context)).toBeNull();
    expect(manualShortcutAction(key("q", { ctrlKey: true }), context)).toBeNull();
    expect(manualShortcutAction(key("q", { altKey: true }), context)).toBeNull();
  });

  it("ignores held keys and keys that are not shortcuts, including H for show/hide", () => {
    expect(manualShortcutAction(key("q", { repeat: true }), context)).toBeNull();
    expect(manualShortcutAction(key("h"), context)).toBeNull();
    expect(manualShortcutAction(key("Enter"), context)).toBeNull();
  });

  it("treats form fields as typing", () => {
    expect(isTypingTarget({ tagName: "INPUT", isContentEditable: false } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("parseClockInput", () => {
  it("reads minutes and seconds, or whole minutes", () => {
    expect(parseClockInput("7:30")).toBe(450);
    expect(parseClockInput("7.05")).toBe(425);
    expect(parseClockInput(" 10 ")).toBe(600);
    expect(parseClockInput("0:00")).toBe(0);
  });

  it("refuses what is not a clock", () => {
    expect(parseClockInput("")).toBeNull();
    expect(parseClockInput("7:75")).toBeNull();
    expect(parseClockInput("abc")).toBeNull();
    expect(parseClockInput("100:00")).toBeNull();
  });
});
