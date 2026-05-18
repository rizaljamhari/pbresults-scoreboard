import { normalizeLiveState } from "../shared/normalize.js";
import type { NormalizedLiveState } from "../shared/theme.js";
import { getApplicableTeamResolutionOverrides, getSettings, listTeamRecords } from "./storage.js";

function extractDisplayNames(raw: unknown) {
  const payload = (raw as { mainGame?: Array<{ name?: string }> } | null) ?? null;
  return {
    left: payload?.mainGame?.[0]?.name ?? "",
    right: payload?.mainGame?.[1]?.name ?? ""
  };
}

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
  private lastActivitySourceStatus: NormalizedLiveState["sourceStatus"] = "idle";

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    if (!getSettings().pollEnabled) {
      this.setPausedState();
      return;
    }
    this.scheduleNext(0);
  }

  reconfigure() {
    if (!this.started) {
      return;
    }

    if (!getSettings().pollEnabled) {
      this.runImmediatelyAfterPoll = false;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      if (this.polling) {
        return;
      }
      this.setPausedState();
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

  refreshNow() {
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

    if (!getSettings().pollEnabled) {
      this.polling = true;
      void this.poll(true).finally(() => {
        this.polling = false;
        if (!getSettings().pollEnabled) {
          this.setPausedState();
        }
      });
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
    if (!getSettings().pollEnabled) {
      this.timeoutId = null;
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

      if (!getSettings().pollEnabled) {
        this.setPausedState();
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      const nextDelayMs = this.runImmediatelyAfterPoll ? 0 : Math.max(0, getSettings().pollIntervalMs - elapsedMs);
      this.runImmediatelyAfterPoll = false;
      this.scheduleNext(nextDelayMs);
    }
  }

  private async poll(ignorePollEnabled = false) {
    const { upstreamBaseUrl, pollEnabled } = getSettings();
    if (!pollEnabled && !ignorePollEnabled) {
      this.setPausedState();
      return;
    }
    const teams = listTeamRecords();
    const url = new URL("/live", upstreamBaseUrl).toString();
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Upstream responded with ${response.status}`);
      }
      const raw = (await response.json()) as unknown;
      const overrideNames = extractDisplayNames(raw);
      const overrides = getApplicableTeamResolutionOverrides(overrideNames.left, overrideNames.right);
      this.state = {
        raw,
        normalized: normalizeLiveState(raw as Record<string, unknown>, {
          sourceStatus: "ok",
          fetchedAt: new Date().toISOString(),
          errorMessage: null,
          teams,
          teamOverrides: overrides
        })
      };
      this.lastActivitySourceStatus = "ok";
      this.emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown upstream error";
      const overrideNames = extractDisplayNames(this.state.raw);
      const overrides = getApplicableTeamResolutionOverrides(overrideNames.left, overrideNames.right);
      this.state = {
        raw: this.state.raw,
        normalized: normalizeLiveState((this.state.raw as Record<string, unknown> | null) ?? null, {
          sourceStatus: "error",
          fetchedAt: this.state.normalized.fetchedAt,
          errorMessage: message,
          teams,
          teamOverrides: overrides
        })
      };
      this.lastActivitySourceStatus = "error";
      this.emit();
    }
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private setPausedState() {
    const teams = listTeamRecords();
    const overrideNames = extractDisplayNames(this.state.raw);
    const overrides = getApplicableTeamResolutionOverrides(overrideNames.left, overrideNames.right);
    this.state = {
      raw: this.state.raw,
      normalized: normalizeLiveState((this.state.raw as Record<string, unknown> | null) ?? null, {
        sourceStatus: "paused",
        fetchedAt: this.state.normalized.fetchedAt,
        errorMessage: null,
        teams,
        teamOverrides: overrides
      })
    };
    this.lastActivitySourceStatus = "paused";
    this.emit();
  }
}

export const livePoller = new LivePoller();
