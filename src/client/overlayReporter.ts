import { useEffect, useRef } from "react";
import { api } from "./api";
import { useAppEvents } from "./appEvents";
import { overlayClientId } from "./overlayClient";
import { OVERLAY_REPORT_INTERVAL_MS, type OverlayReport } from "../shared/overlayHealth";
import type { NormalizedLiveState, ThemeDefinition } from "../shared/theme";

const MIN_GAP_MS = 1_000;

/**
 * Tells the server what this overlay page renders, every few seconds and as soon as the theme or live data
 * changes, so Operations can tell whether the overlay vMix shows is alive and current. Reporting is fire and
 * forget: nothing here can change or delay what the page draws.
 */
export function useOverlayReporter(page: "live" | "preview", theme: ThemeDefinition | null, live: NormalizedLiveState | null) {
  const appEvents = useAppEvents();
  const appVersionRef = useRef<string | null>(null);
  const latestRef = useRef<() => OverlayReport | null>(() => null);
  const lastSentRef = useRef(0);
  const pendingRef = useRef<number | undefined>(undefined);

  latestRef.current = () => {
    if (!appVersionRef.current) return null;
    return {
      clientId: overlayClientId(),
      page,
      themeId: theme?.id ?? null,
      themeUpdatedAt: theme?.updatedAt ?? null,
      liveFetchedAt: live?.fetchedAt ?? null,
      liveSourceStatus: live?.sourceStatus ?? null,
      transport: appEvents?.connectionState === "open" ? "stream" : "fallback",
      appVersion: appVersionRef.current,
      visibility: document.visibilityState === "visible" ? "visible" : "hidden",
      viewport: { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) }
    };
  };

  const send = () => {
    const report = latestRef.current();
    if (!report) return;
    lastSentRef.current = Date.now();
    try {
      api.reportOverlay(report);
    } catch {
      // Reporting never affects the overlay.
    }
  };

  // Soon, but never more than once a second, however fast live data arrives.
  const sendSoon = () => {
    if (pendingRef.current !== undefined) return;
    const wait = Math.max(0, lastSentRef.current + MIN_GAP_MS - Date.now());
    pendingRef.current = window.setTimeout(() => {
      pendingRef.current = undefined;
      send();
    }, wait);
  };

  useEffect(() => {
    let active = true;
    // The version this page's code came with: the server's at load. After an update the page reloads itself.
    api
      .getRuntimeInfo()
      .then((runtime) => {
        if (!active || appVersionRef.current) return;
        appVersionRef.current = runtime.appVersion;
        sendSoon();
      })
      .catch(() => undefined);

    const interval = window.setInterval(send, OVERLAY_REPORT_INTERVAL_MS);
    const onVisibility = () => sendSoon();
    const onLeave = () => {
      const report = latestRef.current();
      if (report) api.reportOverlay({ ...report, leaving: true });
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onVisibility);
    window.addEventListener("pagehide", onLeave);
    return () => {
      active = false;
      window.clearInterval(interval);
      if (pendingRef.current !== undefined) window.clearTimeout(pendingRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onVisibility);
      window.removeEventListener("pagehide", onLeave);
    };
  }, []);

  useEffect(() => {
    sendSoon();
  }, [theme?.id, theme?.updatedAt, live?.fetchedAt, live?.sourceStatus, appEvents?.connectionState]);
}
