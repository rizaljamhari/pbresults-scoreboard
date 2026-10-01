import { z } from "zod";

/** Rehearsal status shared by the server, the event stream and the Operations panel. */

export const REHEARSAL_IDLE_STOP_MS = 10 * 60_000;

export const rehearsalStopReasonValues = ["operator", "match-started", "idle", "theme-changed", "finished"] as const;

export const rehearsalMarkSchema = z.object({
  result: z.enum(["pass", "issue"]),
  note: z.string().max(200).default("")
});

export const rehearsalCaseInfoSchema = z.object({
  id: z.string(),
  group: z.string(),
  title: z.string(),
  expectation: z.string(),
  source: z.string().nullable()
});

export const rehearsalStatusSchema = z.object({
  phase: z.enum(["idle", "running", "ended"]),
  themeId: z.string().nullable(),
  themeName: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  stopReason: z.enum(rehearsalStopReasonValues).nullable(),
  caseIndex: z.number().int().min(0),
  autoPlay: z.boolean(),
  cases: z.array(rehearsalCaseInfoSchema),
  marks: z.record(z.string(), rehearsalMarkSchema)
});

export type RehearsalMark = z.infer<typeof rehearsalMarkSchema>;
export type RehearsalCaseInfo = z.infer<typeof rehearsalCaseInfoSchema>;
export type RehearsalStatus = z.infer<typeof rehearsalStatusSchema>;
export type RehearsalStopReason = (typeof rehearsalStopReasonValues)[number];

export const idleRehearsalStatus: RehearsalStatus = {
  phase: "idle",
  themeId: null,
  themeName: null,
  startedAt: null,
  endedAt: null,
  stopReason: null,
  caseIndex: 0,
  autoPlay: false,
  cases: [],
  marks: {}
};

/** A real match is under way: rehearsal must not start, and a running one must stop. */
export function feedShowsRunningMatch(state: { sourceStatus: string; state: string }) {
  return state.sourceStatus === "ok" && (state.state === "RUNNING" || /^(TOWEL|BASE)[12]$/.test(state.state));
}

/** The plain-text report the operator copies at the end. */
export function rehearsalReport(status: RehearsalStatus, now = new Date()): string {
  const marks = status.cases.map((item) => status.marks[item.id]);
  const passed = marks.filter((mark) => mark?.result === "pass").length;
  const issues = status.cases.filter((item) => status.marks[item.id]?.result === "issue");
  const notRun = status.cases.length - passed - issues.length;
  const lines = [
    `Rehearsal · ${status.themeName ?? "Theme"} · ${now.toLocaleString()}`,
    `${passed} passed · ${issues.length} issue${issues.length === 1 ? "" : "s"}${notRun ? ` · ${notRun} not marked` : ""}`
  ];
  if (issues.length) {
    lines.push("", "Issues:");
    for (const item of issues) {
      const index = status.cases.indexOf(item) + 1;
      const note = status.marks[item.id]?.note.trim();
      lines.push(`${index}. ${item.group} · ${item.title}${note ? ` — ${note}` : ""}`, `   Expected: ${item.expectation}`);
    }
  }
  return lines.join("\n");
}
