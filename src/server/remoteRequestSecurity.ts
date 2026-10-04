import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isLoopbackAddress } from "./updateSecurity.js";

/**
 * The request boundary for remote access (plan sections 12 and 13). ngrok forwards from loopback, so socket address
 * alone cannot tell a tunnelled request from one made on the scoreboard computer. The tunnel's Traffic Policy adds a
 * per-session marker header; this module recognizes it, and everything else asks the predicates here.
 */

export const REMOTE_SESSION_MARKER_HEADER = "x-pbresults-remote-session";
/** The probe route the provider calls through the tunnel before a session is shown as active. */
export const REMOTE_ACCESS_PROBE_PATH = "/api/remote-access/probe";

export type RemoteRequestContext = {
  kind: "ngrok";
  sessionId: string;
  publicOrigin: string;
};

declare module "fastify" {
  interface FastifyRequest {
    /** Set only for requests that arrived through the active remote-access tunnel. */
    remoteAccess: RemoteRequestContext | null;
  }
}

/** 256 bits of Base64URL: 43 characters, never a comma, so a joined duplicate can never look valid. */
const MARKER_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"];
const ONSITE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

type MarkerEntry = RemoteRequestContext & { marker: Buffer; provisional: boolean };

/**
 * The one marker the application currently accepts. The remote-access service owns it: it activates a provisional
 * marker before the public self-probe, confirms it once the probe passes, and clears it first on stop or expiry.
 * Any other marker value is rejected, so a cleared marker fails closed even while the tunnel is still closing.
 */
export class RemoteSessionMarkers {
  private entry: MarkerEntry | null = null;

  activate(options: { sessionId: string; marker: string; publicOrigin: string }) {
    if (!MARKER_FORMAT.test(options.marker)) throw new Error("Remote session marker has the wrong format.");
    this.entry = {
      kind: "ngrok",
      sessionId: options.sessionId,
      publicOrigin: new URL(options.publicOrigin).origin,
      marker: Buffer.from(options.marker, "utf8"),
      provisional: true
    };
  }

  /** The self-probe passed: accept the marker on every route, not only the probe. */
  confirm(sessionId: string) {
    if (this.entry?.sessionId === sessionId) this.entry.provisional = false;
  }

  clear() {
    this.entry = null;
  }

  match(value: string): (RemoteRequestContext & { provisional: boolean }) | null {
    const entry = this.entry;
    if (!entry) return null;
    const candidate = Buffer.from(value, "utf8");
    if (candidate.length !== entry.marker.length || !timingSafeEqual(candidate, entry.marker)) return null;
    return { kind: entry.kind, sessionId: entry.sessionId, publicOrigin: entry.publicOrigin, provisional: entry.provisional };
  }
}

/** Every raw occurrence of a header. Node joins repeated custom headers with ", ", which would hide a duplicate. */
function rawHeaderValues(request: FastifyRequest, name: string): string[] {
  const values: string[] = [];
  const raw = request.raw.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (raw[index].toLowerCase() === name) values.push(raw[index + 1]);
  }
  return values;
}

function requestPath(request: FastifyRequest) {
  const query = request.url.indexOf("?");
  return query === -1 ? request.url : request.url.slice(0, query);
}

function reject(reply: FastifyReply, code: "REMOTE_SESSION_INVALID" | "REMOTE_ACCESS_ORIGIN_REQUIRED", message: string) {
  return reply.code(403).header("Cache-Control", "no-store").send({ code, message });
}

function parseOrigin(value: string): string | null {
  if (value === "null") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Same origin for a local or LAN request: the server speaks plain HTTP, so the origin is http:// plus its Host. */
function localRequestOrigin(request: FastifyRequest): string | null {
  const host = request.headers.host;
  if (!host) return null;
  try {
    return new URL(`http://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Classify every request before anything else runs. Register it before any other hook or route.
 *
 * - No marker header: a local or LAN request, unchanged.
 * - A marker header that is valid for the active session, once, from loopback: a remote request. Its Authorization
 *   header (ngrok's Basic Auth) is deleted here so no later hook, handler, or log ever sees it.
 * - Any other marker header (empty, repeated, malformed, unknown, cleared, from a LAN address): 403, before routing.
 *
 * Then unsafe methods must carry a matching Origin: always the tunnel's public origin for remote requests, and, for
 * local requests that send one, the request's own origin or one of `localOrigins`.
 */
export function registerRemoteRequestBoundary(
  app: FastifyInstance,
  options: {
    markers: RemoteSessionMarkers;
    /** Extra origins local browsers may change things from, such as the dev client whose proxy rewrites Host. */
    localOrigins?: ReadonlySet<string>;
  }
) {
  const localOrigins = options.localOrigins ?? new Set<string>();
  app.decorateRequest("remoteAccess", null);

  app.addHook("onRequest", async (request, reply) => {
    const markerValues = rawHeaderValues(request, REMOTE_SESSION_MARKER_HEADER);
    if (markerValues.length > 0) {
      const match =
        markerValues.length === 1 && isLoopbackAddress(request.socket.remoteAddress) && MARKER_FORMAT.test(markerValues[0])
          ? options.markers.match(markerValues[0])
          : null;
      if (!match || (match.provisional && requestPath(request) !== REMOTE_ACCESS_PROBE_PATH)) {
        return reject(reply, "REMOTE_SESSION_INVALID", "This remote access session is not valid. Ask the scoreboard computer for current access details.");
      }
      request.remoteAccess = { kind: match.kind, sessionId: match.sessionId, publicOrigin: match.publicOrigin };
      delete request.headers.authorization;
    }

    if (!UNSAFE_METHODS.has(request.method)) return;
    const origins = rawHeaderValues(request, "origin");
    if (request.remoteAccess) {
      if (origins.length !== 1 || parseOrigin(origins[0]) !== request.remoteAccess.publicOrigin) {
        return reject(reply, "REMOTE_ACCESS_ORIGIN_REQUIRED", "Changes through remote access must come from the remote access page itself.");
      }
      return;
    }
    // Non-browser local tools send no Origin; keep them working. A browser always sends one on these methods.
    if (origins.length === 0) return;
    const origin = origins.length === 1 ? parseOrigin(origins[0]) : null;
    if (!origin || (origin !== localRequestOrigin(request) && !localOrigins.has(origin))) {
      return reject(reply, "REMOTE_ACCESS_ORIGIN_REQUIRED", "This change was sent from another website and was refused.");
    }
  });

  // Remote API responses may carry settings or status; keep them out of every cache between here and the browser.
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.remoteAccess && requestPath(request).startsWith("/api/") && !reply.hasHeader("cache-control")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });
}

/**
 * Whether a request comes from a browser or tool on the scoreboard computer itself, and may therefore stop, replace,
 * or reconfigure the machine: updates, backup restore and folders, and remote access. Requires all of:
 *
 * - a loopback socket peer
 * - not a remote-access request, and no marker header at all
 * - Host is localhost, 127.0.0.1, or [::1] on one of `ports` (defeats DNS rebinding and tunnel Host headers)
 * - no forwarding headers (Fastify's trustProxy stays off, so these are never interpreted, only refused)
 *
 * The browser-side hostname checks are affordances only; this is the control.
 */
export function isOnsiteManagementRequest(request: FastifyRequest, ports: ReadonlySet<number>): boolean {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
  if (request.remoteAccess || rawHeaderValues(request, REMOTE_SESSION_MARKER_HEADER).length > 0) return false;
  if (FORWARDING_HEADERS.some((name) => request.headers[name] !== undefined)) return false;
  const hosts = rawHeaderValues(request, "host");
  if (hosts.length !== 1) return false;
  try {
    const url = new URL(`http://${hosts[0]}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
    return ONSITE_HOSTNAMES.has(url.hostname) && ports.has(Number(url.port || 80));
  } catch {
    return false;
  }
}

export function isRemoteRequest(request: FastifyRequest): boolean {
  return Boolean(request.remoteAccess);
}
