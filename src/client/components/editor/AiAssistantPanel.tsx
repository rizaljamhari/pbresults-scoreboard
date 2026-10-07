import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ImagePlus, Sparkles, X } from "lucide-react";
import { api, ApiError } from "../../api";
import type { AiSettingsView, ThemeEditRequest } from "../../../shared/aiAssistant";
import { themeSchema, type ThemeDefinition } from "../../../shared/theme";
import { diffThemes } from "../../../shared/themeDiff";
import { applyThemeOps, type ThemeOp } from "../../../shared/themeOps";
import { ChangeList } from "./ChangeReview";

export type AiImage = NonNullable<ThemeEditRequest["reference"]>;

/** One request in this editor session's thread. Kept by the page so closing the panel doesn't lose it. */
export type AiTurn = {
  request: string;
  summary: string;
  ops: ThemeOp[];
  status: "pending" | "applied" | "discarded";
  usage: { inputTokens: number; outputTokens: number } | null;
};

const REFERENCE_MAX_SIDE = 1280;

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

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Couldn't reach the scoreboard server.";
  return error instanceof Error ? error.message : "The AI request failed.";
}

function formatTokens(usage: AiTurn["usage"]): string | null {
  if (!usage) return null;
  const total = usage.inputTokens + usage.outputTokens;
  return `Last request: ${total.toLocaleString()} tokens (${usage.inputTokens.toLocaleString()} in, ${usage.outputTokens.toLocaleString()} out)`;
}

export function AiAssistantPanel({
  theme,
  focusPieceId,
  focusPieceName,
  thread,
  setThread,
  pieceNameFor,
  capturePreview,
  onApply,
  onSelectPiece
}: {
  theme: ThemeDefinition;
  focusPieceId: string | null;
  focusPieceName: string | null;
  thread: AiTurn[];
  setThread: (update: (current: AiTurn[]) => AiTurn[]) => void;
  pieceNameFor: (theme: ThemeDefinition) => (id: string, label: string) => string;
  capturePreview: () => Promise<AiImage | null>;
  onApply: (next: ThemeDefinition) => void;
  onSelectPiece: (pieceId: string) => void;
}) {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [request, setRequest] = useState("");
  const [reference, setReference] = useState<{ image: AiImage; name: string } | null>(null);
  const [includePreview, setIncludePreview] = useState(true);
  const [onlySelected, setOnlySelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getAiSettings().then(setSettings, () => setSettings(null));
    return () => abortRef.current?.abort();
  }, []);

  const pending = thread.length && thread[thread.length - 1].status === "pending" ? thread[thread.length - 1] : null;

  // Checked against the draft as it is now, so edits made while waiting are taken into account.
  const review = useMemo(() => {
    if (!pending || pending.ops.length === 0) return null;
    try {
      const parsed = themeSchema.safeParse(applyThemeOps(theme, pending.ops));
      if (!parsed.success) return { error: "The theme changed since you asked, and this change no longer fits. Ask again." } as const;
      return { next: parsed.data, changes: diffThemes(theme, parsed.data, pieceNameFor(parsed.data)) } as const;
    } catch {
      return { error: "The theme changed since you asked, and this change no longer fits. Ask again." } as const;
    }
  }, [pending, theme, pieceNameFor]);

  const active = settings?.providers.find((provider) => provider.id === settings.activeProvider) ?? null;

  async function send() {
    const text = request.trim();
    if (!text || busy || pending) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const preview = includePreview ? await capturePreview().catch(() => null) : null;
      const answer = await api.requestThemeEdit(
        {
          draft: theme as unknown as Record<string, unknown>,
          request: text,
          history: thread.filter((turn) => turn.status !== "pending").map(({ request: asked, summary, ops }) => ({ request: asked, summary, ops })),
          reference: reference?.image,
          preview: preview ?? undefined,
          focusPieceId: onlySelected && focusPieceId ? focusPieceId : undefined
        },
        controller.signal
      );
      setThread((current) => [...current, { request: text, summary: answer.summary, ops: answer.ops, status: answer.ops.length ? "pending" : "discarded", usage: answer.usage }]);
      setRequest("");
      setReference(null);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failureMessage(failure));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function settle(status: "applied" | "discarded") {
    setThread((current) => current.map((turn, index) => (index === current.length - 1 ? { ...turn, status } : turn)));
  }

  function apply() {
    if (!review || "error" in review) return;
    onApply(review.next);
    settle("applied");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line. Keys typed here never reach the editor's shortcuts.
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  if (settings && !active) {
    return (
      <div className="te-subview-body">
        <p className="te-note">
          The AI assistant isn't set up yet. Choose a provider and add its key in <Link to="/admin/maintenance#set-ai">Maintenance → AI assistant</Link>. Google
          Gemini and OpenRouter have free options, and Ollama runs free on this computer.
        </p>
      </div>
    );
  }

  const lastUsage = formatTokens(thread.length ? thread[thread.length - 1].usage : null);

  return (
    <div className="te-subview-body te-ai">
      {thread.length ? (
        <ol className="te-ai-thread" aria-label="Requests so far">
          {thread.map((turn, index) => (
            <li key={index} className={`te-ai-turn te-ai-turn--${turn.status}`}>
              <p className="te-ai-request">{turn.request}</p>
              <p className="te-ai-summary">{turn.summary}</p>
              {turn.status === "applied" ? <span className="te-chip te-chip--quiet">Applied</span> : null}
              {turn.status === "discarded" && turn.ops.length ? <span className="te-chip te-chip--quiet">Discarded</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="te-note">
          Describe a change to this theme, like "use Oswald for every name and score" or "match the colours in this poster". You'll see what changes before
          anything is applied, and ⌘Z undoes it.
        </p>
      )}

      {pending && review ? (
        <div className="te-ai-review" role="region" aria-label="Proposed change">
          {"error" in review ? (
            <p className="te-callout">{review.error}</p>
          ) : review.changes.length ? (
            <div className="te-review-body">
              <ChangeList changes={review.changes} onSelectPiece={onSelectPiece} />
            </div>
          ) : (
            <p className="te-note">These edits don't change anything visible in the theme.</p>
          )}
          <div className="te-ai-actions">
            <button type="button" className="te-btn" onClick={() => settle("discarded")}>
              Discard
            </button>
            <button type="button" className="te-btn te-btn--primary" onClick={apply} disabled={"error" in review}>
              Apply
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="te-callout">{error}</p> : null}

      <div className="te-field">
        <label className="te-field-label" htmlFor="te-ai-request">
          {thread.length ? "What next?" : "What should change?"}
        </label>
        <textarea
          id="te-ai-request"
          className="te-input te-textarea"
          rows={3}
          maxLength={4000}
          placeholder={pending ? "Apply or discard the change above first" : "Describe the change"}
          value={request}
          disabled={busy || Boolean(pending)}
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      {reference ? (
        <div className="te-ai-attachment">
          <img src={`data:${reference.image.mediaType};base64,${reference.image.data}`} alt="" />
          <span>{reference.name}</span>
          <button type="button" className="te-icon-btn" aria-label="Remove the image" onClick={() => setReference(null)} disabled={busy}>
            <X />
          </button>
        </div>
      ) : null}

      <label className="te-ai-option">
        <input type="checkbox" checked={includePreview} onChange={(event) => setIncludePreview(event.target.checked)} disabled={busy} />
        Let the AI see the canvas
      </label>
      {focusPieceId && focusPieceName ? (
        <label className="te-ai-option">
          <input type="checkbox" checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)} disabled={busy} />
          Only change {focusPieceName}
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
              setError("That image couldn't be read. Try a PNG or JPEG.");
            }
          }}
        />
        <button type="button" className="te-btn" onClick={() => fileRef.current?.click()} disabled={busy || Boolean(pending)}>
          <ImagePlus aria-hidden /> {reference ? "Change image" : "Attach image"}
        </button>
        {busy ? (
          <button type="button" className="te-btn" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        ) : (
          <button type="button" className="te-btn te-btn--primary" onClick={() => void send()} disabled={!request.trim() || Boolean(pending)}>
            <Sparkles aria-hidden /> Ask
          </button>
        )}
      </div>

      <p className="te-field-hint">
        {busy ? "Waiting for the AI… this can take up to a minute." : active ? `Using ${active.label}${active.model ? ` · ${active.model}` : ""}.` : ""}
        {!busy && lastUsage ? ` ${lastUsage}.` : ""}
      </p>
    </div>
  );
}
