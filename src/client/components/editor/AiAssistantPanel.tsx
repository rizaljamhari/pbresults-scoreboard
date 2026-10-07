import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ImagePlus, Sparkles, X } from "lucide-react";
import { api, ApiError } from "../../api";
import type { AiSettingsView, ThemeEditRequest } from "../../../shared/aiAssistant";
import { themeSchema, type ThemeDefinition } from "../../../shared/theme";
import { diffThemes, type ThemeChange } from "../../../shared/themeDiff";
import { applyThemeOps, type ThemeOp } from "../../../shared/themeOps";
import { ChangeList } from "./ChangeReview";

export type AiImage = NonNullable<ThemeEditRequest["reference"]>;

/**
 * One request in this editor session's thread. Kept by the page so it survives turning AI off, and so undo and redo
 * can keep "Applied" honest.
 */
export type AiTurn = {
  request: string;
  summary: string;
  ops: ThemeOp[];
  /** "answered": the AI replied without edits (a question, or "that can't be done"). */
  status: "pending" | "applied" | "discarded" | "undone" | "answered";
  usage: { inputTokens: number; outputTokens: number } | null;
  /** The editor's undo-history length right after this turn was applied, so undo and redo can find it. */
  appliedAt?: number;
};

/** The proposal waiting for Apply or Discard, checked against the draft as it is now. */
export type AiReview = { turn: AiTurn; next: ThemeDefinition; changes: ThemeChange[] } | { turn: AiTurn; error: string };

/** Edits made while waiting are taken into account: the proposal is re-applied to the current draft. */
export function useAiReview(theme: ThemeDefinition | null, thread: AiTurn[], pieceNameFor: (theme: ThemeDefinition) => (id: string, label: string) => string): AiReview | null {
  const pending = thread.length && thread[thread.length - 1].status === "pending" ? thread[thread.length - 1] : null;
  return useMemo(() => {
    if (!pending || !theme) return null;
    const stale = { turn: pending, error: "The theme changed since you asked, and this change no longer fits." };
    try {
      const parsed = themeSchema.safeParse(applyThemeOps(theme, pending.ops));
      if (!parsed.success) return stale;
      return { turn: pending, next: parsed.data, changes: diffThemes(theme, parsed.data, pieceNameFor(parsed.data)) };
    } catch {
      return stale;
    }
  }, [pending, theme, pieceNameFor]);
}

/** Heights of the dock, open and collapsed; the page keeps the canvas and side panels clear of it. */
export const AI_DOCK_HEIGHT = { open: 264, collapsed: 46 } as const;

const REFERENCE_MAX_SIDE = 1280;
/** Failures that are fixed in Maintenance → AI assistant rather than by trying again. */
const SETTINGS_FAILURES = new Set(["not-configured", "bad-key", "model-not-found", "signed-out", "not-eligible"]);

/** Downscales an attached image so requests stay small; JPEG unless the image needs transparency kept. */
async function readReferenceImage(file: File): Promise<AiImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, REFERENCE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = file.type === "image/png";
  const dataUrl = canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.85);
  return { mediaType: png ? "image/png" : "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

type Failure = { message: string; kind: string | null };

function failureFrom(error: unknown): Failure {
  if (error instanceof ApiError) return { message: error.message, kind: (error.payload as { kind?: string } | null)?.kind ?? null };
  if (error instanceof TypeError) return { message: "Couldn't reach the scoreboard server. Check it's still running.", kind: null };
  return { message: error instanceof Error ? error.message : "The AI request failed.", kind: null };
}

const STATUS_TAGS: Partial<Record<AiTurn["status"], { label: string; tone: "ok" | "quiet" }>> = {
  applied: { label: "Applied", tone: "ok" },
  discarded: { label: "Discarded", tone: "quiet" },
  undone: { label: "Undone", tone: "quiet" }
};

function changeCount(count: number) {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

/**
 * The AI assistant, docked full-width under the canvas while AI is on. It collapses to one line that keeps Discard
 * and Apply for a waiting proposal. It stays mounted while AI is off (just hidden), so a request in flight still
 * lands and a waiting proposal is kept.
 */
export function AiAssistantDock({
  visible,
  open,
  onOpenChange,
  theme,
  focusPieceId,
  focusPieceName,
  thread,
  setThread,
  review,
  capturePreview,
  onApply,
  onDiscard,
  onSelectPiece
}: {
  visible: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemeDefinition;
  focusPieceId: string | null;
  focusPieceName: string | null;
  thread: AiTurn[];
  setThread: (update: (current: AiTurn[]) => AiTurn[]) => void;
  review: AiReview | null;
  capturePreview: () => Promise<AiImage | null>;
  onApply: () => void;
  onDiscard: () => void;
  onSelectPiece: (pieceId: string) => void;
}) {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [request, setRequest] = useState("");
  const [reference, setReference] = useState<{ image: AiImage; name: string } | null>(null);
  const [includePreview, setIncludePreview] = useState(true);
  const [onlySelected, setOnlySelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingShown = useRef<AiTurn | null>(null);

  // Settings are read when AI is turned on, so a provider set up meanwhile shows without a reload.
  useEffect(() => {
    if (visible) api.getAiSettings().then(setSettings, () => setSettings(null));
  }, [visible]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Turning AI on opens on the request box, ready to type.
  useEffect(() => {
    if (visible && open && !review) textareaRef.current?.focus();
  }, [visible]);

  // A new proposal takes focus and is announced; settling it hands focus back to the request box.
  const pendingTurn = review?.turn ?? null;
  useEffect(() => {
    if (pendingTurn && pendingShown.current !== pendingTurn) {
      pendingShown.current = pendingTurn;
      if (visible && open) reviewRef.current?.focus();
    }
    if (!pendingTurn && pendingShown.current) {
      pendingShown.current = null;
      if (visible && open) textareaRef.current?.focus();
    }
  }, [pendingTurn, visible, open]);

  useEffect(() => {
    if (!review) return;
    setAnnouncement("error" in review ? "The proposed change no longer fits the theme." : `Proposed ${changeCount(review.changes.length)}, previewing on the canvas.`);
  }, [review]);

  const latest = thread.length ? thread[thread.length - 1] : null;
  useEffect(() => {
    if (latest?.status === "applied") setAnnouncement("Applied to your draft. Command Z undoes it.");
    if (latest?.status === "discarded") setAnnouncement("Discarded. Your draft is unchanged.");
    if (latest?.status === "answered") setAnnouncement(`The AI answered without changes: ${latest.summary}`);
  }, [latest]);

  const active = settings?.providers.find((provider) => provider.id === settings.activeProvider) ?? null;

  async function send(text: string) {
    if (!text || busy) return;
    setBusy(true);
    setFailure(null);
    setLastSent(text);
    setAnnouncement("Asking the AI. This can take up to a minute.");
    const controller = new AbortController();
    abortRef.current = controller;
    // The Ask button turns into Cancel; keep focus on it instead of dropping to the page.
    requestAnimationFrame(() => cancelRef.current?.focus());
    try {
      const preview = includePreview ? await capturePreview().catch(() => null) : null;
      const answer = await api.requestThemeEdit(
        {
          draft: theme as unknown as Record<string, unknown>,
          request: text,
          history: thread
            .filter((turn) => turn.status !== "pending")
            .map(({ request: asked, summary, ops, status }) => ({ request: asked, summary, ops, kept: status === "applied" || status === "answered" })),
          reference: reference?.image,
          preview: preview ?? undefined,
          focusPieceId: onlySelected && focusPieceId ? focusPieceId : undefined
        },
        controller.signal
      );
      setThread((current) => [...current, { request: text, summary: answer.summary, ops: answer.ops, status: answer.ops.length ? "pending" : "answered", usage: answer.usage }]);
      setRequest("");
      setReference(null);
    } catch (error) {
      if (controller.signal.aborted) {
        setAnnouncement("Cancelled.");
      } else {
        setFailure(failureFrom(error));
        setAnnouncement("");
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function askAgain() {
    const text = review?.turn.request;
    onDiscard();
    if (text) void send(text);
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setFailure({ message: "Use a PNG, JPEG or WebP image as the reference.", kind: null });
      return;
    }
    try {
      setReference({ image: await readReferenceImage(file), name: file.name });
    } catch {
      setFailure({ message: "That image couldn't be read. Try a PNG or JPEG.", kind: null });
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) void attach(event.dataTransfer.files[0]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Keys typed here never reach the editor's shortcuts; Escape folds the dock instead of clearing the selection.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      textareaRef.current?.blur();
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowUp" && !request && thread.length) {
      // Bring back the last request to edit and ask again.
      event.preventDefault();
      setRequest(thread[thread.length - 1].request);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(request.trim());
    }
  }

  const settled = thread.filter((turn) => turn.status !== "pending");
  const usage = latest?.usage ?? null;
  const showTokens = Boolean(usage) && active?.id !== "chatgpt";
  const proposal = review && "changes" in review ? review : null;
  const notSetUp = settings !== null && !active;

  return (
    <section className="te-island te-ai-dock" data-open={open} hidden={!visible} aria-label="AI assistant" onContextMenu={(event) => event.stopPropagation()}>
      <p className="te-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <header className="te-ai-dock-head">
        <h2 className="te-ai-dock-title">
          <Sparkles aria-hidden /> AI assistant
        </h2>
        {active ? (
          <span className="te-ai-meta">
            {active.id === "chatgpt" ? "Using ChatGPT plan" : `Using ${active.label}`}
            {active.model ? ` · ${active.model}` : ""}
            {showTokens && usage ? ` · last request ${(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens` : ""}
          </span>
        ) : null}
        <span className="te-ai-dock-spacer" />
        {busy && !open ? (
          <span className="te-ai-preview-note">
            <span className="te-ai-spinner" aria-hidden /> Waiting for the AI
          </span>
        ) : null}
        {proposal ? (
          <span className="te-ai-preview-note">
            <span className="te-ai-preview-dot" aria-hidden />
            Previewing {changeCount(proposal.changes.length)}
          </span>
        ) : null}
        {review && !open ? (
          <span className="te-ai-actions">
            <button type="button" className="te-btn" onClick={onDiscard}>
              Discard
            </button>
            {proposal ? (
              <button type="button" className="te-btn te-btn--primary" onClick={onApply}>
                Apply
              </button>
            ) : null}
          </span>
        ) : null}
        <button type="button" className="te-btn te-btn--quiet" aria-expanded={open} onClick={() => onOpenChange(!open)}>
          {open ? "Collapse" : "Expand"}
        </button>
      </header>

      <div className="te-ai-dock-body">
        <section className="te-ai-history" aria-label="Earlier requests">
          <h3 className="te-field-label">Earlier requests</h3>
          {settled.length ? (
            <ol className="te-ai-thread">
              {settled.map((turn, index) => {
                const tag = STATUS_TAGS[turn.status];
                return (
                  <li key={index}>
                    <details className={`te-ai-turn te-ai-turn--${turn.status}`} open={turn.status === "answered" && index === settled.length - 1}>
                      <summary>
                        <span className="te-ai-request">{turn.request}</span>
                        {tag ? <span className={`te-ai-tag te-ai-tag--${tag.tone}`}>{tag.label}</span> : null}
                      </summary>
                      <p className="te-ai-summary">{turn.summary}</p>
                    </details>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="te-ai-empty">
              Your requests show here. Ask for one change at a time, like "use Oswald for every name and score". You see it on the canvas before anything is
              applied.
            </p>
          )}
        </section>

        <div className="te-ai-main">
          {notSetUp ? (
            <p className="te-note">
              The AI assistant isn't set up yet. Choose a provider in <Link to="/admin/maintenance#set-ai">Maintenance → AI assistant</Link>. Signing in with
              ChatGPT, Google Gemini's free tier and OpenRouter's free models cost nothing extra, and Ollama runs free on this computer.
            </p>
          ) : review ? (
            <section ref={reviewRef} className="te-ai-review" aria-label="Proposed change" tabIndex={-1}>
              <header className="te-ai-review-head">
                <p className="te-ai-request">{review.turn.request}</p>
                <p className="te-ai-summary">{review.turn.summary}</p>
              </header>
              <div className="te-ai-review-changes">
                {"error" in review ? (
                  <div className="te-callout te-callout--action">
                    <span>{review.error}</span>
                    <button type="button" className="te-mini-btn" onClick={askAgain}>
                      Ask again
                    </button>
                  </div>
                ) : review.changes.length ? (
                  <div className="te-review-body">
                    <ChangeList changes={review.changes} onSelectPiece={onSelectPiece} />
                  </div>
                ) : (
                  <p className="te-note">These edits don't change anything visible.</p>
                )}
              </div>
              <div className="te-ai-actions te-ai-review-actions">
                <button type="button" className="te-btn" onClick={onDiscard}>
                  Discard
                </button>
                {proposal ? (
                  <button type="button" className="te-btn te-btn--primary" onClick={onApply}>
                    Apply
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <div className="te-ai-composer">
              <div className="te-ai-ask">
                <label className="te-field-label" htmlFor="te-ai-request">
                  {latest?.status === "applied" ? (
                    <span className="te-ai-aftercare">Applied to your draft, not on air until you save. ⌘Z undoes it.</span>
                  ) : settled.length ? (
                    "What next?"
                  ) : (
                    "What should change?"
                  )}
                </label>
                {failure ? (
                  <div className="te-callout te-callout--crit te-callout--action" role="alert">
                    <span>{failure.message}</span>
                    {failure.kind && SETTINGS_FAILURES.has(failure.kind) ? (
                      <Link className="te-mini-btn" to="/admin/maintenance#set-ai">
                        Open AI settings
                      </Link>
                    ) : lastSent ? (
                      <button type="button" className="te-mini-btn" onClick={() => void send(lastSent)}>
                        Try again
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <textarea
                  ref={textareaRef}
                  id="te-ai-request"
                  className="te-input te-textarea te-ai-input"
                  maxLength={4000}
                  placeholder="Enter to ask · Shift+Enter for a new line"
                  value={request}
                  readOnly={busy}
                  aria-describedby="te-ai-request-hint"
                  onChange={(event) => setRequest(event.target.value)}
                  onKeyDown={onKeyDown}
                />
                <span id="te-ai-request-hint" className="te-sr-only">
                  Press up arrow in an empty box to bring back your last request. Escape collapses the assistant.
                </span>
                <div className="te-ai-ask-row">
                  <div className="te-ai-options">
                    <label className="te-ai-option">
                      <input type="checkbox" checked={includePreview} onChange={(event) => setIncludePreview(event.target.checked)} disabled={busy} />
                      <span>
                        Let the AI see the canvas
                        <small>Sends a picture of the frame with your request.</small>
                      </span>
                    </label>
                    {focusPieceId && focusPieceName ? (
                      <label className="te-ai-option">
                        <input type="checkbox" checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)} disabled={busy} />
                        <span>Only change {focusPieceName}</span>
                      </label>
                    ) : null}
                  </div>
                  {busy ? (
                    <button ref={cancelRef} type="button" className="te-btn" onClick={() => abortRef.current?.abort()}>
                      <span className="te-ai-spinner" aria-hidden /> Cancel
                    </button>
                  ) : (
                    <button type="button" className="te-btn te-btn--primary" onClick={() => void send(request.trim())} disabled={!request.trim()}>
                      <Sparkles aria-hidden /> Ask
                    </button>
                  )}
                </div>
              </div>

              <div
                className="te-ai-drop"
                data-dragging={dragging}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void attach(file);
                  }}
                />
                {reference ? (
                  <>
                    <img src={`data:${reference.image.mediaType};base64,${reference.image.data}`} alt={`Reference: ${reference.name}`} />
                    <span className="te-ai-drop-name">
                      <span>{reference.name}</span>
                      <button type="button" className="te-icon-btn" aria-label={`Remove ${reference.name}`} onClick={() => setReference(null)} disabled={busy}>
                        <X />
                      </button>
                    </span>
                  </>
                ) : (
                  <button type="button" className="te-ai-drop-pick" onClick={() => fileRef.current?.click()} disabled={busy}>
                    <ImagePlus aria-hidden />
                    <b>Reference image</b>
                    <span>Drop a poster or another broadcast's scorebug, or choose a file</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {busy && open ? <p className="te-ai-meta">Waiting for the AI. This can take up to a minute.</p> : null}
        </div>
      </div>
    </section>
  );
}
