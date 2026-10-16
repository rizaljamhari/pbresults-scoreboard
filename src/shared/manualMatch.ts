import { z } from "zod";

/**
 * Manual scoring: the operator runs the match by hand when an event has no PBResults feed. The server keeps this
 * state, turns it into the same raw shape PBResults sends, and the overlay renders it like any feed.
 */

export const MANUAL_HISTORY_LIMIT = 30;
export const MANUAL_TEAM_EVENT_MS = 4_000;
export const MANUAL_MAX_CLOCK_SECONDS = 99 * 60 + 59;

export const manualSideValues = ["left", "right"] as const;
export type ManualSide = (typeof manualSideValues)[number];

/** A clock stores what was left when it last started or stopped, so the time shown never drifts and survives a restart. */
export const manualClockSchema = z.object({
  remainingMs: z.number().int().min(0),
  runningSince: z.string().nullable()
});

export const manualTeamSchema = z.object({
  /** A registry team; when set, its names and logo are used. */
  teamId: z.string().nullable().default(null),
  /** Shown when no registry team is chosen. */
  name: z.string().max(40).default(""),
  score: z.number().int().min(0).default(0)
});

export const manualTeamEventSchema = z.object({
  kind: z.enum(["towel", "base"]),
  /** The side whose card shows. */
  side: z.enum(manualSideValues),
  until: z.string()
});

export const manualMatchCoreSchema = z.object({
  left: manualTeamSchema.default({}),
  right: manualTeamSchema.default({}),
  round: z.number().int().min(0).default(1),
  /** `finished` is a match that ended; a break can run after it, as PBResults does between matches. */
  phase: z.enum(["idle", "game", "break", "finished"]).default("idle"),
  gameClock: manualClockSchema.default({ remainingMs: 600_000, runningSince: null }),
  breakClock: manualClockSchema.default({ remainingMs: 0, runningSince: null }),
  teamEvent: manualTeamEventSchema.nullable().default(null),
  updatedAt: z.string().nullable().default(null)
});

export const manualMatchStateSchema = manualMatchCoreSchema.extend({
  /** Earlier states, newest last, for Undo. */
  history: z
    .array(z.object({ label: z.string(), state: manualMatchCoreSchema }))
    .max(MANUAL_HISTORY_LIMIT)
    .default([])
});

/** What the Operations panel gets: the match without its undo stack, plus what Undo would reverse. */
export const manualMatchViewSchema = manualMatchCoreSchema.extend({
  undoLabel: z.string().nullable()
});

const side = z.enum(manualSideValues);
const clockSeconds = z.number().int().min(0).max(MANUAL_MAX_CLOCK_SECONDS);

export const manualMatchActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setTeam"), side, teamId: z.string().min(1).nullable(), name: z.string().trim().max(40).default("") }),
  z.object({ type: z.literal("adjustScore"), side, delta: z.number().int().min(-9).max(9) }),
  z.object({ type: z.literal("setScore"), side, value: z.number().int().min(0).max(999) }),
  z.object({ type: z.literal("startGameClock") }),
  z.object({ type: z.literal("stopGameClock") }),
  z.object({ type: z.literal("setGameClock"), seconds: clockSeconds }),
  z.object({ type: z.literal("resetGameClock") }),
  /** Without `seconds`, resumes a paused break, or starts one at the default length. */
  z.object({ type: z.literal("startBreak"), seconds: clockSeconds.optional() }),
  /** A timeout: the break clock jumps up, which is what the overlay's timeout card watches for. */
  z.object({ type: z.literal("addBreakTime"), seconds: z.number().int().min(1).max(3600) }),
  z.object({ type: z.literal("stopBreak") }),
  /** Corrects the break clock during a break; keeps it running if it was. */
  z.object({ type: z.literal("setBreakClock"), seconds: clockSeconds }),
  /** Back to the break length, paused. */
  z.object({ type: z.literal("resetBreakClock") }),
  z.object({ type: z.literal("finishMatch") }),
  z.object({ type: z.literal("teamEvent"), kind: z.enum(["towel", "base"]), side }),
  z.object({ type: z.literal("nextMatch") }),
  z.object({ type: z.literal("undo") })
]);

export type ManualClock = z.infer<typeof manualClockSchema>;
export type ManualTeam = z.infer<typeof manualTeamSchema>;
export type ManualMatchCore = z.infer<typeof manualMatchCoreSchema>;
export type ManualMatchState = z.infer<typeof manualMatchStateSchema>;
export type ManualMatchView = z.infer<typeof manualMatchViewSchema>;
export type ManualMatchAction = z.infer<typeof manualMatchActionSchema>;

export const defaultManualMatchState: ManualMatchState = manualMatchStateSchema.parse({});
