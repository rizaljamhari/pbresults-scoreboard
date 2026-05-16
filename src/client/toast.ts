export type ToastKind = "success" | "error" | "info";

export type ToastPayload = {
  id?: string;
  message: string;
  kind?: ToastKind;
  durationMs?: number;
};

export const toastEventName = "pbresults:toast";

export function showToast(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent<ToastPayload>(toastEventName, { detail: payload }));
}
