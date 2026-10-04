import { describe, expect, it } from "vitest";
import {
  REMOTE_ACCESS_DEFAULT_DURATION_MINUTES,
  REMOTE_ACCESS_DURATIONS_MINUTES,
  ngrokAuthtokenSchema,
  remoteAccessStartRequestSchema
} from "./remoteAccess";

describe("remote access schemas", () => {
  it("accepts only the offered session lengths, up to eight hours", () => {
    expect(REMOTE_ACCESS_DURATIONS_MINUTES).toContain(REMOTE_ACCESS_DEFAULT_DURATION_MINUTES);
    expect(Math.max(...REMOTE_ACCESS_DURATIONS_MINUTES)).toBe(480);
    const start = (durationMinutes: number) =>
      remoteAccessStartRequestSchema.safeParse({ durationMinutes, confirmation: "START_REMOTE_ACCESS" }).success;
    expect(start(120)).toBe(true);
    expect(start(90)).toBe(false);
    expect(start(481)).toBe(false);
    expect(remoteAccessStartRequestSchema.safeParse({ durationMinutes: 120, confirmation: "start" }).success).toBe(false);
  });

  it("trims a pasted authtoken and rejects whitespace, control characters, and short values", () => {
    expect(ngrokAuthtokenSchema.parse("  2abcDEFghiJKLmnoPQRstu_3vwxYZ0123456789\n")).toBe("2abcDEFghiJKLmnoPQRstu_3vwxYZ0123456789");
    expect(ngrokAuthtokenSchema.safeParse("2abcDEFghiJKL mnoPQRstu_3vwxYZ").success).toBe(false);
    expect(ngrokAuthtokenSchema.safeParse("2abcDEFghiJKL\u0000mnoPQRstu_3vwxYZ").success).toBe(false);
    expect(ngrokAuthtokenSchema.safeParse("short").success).toBe(false);
  });
});
