import type { ThemeChange } from "../../../shared/themeDiff";

/**
 * A list of changes between two versions of a theme. Pieces are buttons that select the piece on the canvas.
 */
export function ChangeList({ changes, onSelectPiece }: { changes: ThemeChange[]; onSelectPiece?: (pieceId: string) => void }) {
  return (
    <ul className="te-changes">
      {changes.map((change) => (
        <li key={change.key} className={`te-change te-change--${change.kind}`}>
          {change.pieceId && onSelectPiece ? (
            <button type="button" className="te-change-subject te-text-btn" onClick={() => onSelectPiece(change.pieceId as string)}>
              {change.subject}
            </button>
          ) : (
            <span className="te-change-subject">{change.subject}</span>
          )}
          {change.details.length ? (
            <ul className="te-change-details">
              {change.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * What saving will change on the live overlay, shown before "Save to air" goes through, so nothing on air is a
 * surprise.
 */
export function ChangeReview({
  changes,
  warnings = [],
  busy,
  onSelectPiece,
  onConfirm,
  onCancel
}: {
  changes: ThemeChange[];
  /** Problems the theme has on air whether or not this save changes them. */
  warnings?: Array<{ pieceId: string; message: string }>;
  busy: boolean;
  onSelectPiece: (pieceId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="te-review" role="dialog" aria-label="Review before saving to air">
      <header className="te-review-head">
        <h2>Review before it goes on air</h2>
        <p>
          {changes.length === 0
            ? "Nothing differs from what's on air now."
            : `${changes.length} ${changes.length === 1 ? "thing changes" : "things change"} on the live overlay as soon as you save.`}
        </p>
      </header>
      {warnings.length ? (
        <ul className="te-review-warnings">
          {warnings.map((warning) => (
            <li key={warning.pieceId}>
              <button type="button" className="te-text-btn" onClick={() => onSelectPiece(warning.pieceId)}>
                {warning.message}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {changes.length ? (
        <div className="te-review-body">
          <ChangeList changes={changes} onSelectPiece={onSelectPiece} />
        </div>
      ) : null}
      <footer className="te-review-foot">
        <button type="button" className="te-btn" onClick={onCancel}>
          Keep editing
        </button>
        {changes.length ? (
          <button type="button" className="te-btn te-btn--primary" disabled={busy} onClick={onConfirm} autoFocus>
            <span className="te-tally te-tally--on-primary" aria-hidden />
            {busy ? "Saving…" : "Save to air"}
          </button>
        ) : null}
      </footer>
    </div>
  );
}
