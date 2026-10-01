import {
  OVERLAY_FORGET_AFTER_MS,
  browserLabel,
  currentOverlayIssues,
  issueGraceMs,
  overlayConnection,
  type OverlayClient,
  type OverlayIssueCode,
  type OverlayReport,
  type OverlayServerView,
  type OverlayState
} from "../shared/overlayHealth.js";

const MAX_CLIENTS = 50;
const CLOSED_FORGET_AFTER_MS = 60_000;

type RequestMeta = { remoteAddress: string; userAgent: string };

type Entry = {
  clientId: string;
  page: OverlayClient["page"];
  remoteAddress: string;
  userAgent: string;
  firstSeenAt: number;
  lastSeenAt: number;
  openStreams: number;
  closed: boolean;
  report: OverlayClient["report"];
  lagMs: number | null;
  /** When each problem was first seen, so short blips during a switch never show. */
  issueSince: Map<OverlayIssueCode, number>;
};

type RegistryOptions = {
  now?: () => number;
  /** The server's view to judge reports against; read only when there is something to judge. */
  getServerView: () => OverlayServerView;
  /** fetchedAt of the server's current live state, to measure how far a page trails it. */
  getServerLiveFetchedAt: () => string | null;
  getThemeName: (themeId: string) => string | null;
  /** Called (throttled) whenever the list changes, to push it to admin pages. */
  onChange?: (state: OverlayState) => void;
  broadcastThrottleMs?: number;
};

export function isLoopback(address: string) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1" || address === "localhost";
}

/**
 * Who is showing the overlay, kept in memory only: after a restart pages reconnect and report again within
 * seconds. Never throws into a request; a bad report is simply ignored.
 */
export class OverlayRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly startedAt: number;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastBroadcastAt = 0;

  constructor(private readonly options: RegistryOptions) {
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  /** Re-judges ages (connected → stale → lost) even when nobody reports; call once at start-up. */
  startTicking(intervalMs = 5_000) {
    this.tickTimer = setInterval(() => {
      if (this.entries.size) this.changed();
    }, intervalMs);
    this.tickTimer.unref?.();
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.tickTimer = null;
    this.broadcastTimer = null;
  }

  /** An overlay page's event stream opened. Returns the function to call when it closes. */
  attachStream(clientId: string, page: OverlayClient["page"], meta: RequestMeta): () => void {
    const entry = this.ensure(clientId, page, meta);
    entry.openStreams += 1;
    entry.closed = false;
    entry.lastSeenAt = this.now();
    this.changed();
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      const current = this.entries.get(clientId);
      if (!current) return;
      current.openStreams = Math.max(0, current.openStreams - 1);
      current.lastSeenAt = this.now();
      this.changed();
    };
  }

  report(report: OverlayReport, meta: RequestMeta) {
    const entry = this.ensure(report.clientId, report.page, meta);
    const now = this.now();
    entry.lastSeenAt = now;
    entry.page = report.page;
    if (report.leaving) {
      entry.closed = true;
      this.changed();
      return;
    }
    entry.closed = false;
    const { clientId: _clientId, leaving: _leaving, ...rest } = report;
    entry.report = rest;
    const serverFetchedAt = Date.parse(this.options.getServerLiveFetchedAt() ?? "");
    const pageFetchedAt = Date.parse(report.liveFetchedAt ?? "");
    entry.lagMs =
      report.liveSourceStatus === "ok" && Number.isFinite(serverFetchedAt) && Number.isFinite(pageFetchedAt)
        ? Math.max(0, serverFetchedAt - pageFetchedAt)
        : null;
    // Start the clock on any problem now, so its grace period runs even while no admin page is looking.
    this.trackIssues(entry, this.options.getServerView(), now);
    this.changed();
  }

  getState(): OverlayState {
    const now = this.now();
    this.prune(now);
    const view = this.entries.size ? this.options.getServerView() : null;
    const clients = [...this.entries.values()]
      .map((entry) => this.toClient(entry, view, now))
      .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
    return {
      serverStartedAt: new Date(this.startedAt).toISOString(),
      generatedAt: new Date(now).toISOString(),
      clients
    };
  }

  private toClient(entry: Entry, view: OverlayServerView | null, now: number): OverlayClient {
    const connection = overlayConnection({ streamOpen: entry.openStreams > 0, lastSeenAt: entry.lastSeenAt, closed: entry.closed }, now);
    const present = connection === "connected" ? this.trackIssues(entry, view, now) : this.trackIssues(entry, null, now);
    const issues = present
      .filter((code) => now - (entry.issueSince.get(code) ?? now) >= issueGraceMs(code))
      .map((code) => ({ code, since: new Date(entry.issueSince.get(code) ?? now).toISOString() }));
    return {
      clientId: entry.clientId,
      page: entry.page,
      remoteAddress: entry.remoteAddress,
      local: isLoopback(entry.remoteAddress),
      userAgent: entry.userAgent,
      browser: browserLabel(entry.userAgent),
      firstSeenAt: new Date(entry.firstSeenAt).toISOString(),
      lastSeenAt: new Date(entry.openStreams > 0 ? now : entry.lastSeenAt).toISOString(),
      streamOpen: entry.openStreams > 0,
      connection,
      report: entry.report,
      lagMs: entry.lagMs,
      issues,
      themeName: entry.report?.themeId ? this.options.getThemeName(entry.report.themeId) : null
    };
  }

  /** Updates when each current problem was first seen and returns the current ones. */
  private trackIssues(entry: Entry, view: OverlayServerView | null, now: number): OverlayIssueCode[] {
    const present = view ? currentOverlayIssues(entry.report, entry.lagMs, view) : [];
    for (const code of [...entry.issueSince.keys()]) {
      if (!present.includes(code)) entry.issueSince.delete(code);
    }
    for (const code of present) {
      if (!entry.issueSince.has(code)) entry.issueSince.set(code, now);
    }
    return present;
  }

  private ensure(clientId: string, page: OverlayClient["page"], meta: RequestMeta): Entry {
    let entry = this.entries.get(clientId);
    if (!entry) {
      const now = this.now();
      entry = {
        clientId,
        page,
        remoteAddress: meta.remoteAddress,
        userAgent: meta.userAgent,
        firstSeenAt: now,
        lastSeenAt: now,
        openStreams: 0,
        closed: false,
        report: null,
        lagMs: null,
        issueSince: new Map()
      };
      this.entries.set(clientId, entry);
      this.prune(now);
    } else {
      entry.remoteAddress = meta.remoteAddress;
      entry.userAgent = meta.userAgent;
    }
    return entry;
  }

  private prune(now: number) {
    // A page closed on purpose leaves after a minute; one that vanished stays visible for a while as lost.
    for (const [clientId, entry] of this.entries) {
      if (entry.openStreams > 0) continue;
      const quiet = now - entry.lastSeenAt;
      if (entry.closed ? quiet > CLOSED_FORGET_AFTER_MS : quiet > OVERLAY_FORGET_AFTER_MS) {
        this.entries.delete(clientId);
      }
    }
    if (this.entries.size > MAX_CLIENTS) {
      const oldest = [...this.entries.values()].sort((left, right) => left.lastSeenAt - right.lastSeenAt);
      for (const entry of oldest.slice(0, this.entries.size - MAX_CLIENTS)) {
        this.entries.delete(entry.clientId);
      }
    }
  }

  private changed() {
    if (!this.options.onChange) return;
    const throttle = this.options.broadcastThrottleMs ?? 1_000;
    const wait = Math.max(0, this.lastBroadcastAt + throttle - this.now());
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.lastBroadcastAt = this.now();
      this.options.onChange?.(this.getState());
    }, wait);
    this.broadcastTimer.unref?.();
  }
}
