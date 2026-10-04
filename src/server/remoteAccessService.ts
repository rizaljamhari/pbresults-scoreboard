import {
  REMOTE_ACCESS_PROVIDER,
  type LocalRemoteAccessStatus,
  type RemoteAccessError,
  type RemoteAccessErrorCode,
  type RemoteAccessPhase,
  type RemoteAccessStatus,
  type RemoteConnectionState
} from "../shared/remoteAccess.js";
import { SecretStoreFailure, type RemoteAccessSecretStore } from "./remoteAccessSecrets.js";

export class RemoteAccessFailure extends Error {
  constructor(
    readonly code: RemoteAccessErrorCode,
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

/**
 * Proves an authtoken works before it is saved. Throws a RemoteAccessFailure (TOKEN_INVALID or PROVIDER_UNAVAILABLE)
 * when it does not. The ngrok provider supplies the real check; until then the shape check in the request schema is
 * the only validation.
 */
export type AuthtokenVerifier = (authtoken: string) => Promise<void>;

export const acceptAuthtoken: AuthtokenVerifier = async () => {};

/** Phases where a tunnel may exist, so the token behind it must not change. */
const sessionPhases: ReadonlySet<RemoteAccessPhase> = new Set(["starting", "active", "degraded", "stopping"]);

export class RemoteAccessService {
  private readonly store: RemoteAccessSecretStore;
  private readonly verify: AuthtokenVerifier;
  private readonly now: () => Date;
  /** Volatile by design: a restart always begins unconfigured or inactive. */
  private sessionPhase: RemoteAccessPhase = "inactive";
  private connection: RemoteConnectionState = "disconnected";
  private lastError: RemoteAccessError | null = null;
  private lifecycle: Promise<unknown> = Promise.resolve();

  constructor(options: { store: RemoteAccessSecretStore; verify?: AuthtokenVerifier; now?: () => Date }) {
    this.store = options.store;
    this.verify = options.verify ?? acceptAuthtoken;
    this.now = options.now ?? (() => new Date());
  }

  getStatus(request: { managementAllowed: boolean; remoteRequest: boolean }): RemoteAccessStatus | LocalRemoteAccessStatus {
    const stored = this.store.read();
    const status: RemoteAccessStatus = {
      provider: REMOTE_ACCESS_PROVIDER,
      configured: stored !== null,
      phase: this.phase(stored !== null),
      connection: this.connection,
      managementAllowed: request.managementAllowed,
      remoteRequest: request.remoteRequest,
      url: null,
      startedAt: null,
      expiresAt: null,
      lastError: this.lastError
    };
    if (!request.managementAllowed) return status;
    return { ...status, configurationSource: stored?.source ?? null, credentials: null };
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
    });
  }

  removeConfiguration(): Promise<void> {
    return this.serialize(async () => {
      this.assertNoSession();
      this.writeStore(() => this.store.remove());
      this.lastError = null;
    });
  }

  private phase(configured: boolean): RemoteAccessPhase {
    if (sessionPhases.has(this.sessionPhase) || this.sessionPhase === "failed") return this.sessionPhase;
    return configured ? "inactive" : "unconfigured";
  }

  private assertNoSession() {
    if (sessionPhases.has(this.sessionPhase)) {
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

  /** One lifecycle operation at a time, so two browsers cannot interleave a save, a removal, or (later) a start. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(operation, operation);
    this.lifecycle = run.catch(() => undefined);
    return run;
  }
}
