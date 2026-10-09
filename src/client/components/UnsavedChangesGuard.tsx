import { useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { Button } from "./admin/kit";

type LeaveGuardOptions = {
  dirty: boolean;
  saving: boolean;
  /** Saves the changes; resolves false when nothing was saved, so the page stays. */
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
};

/** The in-app destination of a plain left click on a link, or null when the click is not an in-app page change. */
function inAppDestination(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Holds leaving while there are unsaved changes and asks whether to save, discard or stay. It catches in-app links
 * by itself; a page routes its own ways out (closing a panel, a Back button) through `confirmLeave`. Closing or
 * reloading the tab gets the browser's own prompt. The router here cannot block Back, so Back still leaves.
 */
export function useLeaveGuard({ dirty, saving, onSave, onDiscard }: LeaveGuardOptions): {
  confirmLeave: (leave: () => void) => void;
  prompt: ReactElement;
} {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<{ leave: () => void } | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      const next = inAppDestination(event);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ leave: () => navigate(next) });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Capture phase, so the router's own link handler never sees the click.
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  function confirmLeave(leave: () => void) {
    if (dirty) setPending({ leave });
    else leave();
  }

  function proceed() {
    const next = pending;
    setPending(null);
    next?.leave();
  }

  const prompt = (
    <dialog ref={dialogRef} className="pba-scope pba-dialog" aria-labelledby="unsaved-title" onClose={() => setPending(null)}>
      <div className="pba-dialog-head">
        <TriangleAlert aria-hidden />
        <h2 id="unsaved-title">Save your changes before leaving?</h2>
      </div>
      <p className="pba-hint">Your changes here are not saved yet. If you leave without saving, they are lost.</p>
      <div className="pba-dialog-actions">
        <Button variant="ghost" onClick={() => setPending(null)}>
          Stay here
        </Button>
        <Button
          variant="danger"
          disabled={saving}
          onClick={() => {
            onDiscard();
            proceed();
          }}
        >
          Discard and leave
        </Button>
        <Button
          variant="primary"
          disabled={saving}
          onClick={() => {
            void onSave().then((saved) => {
              if (saved) proceed();
            });
          }}
        >
          {saving ? "Saving…" : "Save and leave"}
        </Button>
      </div>
    </dialog>
  );

  return { confirmLeave, prompt };
}

/** The leave guard for a page whose only ways out are links. */
export function UnsavedChangesGuard(options: LeaveGuardOptions) {
  return useLeaveGuard(options).prompt;
}
