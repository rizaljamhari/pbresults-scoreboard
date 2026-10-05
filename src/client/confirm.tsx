import { useEffect, useRef, useSyncExternalStore } from "react";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { Button } from "./components/admin/kit";

export type ConfirmRequest = {
  /** The question, e.g. "Delete “Final”?" */
  title: string;
  /** What happens if they go ahead. */
  message?: string;
  /** Names the action, e.g. "Delete" or "Put on air"; never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for anything destructive or disruptive to the broadcast. */
  tone?: "danger" | "default";
};

type Pending = ConfirmRequest & { resolve: (confirmed: boolean) => void };

let queue: Pending[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Asks the admin to confirm an action in the app's own prompt and resolves true only when they choose the action.
 * Requests made while one is open wait their turn.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, resolve }];
    emit();
  });
}

function settle(confirmed: boolean) {
  const [current, ...rest] = queue;
  if (!current) return;
  queue = rest;
  emit();
  current.resolve(confirmed);
}

/** True while any modal prompt is open, so page shortcuts can stand down behind it. */
export function modalPromptOpen(): boolean {
  return Boolean(document.querySelector("dialog[open]"));
}

/** Mounted once in the admin shell; shows confirmAction requests one at a time. */
export function ConfirmHost() {
  const current = useSyncExternalStore(subscribe, () => queue[0] ?? null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current && !dialog.open) dialog.showModal();
    if (!current && dialog.open) dialog.close();
  }, [current]);

  // A page that unmounts mid-question (the shell going away) must not leave the caller waiting forever.
  useEffect(
    () => () => {
      while (queue.length) settle(false);
    },
    []
  );

  const danger = current?.tone === "danger";
  return (
    <dialog
      ref={dialogRef}
      className="ad-scope ad-dialog"
      aria-labelledby="confirm-title"
      aria-describedby={current?.message ? "confirm-message" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
    >
      {current ? (
        <>
          <div className={danger ? "ad-dialog-head is-danger" : "ad-dialog-head is-question"}>
            {danger ? <TriangleAlert aria-hidden /> : <CircleHelp aria-hidden />}
            <h2 id="confirm-title">{current.title}</h2>
          </div>
          {current.message ? (
            <p id="confirm-message" className="ad-hint ad-dialog-message">
              {current.message}
            </p>
          ) : null}
          <div className="ad-dialog-actions">
            <Button variant="ghost" onClick={() => settle(false)}>
              {current.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={danger ? "danger" : "primary"} onClick={() => settle(true)}>
              {current.confirmLabel}
            </Button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
