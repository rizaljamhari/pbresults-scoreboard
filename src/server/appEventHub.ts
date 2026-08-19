import { randomUUID } from "node:crypto";
import {
  appEventTypeToDomain,
  initialAppResourceRevisions,
  type AppChangedEvent,
  type AppChangedEventType,
  type AppEvent,
  type AppEventSnapshot,
  type AppRealtimeEvent,
  type AppResourceRevisions,
  type RuntimeIdentity
} from "../shared/appEvents.js";
import type { NormalizedLiveState, OperatorTextState } from "../shared/theme.js";

type AppEventListener = (frame: string) => boolean;

type AppEventHubLogger = {
  warn(message: string, details?: Record<string, unknown>): void;
};

type AppEventHubOptions = {
  instanceId?: string;
  now?: () => Date;
  heartbeatIntervalMs?: number;
  maxSubscribers?: number;
  logger?: AppEventHubLogger;
};

export function formatAppEventFrame(event: AppEvent, retryMs?: number): string {
  const lines = retryMs === undefined ? [] : [`retry: ${retryMs}`];
  lines.push(`id: ${event.instanceId}:${event.sequence}`, `event: ${event.type}`, `data: ${JSON.stringify(event)}`);
  return `${lines.join("\n")}\n\n`;
}

export class AppEventHub {
  readonly instanceId: string;

  private sequence = 0;
  private revisions: AppResourceRevisions = { ...initialAppResourceRevisions };
  private readonly listeners = new Set<AppEventListener>();
  private readonly now: () => Date;
  private readonly maxSubscribers: number;
  private readonly logger: AppEventHubLogger;
  private heartbeatTimer: NodeJS.Timeout | null;
  private closed = false;

  constructor(options: AppEventHubOptions = {}) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.now = options.now ?? (() => new Date());
    this.maxSubscribers = options.maxSubscribers ?? 100;
    this.logger = options.logger ?? console;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  getSnapshot(
    runtime: RuntimeIdentity,
    liveState?: NormalizedLiveState,
    operatorTextState?: OperatorTextState
  ): AppEventSnapshot {
    return {
      protocol: 1,
      type: "system.snapshot",
      instanceId: this.instanceId,
      sequence: this.sequence,
      occurredAt: this.now().toISOString(),
      revisions: { ...this.revisions },
      runtime,
      ...(liveState ? { liveState } : {}),
      ...(operatorTextState ? { operatorTextState } : {})
    };
  }

  publish(type: AppChangedEventType, resourceIds?: string[]): AppChangedEvent {
    const domain = appEventTypeToDomain[type];
    this.sequence += 1;
    this.revisions = {
      ...this.revisions,
      [domain]: this.revisions[domain] + 1
    };
    const uniqueResourceIds = resourceIds ? [...new Set(resourceIds.filter(Boolean))].slice(0, 100) : undefined;
    const event: AppChangedEvent = {
      protocol: 1,
      type,
      instanceId: this.instanceId,
      sequence: this.sequence,
      occurredAt: this.now().toISOString(),
      revision: this.revisions[domain],
      ...(uniqueResourceIds && uniqueResourceIds.length > 0 ? { resourceIds: uniqueResourceIds } : {})
    };
    this.broadcast(formatAppEventFrame(event));
    return event;
  }

  publishLiveState(state: NormalizedLiveState): AppRealtimeEvent {
    return this.publishRealtime({ type: "live.state", state });
  }

  publishOperatorTextState(state: OperatorTextState): AppRealtimeEvent {
    return this.publishRealtime({ type: "operator-text.state", state });
  }

  hasCapacity(): boolean {
    return !this.closed && this.listeners.size < this.maxSubscribers;
  }

  subscribe(listener: AppEventListener): (() => void) | null {
    if (!this.hasCapacity()) {
      return null;
    }
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  heartbeat(): void {
    this.broadcast(`: keep-alive ${this.now().getTime()}\n\n`);
  }

  getStats() {
    return {
      connectedClients: this.listeners.size,
      sequence: this.sequence
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.listeners.clear();
  }

  private broadcast(frame: string): void {
    if (this.closed) return;
    for (const listener of [...this.listeners]) {
      try {
        if (!listener(frame)) {
          this.listeners.delete(listener);
        }
      } catch (error) {
        this.listeners.delete(listener);
        this.logger.warn("Application event listener failed", {
          error: error instanceof Error ? error.message : "Unknown listener error"
        });
      }
    }
  }

  private publishRealtime(
    payload:
      | { type: "live.state"; state: NormalizedLiveState }
      | { type: "operator-text.state"; state: OperatorTextState }
  ): AppRealtimeEvent {
    this.sequence += 1;
    const event = {
      protocol: 1 as const,
      instanceId: this.instanceId,
      sequence: this.sequence,
      occurredAt: this.now().toISOString(),
      ...payload
    } as AppRealtimeEvent;
    this.broadcast(formatAppEventFrame(event));
    return event;
  }
}
