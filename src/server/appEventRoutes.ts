import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type { RuntimeIdentity } from "../shared/appEvents.js";
import type { NormalizedLiveState, OperatorTextState } from "../shared/theme.js";
import { AppEventHub, formatAppEventFrame } from "./appEventHub.js";

type AppEventRouteOptions = {
  hub: AppEventHub;
  openStreams: Set<ServerResponse>;
  getRuntime: () => RuntimeIdentity;
  getLiveState: () => NormalizedLiveState;
  getOperatorTextState: () => OperatorTextState;
};

export function registerAppEventRoutes(app: FastifyInstance, options: AppEventRouteOptions): void {
  app.get("/api/events", async (_request, reply) => {
    if (!options.hub.hasCapacity()) {
      return reply.code(503).send({
        code: "EVENT_STREAM_CAPACITY",
        message: "Too many application event streams are connected."
      });
    }

    let unsubscribe: (() => void) | null = null;
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      options.openStreams.delete(reply.raw);
      unsubscribe?.();
      unsubscribe = null;
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
    writeFrame(
      formatAppEventFrame(
        options.hub.getSnapshot(options.getRuntime(), options.getLiveState(), options.getOperatorTextState()),
        2000
      )
    );
  });
}
