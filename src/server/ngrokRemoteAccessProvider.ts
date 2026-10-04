import { REMOTE_SESSION_MARKER_HEADER } from "./remoteRequestSecurity.js";
import { RemoteAccessFailure } from "./remoteAccessErrors.js";

/**
 * Everything that touches the ngrok SDK (plan sections 8 and 11). The SDK is a native module, loaded only when an
 * operator tests a token or starts a session, never at server startup.
 */

export type RemoteConnectionEvent = "reconnecting" | "connected";

export type RemoteTunnel = {
  /** The endpoint's public URL, exactly as ngrok reported it. */
  url: string | null;
  close(): Promise<void>;
};

export type OpenTunnelOptions = {
  authtoken: string;
  /** The scoreboard's port; the tunnel forwards only to 127.0.0.1 on it. */
  port: number;
  trafficPolicy: string;
  appVersion: string;
  onConnection: (event: RemoteConnectionEvent) => void;
};

export interface RemoteAccessProvider {
  /** Connect a session with no endpoint to prove the token works, then disconnect. */
  verifyAuthtoken(authtoken: string): Promise<void>;
  openTunnel(options: OpenTunnelOptions): Promise<RemoteTunnel>;
  /** Last resort on shutdown: drop every ngrok listener this process holds. */
  disconnectAll(): Promise<void>;
}

export type TrafficPolicySecrets = { username: string; password: string; marker: string };

/**
 * One policy per session, built in memory and never logged. Rule order matters: authenticate first, so nothing about
 * the routes leaks to strangers; then refuse machine-lifecycle changes at the edge; then mark what is left so the
 * application can recognize it. Uses only free actions (basic-auth, deny, add-headers) and 3 of the 5 free rules.
 * The application enforces the same route boundary again; this is defense in depth.
 */
export function buildTrafficPolicy(secrets: TrafficPolicySecrets): string {
  const unsafe = "req.method in ['POST', 'PUT', 'PATCH', 'DELETE']";
  const lifecycle = [
    "req.url.path.startsWith('/api/remote-access/')",
    "req.url.path.startsWith('/api/update/')",
    "req.url.path == '/api/backups/config'",
    "req.url.path == '/api/app/import'",
    "(req.url.path.startsWith('/api/backups/') && req.url.path.endsWith('/restore'))"
  ].join(" || ");
  return JSON.stringify({
    on_http_request: [
      {
        name: "authenticate",
        actions: [{ type: "basic-auth", config: { realm: "PBResults Scoreboard", credentials: [`${secrets.username}:${secrets.password}`], enforce: true } }]
      },
      {
        name: "onsite-only",
        expressions: [`${unsafe} && (${lifecycle})`],
        actions: [{ type: "deny", config: { status_code: 403 } }]
      },
      {
        name: "mark-session",
        actions: [{ type: "add-headers", config: { headers: { [REMOTE_SESSION_MARKER_HEADER]: secrets.marker } } }]
      }
    ]
  });
}

type NgrokModule = typeof import("@ngrok/ngrok");

let sdk: Promise<NgrokModule> | null = null;

function loadSdk(): Promise<NgrokModule> {
  sdk ??= import("@ngrok/ngrok").catch(() => {
    sdk = null;
    throw new RemoteAccessFailure(
      "REMOTE_ACCESS_NATIVE_MODULE_UNAVAILABLE",
      "The ngrok component could not be loaded on this computer. Install the Microsoft Visual C++ Redistributable (x64) and restart the scoreboard.",
      503
    );
  });
  return sdk;
}

/** Bounded wait; the timer never keeps the process alive. */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Turn an SDK error into a stable, secret-free failure. The raw text can contain the token or policy, so it is only
 * pattern-matched, never returned or logged.
 */
export function classifyProviderError(error: unknown, stage: "verify" | "open"): RemoteAccessFailure {
  if (error instanceof RemoteAccessFailure) return error;
  const text = error instanceof Error ? error.message : String(error);
  if (/ERR_NGROK_10[5-7]\b|ERR_NGROK_4018\b|authtoken|authentication failed/i.test(text)) {
    return new RemoteAccessFailure("REMOTE_ACCESS_TOKEN_INVALID", "ngrok rejected the authtoken. Copy it again from the ngrok dashboard.", 400);
  }
  if (stage === "open" && /ERR_NGROK_(22\d\d|23\d\d)\b|traffic.?policy|policy/i.test(text)) {
    return new RemoteAccessFailure("REMOTE_ACCESS_POLICY_REJECTED", "ngrok refused the access rules for this session.", 502);
  }
  if (/ERR_NGROK_108\b|limit|quota|simultaneous/i.test(text)) {
    return new RemoteAccessFailure(
      "REMOTE_ACCESS_PROVIDER_UNAVAILABLE",
      "The ngrok account has reached a plan limit, or is already in use by another agent.",
      502
    );
  }
  return new RemoteAccessFailure("REMOTE_ACCESS_PROVIDER_UNAVAILABLE", "ngrok could not be reached. Check this computer's internet connection.", 502);
}

const VERIFY_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 20_000;

export function createNgrokProvider(): RemoteAccessProvider {
  const timeoutFailure = () =>
    new RemoteAccessFailure("REMOTE_ACCESS_PROVIDER_UNAVAILABLE", "ngrok did not answer in time. Check this computer's internet connection.", 504);

  return {
    async verifyAuthtoken(authtoken) {
      const ngrok = await loadSdk();
      try {
        const session = await withTimeout(new ngrok.SessionBuilder().authtoken(authtoken).connect(), VERIFY_TIMEOUT_MS, timeoutFailure);
        await session.close().catch(() => undefined);
      } catch (error) {
        throw classifyProviderError(error, "verify");
      }
    },

    async openTunnel(options) {
      const ngrok = await loadSdk();
      let session: Awaited<ReturnType<InstanceType<NgrokModule["SessionBuilder"]>["connect"]>> | null = null;
      try {
        session = await withTimeout(
          new ngrok.SessionBuilder()
            .authtoken(options.authtoken)
            .clientInfo("pbresults-scoreboard", options.appVersion)
            .metadata(JSON.stringify({ app: "pbresults-scoreboard" }))
            .handleDisconnection(() => {
              options.onConnection("reconnecting");
              return true;
            })
            .handleHeartbeat(() => options.onConnection("connected"))
            .connect(),
          OPEN_TIMEOUT_MS,
          timeoutFailure
        );
        const listener = await withTimeout(
          session
            .httpEndpoint()
            .scheme("HTTPS")
            .trafficPolicy(options.trafficPolicy)
            .metadata(JSON.stringify({ app: "pbresults-scoreboard" }))
            .listenAndForward(`http://127.0.0.1:${options.port}`),
          OPEN_TIMEOUT_MS,
          timeoutFailure
        );
        const opened = session;
        return {
          url: listener.url(),
          async close() {
            // Closing the session closes its listener too, and ends the control connection.
            await listener.close().catch(() => undefined);
            await opened.close();
          }
        };
      } catch (error) {
        await session?.close().catch(() => undefined);
        throw classifyProviderError(error, "open");
      }
    },

    async disconnectAll() {
      if (!sdk) return;
      const ngrok = await sdk;
      await ngrok.kill().catch(() => undefined);
    }
  };
}
