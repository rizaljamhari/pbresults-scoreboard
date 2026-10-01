import { z } from "zod";

/**
 * Overlay health: every /overlay page reports what it renders, and the server judges whether the overlay vMix
 * shows is alive, showing what we think, and current. See docs/overlay-health-technical-plan.md.
 */

export const OVERLAY_REPORT_INTERVAL_MS = 5_000;
/** No stream and no report for this long: the page is not responding. */
export const OVERLAY_STALE_AFTER_MS = 15_000;
/** No stream and no report for this long: the page is gone. */
export const OVERLAY_LOST_AFTER_MS = 60_000;
/** Gone or closed pages stay listed this long, then drop off. */
export const OVERLAY_FORGET_AFTER_MS = 10 * 60_000;
/** After a server start, overlays need a moment to reconnect before "not connected" means anything. */
export const OVERLAY_STARTUP_GRACE_MS = 10_000;
/** A different or older theme is only reported once it has lasted this long; pages switch within a second. */
export const OVERLAY_THEME_GRACE_MS = 10_000;
/** An old app version is only reported once it has lasted this long; pages reload themselves after an update. */
export const OVERLAY_VERSION_GRACE_MS = 30_000;

const timestamp = z.string().max(40);

export const overlayPageSchema = z.enum(["live", "preview"]);

export const overlayReportSchema = z.object({
  clientId: z.string().min(8).max(64),
  page: overlayPageSchema,
  themeId: z.string().max(200).nullable(),
  themeUpdatedAt: timestamp.nullable(),
  liveFetchedAt: timestamp.nullable(),
  liveSourceStatus: z.enum(["idle", "ok", "error", "paused"]).nullable(),
  transport: z.enum(["stream", "fallback"]),
  appVersion: z.string().max(60),
  visibility: z.enum(["visible", "hidden"]),
  viewport: z.object({ width: z.number().int().min(0).max(20_000), height: z.number().int().min(0).max(20_000) }),
  /** Sent once as the page closes normally, so it leaves the list straight away. */
  leaving: z.boolean().optional()
});

export const overlayConnectionValues = ["connected", "stale", "lost", "closed"] as const;
export const overlayIssueValues = ["wrong-theme", "outdated-theme", "behind", "old-version"] as const;

export const overlayClientSchema = z.object({
  clientId: z.string(),
  page: overlayPageSchema,
  remoteAddress: z.string(),
  local: z.boolean(),
  userAgent: z.string(),
  browser: z.string(),
  firstSeenAt: z.string(),
  /** Last time the page reported or its stream was seen open. */
  lastSeenAt: z.string(),
  streamOpen: z.boolean(),
  connection: z.enum(overlayConnectionValues),
  report: overlayReportSchema.omit({ clientId: true, leaving: true }).nullable(),
  /** How far its live data trailed the server's when it last reported. */
  lagMs: z.number().nullable(),
  issues: z.array(z.object({ code: z.enum(overlayIssueValues), since: z.string() })),
  themeName: z.string().nullable()
});

export const overlayStateSchema = z.object({
  serverStartedAt: z.string(),
  generatedAt: z.string(),
  clients: z.array(overlayClientSchema).max(50)
});

export type OverlayReport = z.infer<typeof overlayReportSchema>;
export type OverlayClient = z.infer<typeof overlayClientSchema>;
export type OverlayState = z.infer<typeof overlayStateSchema>;
export type OverlayIssueCode = (typeof overlayIssueValues)[number];
export type OverlayConnection = (typeof overlayConnectionValues)[number];

/** What the server knows, to compare a page's report against. */
export type OverlayServerView = {
  publishedThemeId: string | null;
  publishedThemeUpdatedAt: string | null;
  appVersion: string;
  /** How far behind the server's live data a page may be before it counts as behind. */
  behindThresholdMs: number;
};

export function behindThreshold(pollIntervalMs: number) {
  return Math.max(5_000, pollIntervalMs * 5);
}

/** Connected, not responding, gone, or closed on purpose, from the last sign of life. */
export function overlayConnection(input: { streamOpen: boolean; lastSeenAt: number; closed: boolean }, now: number): OverlayConnection {
  if (input.closed) return "closed";
  const quiet = now - input.lastSeenAt;
  if (input.streamOpen || quiet <= OVERLAY_STALE_AFTER_MS) return "connected";
  return quiet <= OVERLAY_LOST_AFTER_MS ? "stale" : "lost";
}

/** Problems a report shows right now, before any grace period. */
export function currentOverlayIssues(report: OverlayClient["report"], lagMs: number | null, server: OverlayServerView): OverlayIssueCode[] {
  if (!report) return [];
  const issues: OverlayIssueCode[] = [];
  if (report.page === "live" && server.publishedThemeId) {
    if (report.themeId !== server.publishedThemeId) {
      issues.push("wrong-theme");
    } else if (server.publishedThemeUpdatedAt && report.themeUpdatedAt !== server.publishedThemeUpdatedAt) {
      issues.push("outdated-theme");
    }
  }
  if (lagMs !== null && lagMs > server.behindThresholdMs) {
    issues.push("behind");
  }
  if (report.appVersion !== server.appVersion) {
    issues.push("old-version");
  }
  return issues;
}

export function issueGraceMs(code: OverlayIssueCode) {
  return code === "old-version" ? OVERLAY_VERSION_GRACE_MS : code === "behind" ? 0 : OVERLAY_THEME_GRACE_MS;
}

/** A short browser name from a user agent, naming vMix and OBS when they say so. */
export function browserLabel(userAgent: string) {
  const ua = userAgent || "";
  const chrome = /Chrome\/(\d+)/.exec(ua)?.[1];
  const host = /vMix/i.test(ua) ? "vMix" : /OBS/i.test(ua) ? "OBS" : null;
  const engine = /Edg\/(\d+)/.test(ua)
    ? `Edge ${/Edg\/(\d+)/.exec(ua)?.[1]}`
    : chrome
      ? `Chrome ${chrome}`
      : /Firefox\/(\d+)/.test(ua)
        ? `Firefox ${/Firefox\/(\d+)/.exec(ua)?.[1]}`
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return host ? `${host} · ${engine}` : engine;
}

export type OverlaySummaryLevel = "ok" | "info" | "warning" | "critical";

export type OverlaySummary = {
  level: OverlaySummaryLevel;
  code: "checking" | "connected" | "none" | "preview-only" | "stale" | "lost" | OverlayIssueCode;
  /** Sidebar value, e.g. "Behind · 9 s". */
  label: string;
  /** Strip chip, e.g. "vMix overlay lost 12 s ago". */
  chip: string;
  /** The check shown on Operations when something needs doing. */
  check: { title: string; detail: string; fix: string; showUrl: boolean } | null;
  liveCount: number;
};

function seconds(ms: number) {
  return Math.max(0, Math.round(ms / 1000));
}

/** "12 s", then "3 min", then "2 h": an age that stays readable as it grows. */
export function formatAge(ms: number) {
  const total = seconds(ms);
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

function since(value: string, now: number) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : now - time;
}

const ISSUE_ORDER: OverlayIssueCode[] = ["behind", "wrong-theme", "outdated-theme", "old-version"];

/**
 * The one state the admin shows for the live overlay. Fine as long as at least one live page is healthy, so a
 * second test tab never hides the real overlay's problems and a reloaded page's old entry never raises an alarm.
 */
export function summarizeOverlays(state: OverlayState | null, now: number, publishedThemeName: string | null): OverlaySummary {
  const none = (code: OverlaySummary["code"], label: string): OverlaySummary => ({ level: "info", code, label, chip: label, check: null, liveCount: 0 });
  if (!state) return none("checking", "Checking…");

  const live = state.clients.filter((client) => client.page === "live");
  const connected = live.filter((client) => client.connection === "connected");
  const healthy = connected.filter((client) => client.issues.length === 0);
  const where = (client: OverlayClient) => (client.local ? "this computer" : client.remoteAddress);

  if (healthy.length) {
    return {
      level: "ok",
      code: "connected",
      label: healthy.length > 1 ? `Connected · ${healthy.length}` : "Connected",
      chip: healthy.length > 1 ? `${healthy.length} live overlays connected` : "Live overlay connected",
      check: null,
      liveCount: healthy.length
    };
  }

  if (connected.length) {
    const client = connected[0];
    const issue = ISSUE_ORDER.find((code) => client.issues.some((item) => item.code === code)) ?? client.issues[0].code;
    const lag = seconds(client.lagMs ?? 0);
    const shown = client.themeName ?? "another theme";
    const variants: Record<OverlayIssueCode, Omit<OverlaySummary, "level" | "code" | "liveCount">> = {
      behind: {
        label: `Behind · ${lag} s`,
        chip: `Live overlay ${lag} s behind`,
        check: {
          title: "Overlay is behind the feed",
          detail: `The live overlay at ${where(client)} is showing data ${lag} s older than the server has.`,
          fix: "Check the network between this computer and the vMix machine. If it stays behind, refresh the Browser input in vMix.",
          showUrl: false
        }
      },
      "wrong-theme": {
        label: "Other theme",
        chip: "Live overlay shows another theme",
        check: {
          title: "Overlay shows another theme",
          detail: `It is showing ${shown}${publishedThemeName ? `, but ${publishedThemeName} is on air` : ""}.`,
          fix: "Refresh the Browser input in vMix. If it still shows the wrong theme, check its address is the live one below.",
          showUrl: true
        }
      },
      "outdated-theme": {
        label: "Out of date",
        chip: "Live overlay out of date",
        check: {
          title: "Overlay shows an older version of the theme",
          detail: `${shown} was saved, but the overlay at ${where(client)} has not picked up the change.`,
          fix: "Refresh the Browser input in vMix.",
          showUrl: false
        }
      },
      "old-version": {
        label: "Old version",
        chip: "Live overlay on an old version",
        check: {
          title: "Overlay is running an older version of the app",
          detail: "It normally reloads itself after an update. This one has not.",
          fix: "Refresh the Browser input in vMix.",
          showUrl: false
        }
      }
    };
    return { level: "warning", code: issue, liveCount: 0, ...variants[issue] };
  }

  const gone = live
    .filter((client) => client.connection === "stale" || client.connection === "lost")
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))[0];
  if (gone) {
    const quiet = formatAge(since(gone.lastSeenAt, now));
    const lost = gone.connection === "lost";
    return {
      level: "critical",
      code: lost ? "lost" : "stale",
      label: lost ? `Lost · ${quiet} ago` : `No reply · ${quiet}`,
      chip: lost ? `Live overlay lost ${quiet} ago` : `Live overlay not responding · ${quiet}`,
      check: {
        title: lost ? "Live overlay lost" : "Live overlay not responding",
        detail: `The live overlay at ${where(gone)} stopped responding ${quiet} ago. Viewers may see a frozen scoreboard.`,
        fix: "Check the network between this computer and the vMix machine, then refresh the Browser input in vMix.",
        showUrl: false
      },
      liveCount: 0
    };
  }

  if (now - Date.parse(state.serverStartedAt) < OVERLAY_STARTUP_GRACE_MS) {
    return none("checking", "Checking…");
  }

  const previews = state.clients.filter((client) => client.page === "preview" && client.connection === "connected");
  if (previews.length) {
    return {
      level: "warning",
      code: "preview-only",
      label: "Preview only",
      chip: "Only a preview is connected",
      check: {
        title: "Only a preview page is connected",
        detail: `${previews.map(where).join(", ")} loaded a preview address, which shows a chosen theme, not what is on air.`,
        fix: "If that is vMix, change its Browser input to the live address below.",
        showUrl: true
      },
      liveCount: 0
    };
  }

  return {
    level: "warning",
    code: "none",
    label: "Not connected",
    chip: "No live overlay",
    check: {
      title: "No live overlay connected",
      detail: "Nothing has loaded the live overlay, so vMix is not showing the scoreboard.",
      fix: "In vMix, add a Browser input with the live address below at 1920 × 1080.",
      showUrl: true
    },
    liveCount: 0
  };
}
