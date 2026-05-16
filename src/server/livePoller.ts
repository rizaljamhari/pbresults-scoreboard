import { normalizeLiveState } from "../shared/normalize.js";
import type { NormalizedLiveState } from "../shared/theme.js";
import { getSettings, listTeamRecords } from "./storage.js";

type PollState = {
  raw: unknown;
  normalized: NormalizedLiveState;
};

type LivePollListener = (state: PollState) => void;

const emptyState = normalizeLiveState(null, {
  sourceStatus: "idle",
  fetchedAt: null,
  errorMessage: null
});

class LivePoller {
  private state: PollState = { raw: null, normalized: emptyState };
  private started = false;
  private timeoutId: NodeJS.Timeout | null = null;
  private polling = false;
  private runImmediatelyAfterPoll = false;
  private listeners = new Set<LivePollListener>();

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.scheduleNext(0);
  }

  reconfigure() {
    if (!this.started) {
      return;
    }

    if (this.polling) {
      this.runImmediatelyAfterPoll = true;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      return;
    }

    this.scheduleNext(0);
  }

  getState(): PollState {
    return this.state;
  }

  subscribe(listener: LivePollListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleNext(delayMs: number) {
    if (!this.started) {
      return;
    }

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      this.timeoutId = null;
      void this.tick();
    }, delayMs);
  }

  private async tick() {
    if (this.polling) {
      return;
    }

    const startedAt = Date.now();
    this.polling = true;
    try {
      await this.poll();
    } finally {
      this.polling = false;
      if (!this.started) {
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      const nextDelayMs = this.runImmediatelyAfterPoll ? 0 : Math.max(0, getSettings().pollIntervalMs - elapsedMs);
      this.runImmediatelyAfterPoll = false;
      this.scheduleNext(nextDelayMs);
    }
  }

  private async poll() {
    const { upstreamBaseUrl } = getSettings();
    const teams = listTeamRecords();
    const url = new URL("/live", upstreamBaseUrl).toString();
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Upstream responded with ${response.status}`);
      }
      const raw = (await response.json()) as unknown;
      this.state = {
        raw,
        normalized: normalizeLiveState(raw as Record<string, unknown>, {
          sourceStatus: "ok",
          fetchedAt: new Date().toISOString(),
          errorMessage: null,
          teams
        })
      };
      this.emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown upstream error";
      this.state = {
        raw: this.state.raw,
        normalized: normalizeLiveState((this.state.raw as Record<string, unknown> | null) ?? null, {
          sourceStatus: "error",
          fetchedAt: this.state.normalized.fetchedAt,
          errorMessage: message,
          teams
        })
      };
      this.emit();
    }
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const livePoller = new LivePoller();
