import fs from "node:fs";
import path from "node:path";
import type { RemoteAccessLifecycleEvent } from "./remoteAccessService.js";

/**
 * Append-only remote-access lifecycle log (plan section 21). Each line is one JSON object built from an allowlist of
 * fields, so nothing secret can reach it even if a caller passes more.
 */
export function createLifecycleLog(filePath: string, now: () => Date = () => new Date()) {
  return (event: RemoteAccessLifecycleEvent) => {
    const line = {
      at: now().toISOString(),
      event: event.event,
      sessionId: event.sessionId,
      phase: event.phase,
      ...(event.startedAt !== undefined ? { startedAt: event.startedAt } : {}),
      ...(event.expiresAt !== undefined ? { expiresAt: event.expiresAt } : {}),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      ...(event.reason ? { reason: event.reason } : {})
    };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(line)}\n`, "utf8");
    } catch {
      // The log is diagnostic; failing to write it must never affect a session.
    }
  };
}
