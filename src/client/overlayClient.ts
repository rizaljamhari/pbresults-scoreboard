import { randomUuid } from "../shared/randomId";

const CLIENT_ID_KEY = "pbresults.overlay.clientId";

/** Which overlay page this is, or null for admin pages. */
export function overlayPageFromPath(pathname: string): "live" | "preview" | null {
  if (pathname === "/overlay/live" || pathname.startsWith("/overlay/live/")) return "live";
  if (pathname.startsWith("/overlay/preview/")) return "preview";
  return null;
}

let cachedClientId: string | null = null;

function randomId() {
  return `ov_${randomUuid().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * A stable id for this overlay page. Kept for the life of the tab (or vMix input), so a reload replaces its own
 * entry on Operations instead of leaving a "lost" copy behind. Held in memory too, so it never changes between
 * reports even where storage is unavailable.
 */
export function overlayClientId(): string {
  if (cachedClientId) return cachedClientId;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(CLIENT_ID_KEY);
  } catch {
    stored = null;
  }
  cachedClientId = stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored) ? stored : randomId();
  try {
    window.sessionStorage.setItem(CLIENT_ID_KEY, cachedClientId);
  } catch {
    // Without storage a reload gets a new id; the old entry ages out as lost.
  }
  return cachedClientId;
}

/** For tests: forget the in-memory id. */
export function resetOverlayClientIdForTests() {
  cachedClientId = null;
}

/** The event-stream address: overlay pages tag theirs so the server knows the moment one closes. */
export function eventStreamUrl(pathname: string) {
  const page = overlayPageFromPath(pathname);
  if (!page) return "/api/events";
  const params = new URLSearchParams({ role: "overlay", page, client: overlayClientId() });
  return `/api/events?${params.toString()}`;
}
