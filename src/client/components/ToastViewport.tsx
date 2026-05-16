import { useEffect, useState } from "react";
import { toastEventName, type ToastKind, type ToastPayload } from "../toast";

type ToastMessage = {
  id: string;
  message: string;
  kind: ToastKind;
  durationMs: number;
};

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<ToastPayload>;
      const detail = custom.detail;
      if (!detail?.message) {
        return;
      }

      const next: ToastMessage = {
        id: detail.id ?? `toast-${crypto.randomUUID()}`,
        message: detail.message,
        kind: detail.kind ?? "info",
        durationMs: detail.durationMs ?? 2600
      };

      setToasts((current) => [...current, next]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== next.id));
      }, next.durationMs);
    };

    window.addEventListener(toastEventName, onToast);
    return () => window.removeEventListener(toastEventName, onToast);
  }, []);

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
