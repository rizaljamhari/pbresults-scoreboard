import { randomBytes, randomUUID } from "node:crypto";
import {
  REMOTE_ACCESS_DURATIONS_MINUTES,
  REMOTE_ACCESS_PROVIDER,
  type LocalRemoteAccessStatus,
  type RemoteAccessError,
  type RemoteAccessErrorCode,
  type RemoteAccessPhase,
  type RemoteAccessStatus,
  type RemoteConnectionState
} from "../shared/remoteAccess.js";
import { buildTrafficPolicy, type RemoteAccessProvider, type RemoteConnectionEvent, type RemoteTunnel } from "./ngrokRemoteAccessProvider.js";
import { RemoteAccessFailure } from "./remoteAccessErrors.js";
import { SecretStoreFailure, type RemoteAccessSecretStore } from "./remoteAccessSecrets.js";
import type { RemoteSessionMarkers } from "./remoteRequestSecurity.js";

export { RemoteAccessFailure };

/**
 * Proves an authtoken works before it is saved. Throws a RemoteAccessFailure (TOKEN_INVALID or PROVIDER_UNAVAILABLE)
 * when it does not.
 */
export type AuthtokenVerifier = (authtoken: string) => Promise<void>;

export const acceptAuthtoken: AuthtokenVerifier = async () => {};

/** Only sanitized lifecycle facts; never credentials, markers, tokens, policies, or provider text. */
export type RemoteAccessLifecycleEvent = {
  event: "session.starting" | "session.active" | "session.degraded" | "session.reconnected" | "session.stopped" | "session.expired" | "session.failed" | "session.stop-failed";
  sessionId: string;
  phase: RemoteAccessPhase;
  startedAt?: string | null;
  expiresAt?: string | null;
  errorCode?: RemoteAccessErrorCode;
  reason?: StopReason;
};

export type StopReason = "manual" | "expiry" | "shutdown" | "startup-failure";

/** Sends the authenticated self-probe through the public URL and returns the HTTP status. */
export type ProbeRequest = (options: { url: string; username: string; password: string; timeoutMs: number }) => Promise<number>;

type Timers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

type ActiveSession = {
  id: string;
  username: string;
  password: string;
  marker: string;
  tunnel: RemoteTunnel | null;
  url: string | null;
  durationMinutes: number;
  startedAt: string | null;
  expiresAt: string | null;
  expiryTimer: unknown;
  probeSeen: boolean;
};

/** Phases where a tunnel may exist, so the token behind it must not change. */
const sessionPhases: ReadonlySet<RemoteAccessPhase> = new Set(["starting", "active", "degraded", "stopping"]);
const PROBE_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;
const SHUTDOWN_CLOSE_TIMEOUT_MS = 2_000;

/** ASCII, no colon (Basic Auth separator), no `${` (ngrok policy interpolation), nothing to transcribe by hand. */
function randomToken(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}

export function generateSessionSecrets() {
  return {
    sessionId: randomUUID(),
    username: `pbremote-${randomToken(6)}`,
    password: randomToken(18),
    marker: randomToken(32)
  };
}

export const fetchProbe: ProbeRequest = async ({ url, username, password, timeoutMs }) => {
  const response = await fetch(new URL("/api/remote-access/probe", url), {
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      // Without this, ngrok's free-plan warning page could answer instead of the scoreboard.
      "ngrok-skip-browser-warning": "1"
    },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs)
  });
  await response.body?.cancel().catch(() => undefined);
  return response.status;
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export class RemoteAccessService {
  private readonly store: RemoteAccessSecretStore;
  private readonly verify: AuthtokenVerifier;
  private readonly now: () => Date;
  private readonly provider: RemoteAccessProvider | null;
  private readonly markers: RemoteSessionMarkers | null;
  private readonly probe: ProbeRequest;
  private readonly timers: Timers;
  private readonly onChange: () => void;
  private readonly log: (event: RemoteAccessLifecycleEvent) => void;
  private readonly getPort: () => number;
  private readonly appVersion: string;
  /** Volatile by design: a restart always begins unconfigured or inactive. */
  private sessionPhase: RemoteAccessPhase = "inactive";
  private connection: RemoteConnectionState = "disconnected";
  private lastError: RemoteAccessError | null = null;
  private session: ActiveSession | null = null;
  private shuttingDown = false;
  private lifecycle: Promise<unknown> = Promise.resolve();
  /** Closers for remote pages' open event streams, by session; revoking a session ends them at once. */
  private remoteStreams = new Map<string, Set<() => void>>();

  constructor(options: {
    store: RemoteAccessSecretStore;
    verify?: AuthtokenVerifier;
    now?: () => Date;
    provider?: RemoteAccessProvider;
    markers?: RemoteSessionMarkers;
    probe?: ProbeRequest;
    timers?: Timers;
    onChange?: () => void;
    log?: (event: RemoteAccessLifecycleEvent) => void;
    port?: number | (() => number);
    appVersion?: string;
  }) {
    this.store = options.store;
    this.provider = options.provider ?? null;
    this.verify = options.verify ?? (this.provider ? (token) => this.provider!.verifyAuthtoken(token) : acceptAuthtoken);
    this.now = options.now ?? (() => new Date());
    this.markers = options.markers ?? null;
    this.probe = options.probe ?? fetchProbe;
    this.timers = options.timers ?? {
      setTimeout: (callback, ms) => {
        const handle = setTimeout(callback, ms);
        handle.unref?.();
        return handle;
      },
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
    };
    this.onChange = options.onChange ?? (() => {});
    this.log = options.log ?? (() => {});
    const port = options.port ?? 3000;
    this.getPort = typeof port === "function" ? port : () => port;
    this.appVersion = options.appVersion ?? "0.0.0";
  }

  getStatus(request: { managementAllowed: boolean; remoteRequest: boolean }): RemoteAccessStatus | LocalRemoteAccessStatus {
    const stored = this.store.read();
    const session = this.session;
    const visible = this.sessionPhase === "active" || this.sessionPhase === "degraded";
    const status: RemoteAccessStatus = {
      provider: REMOTE_ACCESS_PROVIDER,
      configured: stored !== null,
      phase: this.phase(stored !== null),
      connection: this.connection,
      managementAllowed: request.managementAllowed,
      remoteRequest: request.remoteRequest,
      url: visible ? (session?.url ?? null) : null,
      startedAt: visible ? (session?.startedAt ?? null) : null,
      expiresAt: visible ? (session?.expiresAt ?? null) : null,
      remoteConnections: visible && session ? (this.remoteStreams.get(session.id)?.size ?? 0) : 0,
      lastError: this.lastError
    };
    if (!request.managementAllowed) return status;
    return {
      ...status,
      configurationSource: stored?.source ?? null,
      credentials: visible && session ? { username: session.username, password: session.password } : null
    };
  }

  /** Test the token first, then replace the stored one; a failed test leaves the previous token in place. */
  configure(authtoken: string): Promise<void> {
    return this.serialize(async () => {
      this.assertNoSession();
      if (this.store.read()?.source === "environment") throw this.environmentOverride();
      try {
        await this.verify(authtoken);
      } catch (error) {
        throw this.record(
          error instanceof RemoteAccessFailure
            ? error
            : new RemoteAccessFailure("REMOTE_ACCESS_PROVIDER_UNAVAILABLE", "ngrok could not be reached to test the authtoken.", 502)
        );
      }
      this.writeStore(() => this.store.save(authtoken));
      this.lastError = null;
      this.changed();
    });
  }

  removeConfiguration(): Promise<void> {
    return this.serialize(async () => {
      this.assertNoSession();
      this.writeStore(() => this.store.remove());
      this.lastError = null;
      this.changed();
    });
  }

  /**
   * Open the tunnel, prove it end to end through the public URL, and only then show the access details (plan
   * section 16). Any failure closes what was opened, forgets every secret, and leaves the session failed.
   */
  start(durationMinutes: number): Promise<void> {
    return this.serialize(async () => {
      if (!(REMOTE_ACCESS_DURATIONS_MINUTES as readonly number[]).includes(durationMinutes)) {
        throw new RemoteAccessFailure("REMOTE_ACCESS_INVALID_DURATION", "Choose one of the offered session lengths.", 400);
      }
      if (this.sessionPhase === "active" || this.sessionPhase === "degraded") {
        throw new RemoteAccessFailure("REMOTE_ACCESS_ALREADY_ACTIVE", "Remote access is already on.", 409);
      }
      // A failed start leaves nothing open, so it can be retried; a failed stop keeps its tunnel and must be stopped.
      if (this.sessionPhase !== "inactive" && !(this.sessionPhase === "failed" && !this.session)) {
        throw new RemoteAccessFailure("REMOTE_ACCESS_BUSY", "Remote access is busy. Stop it, then try again.", 409);
      }
      if (this.shuttingDown) throw new RemoteAccessFailure("REMOTE_ACCESS_BUSY", "The scoreboard is shutting down.", 409);
      const stored = this.store.read();
      if (!stored) throw new RemoteAccessFailure("REMOTE_ACCESS_NOT_CONFIGURED", "Save an ngrok authtoken first.", 409);
      if (!this.provider || !this.markers) {
        throw new RemoteAccessFailure("REMOTE_ACCESS_PROVIDER_UNAVAILABLE", "Remote access is not available in this build.", 503);
      }

      const secrets = generateSessionSecrets();
      const session: ActiveSession = {
        id: secrets.sessionId,
        username: secrets.username,
        password: secrets.password,
        marker: secrets.marker,
        tunnel: null,
        url: null,
        durationMinutes,
        startedAt: null,
        expiresAt: null,
        expiryTimer: null,
        probeSeen: false
      };
      this.session = session;
      this.sessionPhase = "starting";
      this.connection = "connecting";
      this.lastError = null;
      this.log({ event: "session.starting", sessionId: session.id, phase: "starting" });
      this.changed();

      try {
        session.tunnel = await this.provider.openTunnel({
          authtoken: stored.authtoken,
          port: this.getPort(),
          trafficPolicy: buildTrafficPolicy(secrets),
          appVersion: this.appVersion,
          onConnection: (event) => this.connectionChanged(session, event)
        });
        if (this.shuttingDown || this.session !== session) throw new RemoteAccessFailure("REMOTE_ACCESS_BUSY", "The scoreboard is shutting down.", 409);
        session.url = this.validatePublicUrl(session.tunnel.url);
        // Provisional: the marker opens only the probe route until the probe proves the whole path.
        this.markers.activate({ sessionId: session.id, marker: session.marker, publicOrigin: session.url });
        const status = await this.probe({ url: session.url, username: session.username, password: session.password, timeoutMs: PROBE_TIMEOUT_MS }).catch(() => 0);
        if (status !== 204 || !session.probeSeen) {
          throw new RemoteAccessFailure("REMOTE_ACCESS_PROBE_FAILED", "The scoreboard could not reach itself through ngrok, so remote access was not turned on.", 502);
        }
        if (this.shuttingDown || this.session !== session) throw new RemoteAccessFailure("REMOTE_ACCESS_BUSY", "The scoreboard is shutting down.", 409);

        this.markers.confirm(session.id);
        const started = this.now();
        session.startedAt = started.toISOString();
        session.expiresAt = new Date(started.getTime() + durationMinutes * 60_000).toISOString();
        // From the absolute end time, so reconnects and slow starts never stretch a session.
        session.expiryTimer = this.timers.setTimeout(() => void this.expire(session), durationMinutes * 60_000);
        this.sessionPhase = "active";
        this.connection = "connected";
        this.log({ event: "session.active", sessionId: session.id, phase: "active", startedAt: session.startedAt, expiresAt: session.expiresAt });
        this.changed();
      } catch (error) {
        const failure =
          error instanceof RemoteAccessFailure
            ? error
            : new RemoteAccessFailure("REMOTE_ACCESS_PROVIDER_UNAVAILABLE", "ngrok could not be reached. Check this computer's internet connection.", 502);
        await this.abandonFailedStart(session, failure);
        throw failure;
      }
    });
  }

  /** Revoke first, then close; never report stopped while the endpoint may still be open (plan section 18). */
  stop(reason: StopReason = "manual"): Promise<void> {
    return this.serialize(() => this.stopNow(reason));
  }

  /**
   * Called by the probe route for a request that already passed the boundary as this session's provisional marker.
   * Returns whether the probe counts: right session, still starting, Basic Auth already stripped, really via ngrok.
   */
  acceptProbe(request: { sessionId: string; authorizationPresent: boolean; forwardedProto: string | undefined }): boolean {
    const session = this.session;
    if (!session || this.sessionPhase !== "starting" || request.sessionId !== session.id) return false;
    if (request.authorizationPresent || request.forwardedProto !== "https") return false;
    session.probeSeen = true;
    return true;
  }

  /**
   * Count a remote page's open event stream for "who is connected", and remember how to end it. Returns the release
   * to call when the stream closes. A stream for anything but the current session is ended immediately.
   */
  trackRemoteStream(sessionId: string, close: () => void): () => void {
    if (!this.session || this.session.id !== sessionId) {
      close();
      return () => {};
    }
    let streams = this.remoteStreams.get(sessionId);
    if (!streams) {
      streams = new Set();
      this.remoteStreams.set(sessionId, streams);
    }
    const tracked = streams;
    tracked.add(close);
    this.changed();
    return () => {
      if (!tracked.delete(close)) return;
      if (tracked.size === 0) this.remoteStreams.delete(sessionId);
      this.changed();
    };
  }

  /**
   * First step of a graceful shutdown. Revokes the session at once, then gives the tunnel a short, bounded chance to
   * close. Does not wait for other lifecycle work, so a hung start cannot hold the process past the update
   * coordinator's deadline; process exit drops whatever is left.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.revoke();
    const session = this.session;
    if (!session) return;
    if (session.expiryTimer) this.timers.clearTimeout(session.expiryTimer);
    const tunnel = session.tunnel;
    this.session = null;
    this.sessionPhase = "inactive";
    this.connection = "disconnected";
    this.log({ event: "session.stopped", sessionId: session.id, phase: "inactive", reason: "shutdown" });
    if (tunnel) {
      const closed = await withTimeout(tunnel.close(), SHUTDOWN_CLOSE_TIMEOUT_MS).then(
        () => true,
        () => false
      );
      if (!closed) await withTimeout(this.provider?.disconnectAll() ?? Promise.resolve(), 1_000).catch(() => undefined);
    }
  }

  private async stopNow(reason: StopReason) {
    const session = this.session;
    if (!session) {
      if (this.sessionPhase === "failed") {
        this.sessionPhase = "inactive";
        this.lastError = null;
        this.changed();
      }
      return;
    }
    this.revoke();
    if (session.expiryTimer) this.timers.clearTimeout(session.expiryTimer);
    session.expiryTimer = null;
    this.sessionPhase = "stopping";
    this.changed();
    try {
      if (session.tunnel) await withTimeout(session.tunnel.close(), STOP_TIMEOUT_MS);
    } catch {
      // Keep only the tunnel handle so Stop can be retried; the marker stays cleared, so traffic is already refused.
      session.username = "";
      session.password = "";
      session.marker = "";
      this.sessionPhase = "failed";
      this.connection = "disconnected";
      this.record(new RemoteAccessFailure("REMOTE_ACCESS_STOP_FAILED", "ngrok did not confirm the tunnel closed. Remote requests are already refused; try Stop again.", 502));
      this.log({ event: "session.stop-failed", sessionId: session.id, phase: "failed", errorCode: "REMOTE_ACCESS_STOP_FAILED", reason });
      this.changed();
      throw new RemoteAccessFailure("REMOTE_ACCESS_STOP_FAILED", "ngrok did not confirm the tunnel closed. Remote requests are already refused; try Stop again.", 502);
    }
    this.session = null;
    this.sessionPhase = "inactive";
    this.connection = "disconnected";
    this.lastError = null;
    this.log({ event: reason === "expiry" ? "session.expired" : "session.stopped", sessionId: session.id, phase: "inactive", reason });
    this.changed();
  }

  private expire(session: ActiveSession) {
    // Revoke immediately, even if another lifecycle operation is running; the close follows in turn.
    if (this.session !== session) return;
    this.revoke();
    void this.serialize(async () => {
      if (this.session === session) await this.stopNow("expiry");
    }).catch(() => undefined);
  }

  /** Refuse the marker and end every remote page's open stream: already-open streams would otherwise keep flowing. */
  private revoke() {
    this.markers?.clear();
    const closers = [...this.remoteStreams.values()].flatMap((streams) => {
      const list = [...streams];
      // Emptied first, so each stream's release finds nothing left to count down.
      streams.clear();
      return list;
    });
    this.remoteStreams.clear();
    for (const close of closers) {
      try {
        close();
      } catch {
        // A stream that is already gone needs no ending.
      }
    }
  }

  private connectionChanged(session: ActiveSession, event: RemoteConnectionEvent) {
    if (this.session !== session) return;
    if (event === "reconnecting" && this.sessionPhase === "active") {
      this.sessionPhase = "degraded";
      this.connection = "reconnecting";
      this.log({ event: "session.degraded", sessionId: session.id, phase: "degraded" });
      this.changed();
    } else if (event === "connected" && this.sessionPhase === "degraded") {
      this.sessionPhase = "active";
      this.connection = "connected";
      this.log({ event: "session.reconnected", sessionId: session.id, phase: "active" });
      this.changed();
    }
  }

  private async abandonFailedStart(session: ActiveSession, failure: RemoteAccessFailure) {
    this.revoke();
    const tunnel = session.tunnel;
    if (this.session === session) this.session = null;
    session.tunnel = null;
    if (tunnel) {
      await withTimeout(tunnel.close(), STOP_TIMEOUT_MS).catch(async () => {
        await withTimeout(this.provider?.disconnectAll() ?? Promise.resolve(), 1_000).catch(() => undefined);
      });
    }
    if (this.shuttingDown) return;
    this.sessionPhase = "failed";
    this.connection = "disconnected";
    this.record(failure);
    this.log({ event: "session.failed", sessionId: session.id, phase: "failed", errorCode: failure.code, reason: "startup-failure" });
    this.changed();
  }

  /** The URL comes from ngrok, but it still must be a bare HTTPS origin before staff are told to open it. */
  private validatePublicUrl(raw: string | null): string {
    try {
      const url = new URL(raw ?? "");
      if (url.protocol === "https:" && !url.username && !url.password && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash) {
        return url.origin;
      }
    } catch {
      // Fall through.
    }
    throw new RemoteAccessFailure("REMOTE_ACCESS_PUBLIC_URL_INVALID", "ngrok returned an unexpected address, so remote access was not turned on.", 502);
  }

  private phase(configured: boolean): RemoteAccessPhase {
    if (sessionPhases.has(this.sessionPhase) || this.sessionPhase === "failed") return this.sessionPhase;
    return configured ? "inactive" : "unconfigured";
  }

  private assertNoSession() {
    if (sessionPhases.has(this.sessionPhase) || (this.sessionPhase === "failed" && this.session)) {
      throw new RemoteAccessFailure("REMOTE_ACCESS_BUSY", "Stop remote access before changing the ngrok authtoken.", 409);
    }
  }

  private writeStore(write: () => void) {
    try {
      write();
    } catch (error) {
      if (error instanceof SecretStoreFailure && error.reason === "environment-override") throw this.environmentOverride();
      throw this.record(new RemoteAccessFailure("REMOTE_ACCESS_SECRET_STORE_FAILED", "The ngrok authtoken could not be saved on this computer.", 500));
    }
  }

  private environmentOverride() {
    return new RemoteAccessFailure(
      "REMOTE_ACCESS_CONFIGURED_BY_ENVIRONMENT",
      "The ngrok authtoken is set by the NGROK_AUTHTOKEN environment variable and cannot be changed here.",
      409
    );
  }

  private record(failure: RemoteAccessFailure) {
    this.lastError = { code: failure.code, message: failure.message, at: this.now().toISOString() };
    return failure;
  }

  private changed() {
    try {
      this.onChange();
    } catch {
      // Notifying browsers must never break the lifecycle.
    }
  }

  /** One lifecycle operation at a time, so two browsers cannot interleave a save, a removal, a start, or a stop. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(operation, operation);
    this.lifecycle = run.catch(() => undefined);
    return run;
  }
}
