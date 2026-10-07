import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
 * One request in this editor session's thread. Kept by the page so closing the panel doesn't lose it, and so undo
 * and redo can keep "Applied" honest.
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

const REFERENCE_MAX_SIDE = 1280;
const TEXTAREA_MAX_ROWS = 6;
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

export function AiAssistantPanel({
  theme,
  focusPieceId,
  focusPieceName,
  thread,
  setThread,
  review,
  capturePreview,
  onApply,
  onDiscard,
  onClose,
  onSelectPiece
}: {
  theme: ThemeDefinition;
  focusPieceId: string | null;
  focusPieceName: string | null;
  thread: AiTurn[];
  setThread: (update: (current: AiTurn[]) => AiTurn[]) => void;
  review: AiReview | null;
  capturePreview: () => Promise<AiImage | null>;
  onApply: () => void;
  onDiscard: () => void;
  onClose: () => void;
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
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingShown = useRef<AiTurn | null>(null);

  useEffect(() => {
    api.getAiSettings().then(setSettings, () => setSettings(null));
    return () => abortRef.current?.abort();
  }, []);

  // Grow the request box with its text, up to six lines, so a long request is readable without scrolling.
  useLayoutEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    const line = parseFloat(getComputedStyle(box).lineHeight) || 18;
    const chrome = box.offsetHeight - box.clientHeight + parseFloat(getComputedStyle(box).paddingTop) + parseFloat(getComputedStyle(box).paddingBottom);
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, line * TEXTAREA_MAX_ROWS + chrome)}px`;
  }, [request, review]);

  // A new proposal takes focus and is announced; settling it hands focus back to the request box.
  const pendingTurn = review?.turn ?? null;
  useEffect(() => {
    if (pendingTurn && pendingShown.current !== pendingTurn) {
      pendingShown.current = pendingTurn;
      reviewRef.current?.scrollIntoView({ block: "nearest" });
      reviewRef.current?.focus();
    }
    if (!pendingTurn && pendingShown.current) {
      pendingShown.current = null;
      textareaRef.current?.focus();
    }
  }, [pendingTurn]);

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
        const next = failureFrom(error);
        setFailure(next);
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

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Keys typed here never reach the editor's shortcuts; Escape closes the panel instead of clearing the selection.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
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

  if (settings && !active) {
    return (
      <div className="te-subview-body">
        <p className="te-note">
          The AI assistant isn't set up yet. Choose a provider in <Link to="/admin/maintenance#set-ai">Maintenance → AI assistant</Link>. Signing in with ChatGPT,
          Google Gemini's free tier and OpenRouter's free models cost nothing extra, and Ollama runs free on this computer.
        </p>
      </div>
    );
  }

  const settled = thread.filter((turn) => turn.status !== "pending");
  const usage = latest?.usage ?? null;
  const showTokens = Boolean(usage) && active?.id !== "chatgpt";

  return (
    <div className="te-subview-body te-ai">
      <p className="te-ai-sr" role="status" aria-live="polite">
        {announcement}
      </p>

      {settled.length === 0 && !review ? (
        <p className="te-note">
          Describe a change, like "use Oswald for every name and score" or "match the colours in this poster". The AI edits this theme's settings: colours,
          fonts, sizes, positions and layers. You see the result on the canvas before anything is applied.
        </p>
      ) : null}

      {settled.length ? (
        <ol className="te-ai-thread" aria-label="Earlier requests">
          {settled.map((turn, index) => {
            const tag = STATUS_TAGS[turn.status];
            // The newest answer stays open so its reply is read; older ones fold to one line.
            const isLatest = index === settled.length - 1 && !review;
            return (
              <li key={index}>
                <details className={`te-ai-turn te-ai-turn--${turn.status}`} open={isLatest}>
                  <summary>
                    <span className="te-ai-request">{turn.request}</span>
                    {tag ? <span className={`te-ai-tag te-ai-tag--${tag.tone}`}>{tag.label}</span> : null}
                  </summary>
                  <p className="te-ai-summary">{turn.summary}</p>
                  {isLatest && turn.status === "applied" ? <p className="te-ai-aftercare">In your draft, not on air until you save. ⌘Z undoes it.</p> : null}
                </details>
              </li>
            );
          })}
        </ol>
      ) : null}

      {review ? (
        <section ref={reviewRef} className="te-ai-review" aria-label="Proposed change" tabIndex={-1}>
          <header className="te-ai-review-head">
            <p className="te-ai-request">{review.turn.request}</p>
            <p className="te-ai-summary">{review.turn.summary}</p>
          </header>
          {"error" in review ? (
            <div className="te-callout te-callout--action">
              <span>{review.error}</span>
              <button type="button" className="te-mini-btn" onClick={askAgain}>
                Ask again
              </button>
            </div>
          ) : review.changes.length ? (
            <>
              <p className="te-ai-preview-note">
                <span className="te-ai-preview-dot" aria-hidden />
                Previewing {changeCount(review.changes.length)} on the canvas
              </p>
              <div className="te-review-body">
                <ChangeList changes={review.changes} onSelectPiece={onSelectPiece} />
              </div>
            </>
          ) : (
            <p className="te-note">These edits don't change anything visible.</p>
          )}
          <div className="te-ai-actions">
            <button type="button" className="te-btn" onClick={onDiscard}>
              Discard
            </button>
            {"error" in review ? null : (
              <button type="button" className="te-btn te-btn--primary" onClick={onApply}>
                Apply
              </button>
            )}
          </div>
        </section>
      ) : null}

      {failure ? (
        <div className="te-callout te-callout--crit" role="alert">
          <p>{failure.message}</p>
          <div className="te-ai-actions te-ai-actions--start">
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
        </div>
      ) : null}

      {review ? null : (
        <div className="te-ai-composer">
          <div className="te-field">
            <label className="te-field-label" htmlFor="te-ai-request">
              {settled.length ? "What next?" : "What should change?"}
            </label>
            <textarea
              ref={textareaRef}
              id="te-ai-request"
              className="te-input te-textarea te-ai-input"
              rows={2}
              maxLength={4000}
              placeholder="Enter to ask · Shift+Enter for a new line"
              value={request}
              readOnly={busy}
              aria-describedby="te-ai-request-hint"
              onChange={(event) => setRequest(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <span id="te-ai-request-hint" className="te-ai-sr">
              Press up arrow in an empty box to bring back your last request. Escape closes the assistant.
            </span>
          </div>

          {reference ? (
            <div className="te-ai-attachment">
              <img src={`data:${reference.image.mediaType};base64,${reference.image.data}`} alt="" />
              <span>{reference.name}</span>
              <button type="button" className="te-icon-btn" aria-label={`Remove ${reference.name}`} onClick={() => setReference(null)} disabled={busy}>
                <X />
              </button>
            </div>
          ) : null}

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

          <div className="te-ai-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                try {
                  setReference({ image: await readReferenceImage(file), name: file.name });
                } catch {
                  setFailure({ message: "That image couldn't be read. Try a PNG or JPEG.", kind: null });
                }
              }}
            />
            <button type="button" className="te-btn te-btn--quiet" onClick={() => fileRef.current?.click()} disabled={busy}>
              <ImagePlus aria-hidden /> {reference ? "Change image" : "Image"}
            </button>
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
      )}

      <div className="te-ai-meta">
        {busy ? <p>Waiting for the AI. This can take up to a minute.</p> : null}
        {active ? <p>{active.id === "chatgpt" ? "Using ChatGPT plan" : `Using ${active.label}`}{active.model ? ` · ${active.model}` : ""}</p> : null}
        {showTokens && usage ? <p>Last request: {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens</p> : null}
      </div>
    </div>
  );
}
