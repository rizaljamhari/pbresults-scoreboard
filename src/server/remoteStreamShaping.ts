/**
 * Bandwidth shaping for event streams opened through remote access, where every byte counts against the tunnel's
 * quota. Local and LAN streams, including vMix's overlay, never pass through here and stay exactly as they were.
 *
 * Not compressed: ngrok holds back a gzip-encoded streaming response until it ends (checked against a real tunnel:
 * no headers within 6 s), so the browser's event stream fails and the page falls back to polling. Ordinary gzipped
 * responses pass through ngrok fine.
 */

/** Remote pages still see the feed as fresh: their staleness threshold is at least 5 seconds. */
export const REMOTE_LIVE_FRESHNESS_MS = 2_000;

/**
 * Overlay health changes (connected, lost, wrong theme, behind) go out at once; otherwise the list is resent this
 * often, which only refreshes its "last seen" times. The admin's summary reads the server's verdicts, not the times.
 */
export const REMOTE_OVERLAY_REFRESH_MS = 15_000;

type FrameRule = { type: string; key: (event: Record<string, unknown>) => string; refreshMs: number };

const liveStateRule: FrameRule = {
  type: "live.state",
  // The poller pushes on every poll even when only fetchedAt moved.
  key: (event) => JSON.stringify({ ...(event.state as Record<string, unknown>), fetchedAt: null }),
  refreshMs: REMOTE_LIVE_FRESHNESS_MS
};

const overlayStateRule: FrameRule = {
  type: "overlay.state",
  // Each overlay report moves timestamps and lag; what remote Operations shows depends on the rest.
  key: (event) => {
    const state = event.state as { clients?: Array<Record<string, unknown>> } | undefined;
    return JSON.stringify(
      (state?.clients ?? []).map((client) => {
        const report = client.report as Record<string, unknown> | null | undefined;
        return {
          id: client.clientId,
          page: client.page,
          connection: client.connection,
          streamOpen: client.streamOpen,
          issues: (client.issues as Array<{ code: unknown }> | undefined)?.map((issue) => issue.code),
          themeId: report?.themeId ?? null,
          appVersion: report?.appVersion ?? null,
          visibility: report?.visibility ?? null
        };
      })
    );
  },
  refreshMs: REMOTE_OVERLAY_REFRESH_MS
};

/**
 * Decides which frames a remote stream receives: each real change at once, an unchanged one only as an occasional
 * refresh. Every other kind of frame passes untouched.
 */
export function createRemoteFrameFilter(options: { now?: () => number; rules?: FrameRule[] } = {}) {
  const now = options.now ?? Date.now;
  const rules = options.rules ?? [liveStateRule, overlayStateRule];
  const last = new Map<string, { key: string; at: number }>();
  return (frame: string): boolean => {
    const rule = rules.find((candidate) => frame.includes(`\nevent: ${candidate.type}\n`));
    if (!rule) return true;
    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
    let key: string;
    try {
      key = rule.key(JSON.parse(dataLine!.slice("data: ".length)) as Record<string, unknown>);
    } catch {
      return true;
    }
    const at = now();
    const previous = last.get(rule.type);
    if (previous && previous.key === key && at - previous.at < rule.refreshMs) return false;
    last.set(rule.type, { key, at });
    return true;
  };
}
