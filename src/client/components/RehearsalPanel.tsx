import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, Copy, Play, Square, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { rehearsalReport, type RehearsalStatus } from "../../shared/rehearsal";
import { REHEARSAL_CASE_COUNT } from "../../shared/rehearsalCases";
import { showToast } from "../toast";
import { Button, Chip, Dot, Grow, Switch } from "./admin/kit";

const STOP_REASONS: Record<NonNullable<RehearsalStatus["stopReason"]>, string> = {
  operator: "Stopped.",
  finished: "All cases played.",
  "match-started": "Stopped: a match started. The real scoreboard is back on vMix.",
  idle: "Stopped after 10 minutes without activity.",
  "theme-changed": "Stopped: another theme was put on air."
};

/** Clipboard API where allowed; a hidden textarea on plain-http pages (vMix machines are reached by LAN address). */
async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/**
 * Runs the rehearsal on the live overlay: start, step through test cases while watching vMix, mark each one,
 * and copy a report. Replaces Checks on Operations while open.
 */
export function RehearsalPanel({
  status,
  themeName,
  blockedReason,
  onStatus,
  onClose
}: {
  status: RehearsalStatus | null;
  themeName: string | null;
  /** Why a rehearsal cannot start right now, if it cannot. */
  blockedReason: string | null;
  onStatus: (status: RehearsalStatus) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reportText, setReportText] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const phase = status?.phase ?? "idle";
  const current = status && phase === "running" ? status.cases[status.caseIndex] : null;

  const counts = useMemo(() => {
    const marks = Object.values(status?.marks ?? {});
    return { pass: marks.filter((mark) => mark.result === "pass").length, issue: marks.filter((mark) => mark.result === "issue").length };
  }, [status?.marks]);

  async function call(action: Parameters<typeof api.rehearsal>[0], body?: Record<string, unknown>) {
    setBusy(true);
    try {
      const next = await api.rehearsal(action, body);
      onStatus(next);
      return next;
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Rehearsal request failed." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start(autoPlay: boolean) {
    if (!window.confirm("Start rehearsal? vMix will show test data until you stop it.")) return;
    setReportText(null);
    await call("start", { autoPlay });
  }

  async function markAndNext(result: "pass" | "issue", text = "") {
    if (!current) return;
    setNoteOpen(false);
    setNote("");
    await call("mark", { caseId: current.id, result, note: text });
    await call("go", { to: "next" });
  }

  async function copyReport() {
    if (!status) return;
    const text = rehearsalReport(status);
    if (await copyText(text)) {
      showToast({ kind: "success", message: "Rehearsal report copied." });
    } else {
      setReportText(text);
    }
  }

  // Keep the current case in view inside the list, without moving the page.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>("[data-current='true']");
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - 40);
  }, [status?.caseIndex, phase]);

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  // Keys while running, so eyes can stay on vMix: P pass, I issue, arrows move.
  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || busy) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "p") void markAndNext("pass");
      else if (key === "i") setNoteOpen(true);
      else if (event.key === "ArrowRight") void call("go", { to: "next" });
      else if (event.key === "ArrowLeft") void call("go", { to: "prev" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (phase === "idle" || !status) {
    return (
      <section className="ad-surface ad-rh-panel" aria-labelledby="rehearsal-title">
        <div className="ad-section-head ad-ops-head">
          <h2 id="rehearsal-title" className="ad-title">
            Rehearsal
          </h2>
          {themeName ? (
            <Chip className="ad-strip-theme">
              <Dot tone="tally" flat />
              {themeName}
            </Chip>
          ) : null}
          <Grow />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back to checks
          </Button>
        </div>
        <div className="ad-rh-intro">
          {blockedReason ? <p className="ad-callout ad-callout--critical ad-rh-callout">{blockedReason}</p> : null}
          <p>
            Plays <b>{REHEARSAL_CASE_COUNT} test cases</b> through the real live overlay, the page vMix shows, so you can check this theme before doors open. Each case says what
            should appear, based on the theme's own settings.
          </p>
          <ul>
            <li>Names: short, long, a worst-case long name, an unknown team, a possible team</li>
            <li>Logos: with, without (fallback per slot), mixed</li>
            <li>Every event, timeout, game finished and winner, team switch, feed lost</li>
          </ul>
          <p className="ad-callout ad-callout--warning ad-rh-callout">
            vMix shows test data until you stop. It stops by itself if a match starts, after the last case in auto-play, or after 10 minutes without activity.
            Nothing is saved.
          </p>
          <div className="ad-actions">
            <Button className="ad-btn--rehearsal" disabled={busy || Boolean(blockedReason)} onClick={() => void start(false)}>
              <Play aria-hidden />
              Start rehearsal
            </Button>
            <Button disabled={busy || Boolean(blockedReason)} onClick={() => void start(true)}>
              Start in auto-play
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (phase === "ended") {
    const issues = status.cases.filter((item) => status.marks[item.id]?.result === "issue");
    const notMarked = status.cases.length - counts.pass - counts.issue;
    const critical = status.stopReason === "match-started" || status.stopReason === "theme-changed";
    return (
      <section className="ad-surface ad-rh-panel" aria-labelledby="rehearsal-title">
        <div className="ad-section-head ad-ops-head">
          <h2 id="rehearsal-title" className="ad-title">
            Rehearsal {status.stopReason === "finished" ? "finished" : "stopped"}
          </h2>
          {status.themeName ? (
            <Chip className="ad-strip-theme">
              <Dot tone="tally" flat />
              {status.themeName}
            </Chip>
          ) : null}
          <Grow />
          <Button variant="ghost" size="sm" onClick={() => void call("dismiss").then(onClose)}>
            Back to checks
          </Button>
        </div>
        <div className="ad-rh-summary">
          {status.stopReason && status.stopReason !== "finished" ? (
            <p className={`ad-callout ${critical ? "ad-callout--critical" : "ad-callout--warning"} ad-rh-callout`}>{STOP_REASONS[status.stopReason]}</p>
          ) : null}
          <p className="ad-rh-totals">
            <span className="is-pass">{counts.pass} passed</span> · <span className="is-issue">{counts.issue} {counts.issue === 1 ? "issue" : "issues"}</span>
            {notMarked ? <span className="ad-muted"> · {notMarked} not marked</span> : null}
          </p>
          {issues.length ? (
            <ul className="ad-rh-issues">
              {issues.map((item) => (
                <li key={item.id}>
                  <b>
                    {status.cases.indexOf(item) + 1}. {item.title}
                  </b>
                  <span>{status.marks[item.id]?.note || "No note"}</span>
                </li>
              ))}
            </ul>
          ) : counts.pass ? (
            <p className="ad-muted">No issues marked.</p>
          ) : null}
          {reportText ? (
            <textarea className="ad-input ad-rh-report" readOnly rows={8} value={reportText} onFocus={(event) => event.currentTarget.select()} aria-label="Rehearsal report" />
          ) : null}
          <div className="ad-actions">
            <Button variant="primary" onClick={() => void copyReport()}>
              <Copy aria-hidden />
              Copy report
            </Button>
            <Button disabled={busy || Boolean(blockedReason)} title={blockedReason ?? undefined} onClick={() => void start(false)}>
              Run again
            </Button>
          </div>
        </div>
      </section>
    );
  }

  let group = "";
  return (
    <section className="ad-surface ad-rh-panel" aria-labelledby="rehearsal-title">
      <div className="ad-section-head ad-ops-head">
        <h2 id="rehearsal-title" className="ad-title">
          Rehearsal
        </h2>
        <Chip tone="rehearsal">
          <Dot tone="rehearsal" flat />
          Case {status.caseIndex + 1} of {status.cases.length}
        </Chip>
        <span className="ad-hint">
          {counts.pass} ✓ · {counts.issue} ⚠
        </span>
        <Grow />
        <Button size="sm" disabled={busy} onClick={() => void call("stop")}>
          <Square aria-hidden />
          Stop
        </Button>
      </div>
      <div className="ad-rh-progress" aria-hidden>
        <i style={{ width: `${(status.caseIndex / status.cases.length) * 100}%` }} />
      </div>
      <div className="ad-rh-cases" ref={listRef} role="list" aria-label="Rehearsal cases">
        {status.cases.map((item, index) => {
          const header = item.group !== group ? item.group : null;
          group = item.group;
          const mark = status.marks[item.id];
          const isCurrent = index === status.caseIndex;
          return (
            <div key={item.id} role="listitem">
              {header ? <div className="ad-rh-group">{header}</div> : null}
              <button
                type="button"
                className={isCurrent ? "ad-rh-case is-current" : "ad-rh-case"}
                data-current={isCurrent ? "true" : undefined}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => void call("go", { to: item.id })}
              >
                <span className="ad-rh-n">{index + 1}</span>
                <span className="ad-rh-t">
                  {item.title}
                  {mark?.note ? <span className="ad-rh-note">{mark.note}</span> : null}
                </span>
                {isCurrent ? (
                  <span className="ad-rh-now">on vMix</span>
                ) : mark ? (
                  mark.result === "pass" ? (
                    <CircleCheck className="ad-rh-pass" aria-label="Passed" />
                  ) : (
                    <TriangleAlert className="ad-rh-issue" aria-label="Issue" />
                  )
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
      {current ? (
        <div className="ad-rh-expect">
          <div className="ad-rh-label">Now on vMix · {current.group}</div>
          <h3>
            {status.caseIndex + 1}. {current.title}
          </h3>
          <p>
            <b>Expect:</b> {current.expectation}
          </p>
          {current.source ? <p className="ad-hint">From: {current.source}</p> : null}
        </div>
      ) : null}
      <div className="ad-rh-controls">
        <Button size="sm" disabled={busy || status.caseIndex === 0} onClick={() => void call("go", { to: "prev" })} title="Back (←)">
          <ChevronLeft aria-hidden />
          Back
        </Button>
        <Button size="sm" className="ad-btn--pass" disabled={busy} onClick={() => void markAndNext("pass")} title="Pass and move on (P)">
          <CircleCheck aria-hidden />
          Pass
        </Button>
        <Button size="sm" className="ad-btn--issue" disabled={busy} onClick={() => setNoteOpen(true)} title="Mark an issue (I)">
          <TriangleAlert aria-hidden />
          Issue
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void call("go", { to: "next" })} title="Next (→)">
          {status.caseIndex === status.cases.length - 1 ? "Finish" : "Next"}
          <ChevronRight aria-hidden />
        </Button>
        <label className="ad-rh-auto">
          Auto-play every 6 s
          <Switch label="Auto-play" checked={status.autoPlay} onChange={(on) => void call("autoplay", { on })} />
        </label>
      </div>
      {noteOpen ? (
        <form
          className="ad-rh-noteform"
          onSubmit={(event) => {
            event.preventDefault();
            void markAndNext("issue", note.trim());
          }}
        >
          <input
            ref={noteRef}
            className="ad-input"
            placeholder="What's wrong? e.g. right name clips the score"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setNoteOpen(false);
            }}
            aria-label="Issue note"
          />
          <Button type="submit" size="sm" className="ad-btn--issue" disabled={busy}>
            Mark issue
          </Button>
        </form>
      ) : (
        <p className="ad-hint ad-rh-keys">Keys: P pass · I issue · ← → move</p>
      )}
    </section>
  );
}
