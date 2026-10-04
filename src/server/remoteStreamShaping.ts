import zlib from "node:zlib";

/**
 * Bandwidth shaping for event streams opened through remote access, where every byte counts against the tunnel's
 * quota. Local and LAN streams, including vMix's overlay, never pass through here and stay exactly as they were.
 */

/** Remote pages still see the feed as fresh: their staleness threshold is at least 5 seconds. */
export const REMOTE_LIVE_FRESHNESS_MS = 2_000;

/** A remote stream this far behind is abandoned; the browser reconnects and starts from a fresh snapshot. */
export const REMOTE_STREAM_MAX_BUFFER_BYTES = 1024 * 1024;

export function acceptsGzip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(",") : (header ?? "");
  return value
    .split(",")
    .map((part) => part.trim().split(";"))
    .some(([coding, ...params]) => coding.trim().toLowerCase() === "gzip" && !params.some((param) => /^\s*q\s*=\s*0(\.0*)?\s*$/i.test(param)));
}

/**
 * Decides which frames a remote stream receives. The poller pushes a live state on every poll even when only its
 * timestamp moved; a remote page gets each real change at once, and otherwise one refresh every `freshnessMs` so it
 * keeps showing the feed as current. Every other kind of frame passes untouched.
 */
export function createRemoteLiveStateFilter(options: { now?: () => number; freshnessMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const freshnessMs = options.freshnessMs ?? REMOTE_LIVE_FRESHNESS_MS;
  let lastKey: string | null = null;
  let lastSentAt = -Infinity;
  return (frame: string): boolean => {
    if (!frame.includes("\nevent: live.state\n")) return true;
    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
    let key: string;
    try {
      const event = JSON.parse(dataLine!.slice("data: ".length)) as { state?: { fetchedAt?: unknown } };
      key = JSON.stringify({ ...event.state, fetchedAt: null });
    } catch {
      return true;
    }
    const at = now();
    if (key === lastKey && at - lastSentAt < freshnessMs) return false;
    lastKey = key;
    lastSentAt = at;
    return true;
  };
}

/**
 * A gzip encoder for one event stream. Each frame is flushed immediately, so compression never holds an update
 * back; the shared dictionary across frames is what makes near-identical JSON updates shrink.
 */
export function createFlushingGzip() {
  return zlib.createGzip({ level: zlib.constants.Z_DEFAULT_COMPRESSION });
}

export function writeFlushed(gzip: zlib.Gzip, frame: string) {
  gzip.write(frame);
  gzip.flush(zlib.constants.Z_SYNC_FLUSH);
}
