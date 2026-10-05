import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { Button } from "./admin/kit";

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
 * Holds in-app navigation while a form has unsaved changes and asks whether to save, discard or stay. Closing or
 * reloading the tab gets the browser's own prompt. The router here cannot block Back, so Back still leaves.
 */
export function UnsavedChangesGuard({ dirty, saving, onSave, onDiscard }: { dirty: boolean; saving: boolean; onSave: () => Promise<boolean>; onDiscard: () => void }) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      const next = inAppDestination(event);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(next);
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
    if (destination && !dialog.open) dialog.showModal();
    if (!destination && dialog.open) dialog.close();
  }, [destination]);

  function leave() {
    const next = destination;
    setDestination(null);
    if (next) navigate(next);
  }

  return (
    <dialog ref={dialogRef} className="ad-scope ad-dialog" aria-labelledby="unsaved-title" onClose={() => setDestination(null)}>
      <div className="ad-dialog-head">
        <TriangleAlert aria-hidden />
        <h2 id="unsaved-title">Save your changes before leaving?</h2>
      </div>
      <p className="ad-hint">Your changes on this page are not saved yet. If you leave without saving, they are lost.</p>
      <div className="ad-dialog-actions">
        <Button variant="ghost" onClick={() => setDestination(null)}>
          Stay here
        </Button>
        <Button
          variant="danger"
          disabled={saving}
          onClick={() => {
            onDiscard();
            leave();
          }}
        >
          Discard and leave
        </Button>
        <Button
          variant="primary"
          disabled={saving}
          onClick={() => {
            void onSave().then((saved) => {
              if (saved) leave();
            });
          }}
        >
          {saving ? "Saving…" : "Save and leave"}
        </Button>
      </div>
    </dialog>
  );
}
