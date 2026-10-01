import { describe, expect, it } from "vitest";
import type { NormalizedLiveState } from "../../shared/theme";
import { isTimeoutJump } from "./momentTriggers";

function tick(breakClock: number, period: "GAME" | "BREAK" = "BREAK", state = "RUNNING") {
  return { period, state, breakTimer: { value: breakClock, state: 2 } } as NormalizedLiveState;
}

describe("timeout trigger", () => {
  it("fires when the break clock jumps up by at least the threshold", () => {
    expect(isTimeoutJump(tick(30), tick(90), 45)).toBe(true);
    expect(isTimeoutJump(tick(30), tick(75), 45)).toBe(true);
  });

  it("ignores smaller jumps and the clock counting down", () => {
    expect(isTimeoutJump(tick(30), tick(74), 45)).toBe(false);
    expect(isTimeoutJump(tick(30), tick(29), 45)).toBe(false);
    expect(isTimeoutJump(tick(12), tick(16), 5)).toBe(false);
    expect(isTimeoutJump(tick(11), tick(16), 5)).toBe(true);
  });

  it("treats a jump from a nearly expired clock as the next break, not a timeout", () => {
    expect(isTimeoutJump(tick(10), tick(120), 45)).toBe(false);
  });

  it("only fires between two break ticks of a live match", () => {
    expect(isTimeoutJump(tick(30, "GAME"), tick(120), 45)).toBe(false);
    expect(isTimeoutJump(tick(30), tick(120, "GAME"), 45)).toBe(false);
    expect(isTimeoutJump(tick(30), tick(120, "BREAK", "END"), 45)).toBe(false);
    expect(isTimeoutJump(tick(30, "BREAK", "END"), tick(120), 45)).toBe(false);
  });

  it("falls back to 45 seconds when no threshold is set", () => {
    expect(isTimeoutJump(tick(30), tick(74), 0)).toBe(false);
    expect(isTimeoutJump(tick(30), tick(75), 0)).toBe(true);
  });
});
