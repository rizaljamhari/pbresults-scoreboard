import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type { RuntimeIdentity } from "../shared/appEvents.js";
import type { NormalizedLiveState, OperatorTextState } from "../shared/theme.js";
import type { OverlayState } from "../shared/overlayHealth.js";
import type { RehearsalStatus } from "../shared/rehearsal.js";
import { AppEventHub, formatAppEventFrame } from "./appEventHub.js";
import type { OverlayRegistry } from "./overlayRegistry.js";

type AppEventRouteOptions = {
  hub: AppEventHub;
  openStreams: Set<ServerResponse>;
  getRuntime: () => RuntimeIdentity;
  getLiveState: () => NormalizedLiveState;
  getOperatorTextState: () => OperatorTextState;
  /** Overlay pages tag their stream so Operations knows when one closes. */
  overlays?: OverlayRegistry;
  getOverlayState?: () => OverlayState;
  getRehearsalStatus?: () => RehearsalStatus;
};

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function registerAppEventRoutes(app: FastifyInstance, options: AppEventRouteOptions): void {
  app.get("/api/events", async (request, reply) => {
    if (!options.hub.hasCapacity()) {
      return reply.code(503).send({
        code: "EVENT_STREAM_CAPACITY",
        message: "Too many application event streams are connected."
      });
    }

    let unsubscribe: (() => void) | null = null;
    let detachOverlay: (() => void) | null = null;
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      options.openStreams.delete(reply.raw);
      unsubscribe?.();
      unsubscribe = null;
      detachOverlay?.();
      detachOverlay = null;
    };
    const writeFrame = (frame: string) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        cleanup();
        return false;
      }
      const accepted = reply.raw.write(frame);
      if (!accepted) {
        cleanup();
        reply.raw.destroy();
      }
      return accepted;
    };

    unsubscribe = options.hub.subscribe(writeFrame);
    if (!unsubscribe) {
      return reply.code(503).send({
        code: "EVENT_STREAM_CAPACITY",
        message: "Too many application event streams are connected."
      });
    }

    reply.hijack();
    options.openStreams.add(reply.raw);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);
    const query = request.query as { client?: unknown; role?: unknown; page?: unknown } | undefined;
    if (options.overlays && query?.role === "overlay" && typeof query.client === "string" && CLIENT_ID.test(query.client)) {
      detachOverlay = options.overlays.attachStream(query.client, query.page === "preview" ? "preview" : "live", {
        remoteAddress: request.ip,
        userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300)
      });
    }
    writeFrame(
      formatAppEventFrame(
        options.hub.getSnapshot(options.getRuntime(), options.getLiveState(), options.getOperatorTextState(), options.getOverlayState?.(), options.getRehearsalStatus?.()),
        2000
      )
    );
  });
}
