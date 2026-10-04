import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  remoteAccessConfigurationRequestSchema,
  remoteAccessRemoveConfigurationRequestSchema
} from "../shared/remoteAccess.js";
import { RemoteAccessFailure, type RemoteAccessService } from "./remoteAccessService.js";

type RemoteAccessRouteOptions = {
  service: RemoteAccessService;
  /** Whether a request comes from the scoreboard computer itself and may manage remote access. */
  isManagementRequest: (request: FastifyRequest) => boolean;
  /** Whether a request arrived through the tunnel. Always false until the ngrok provider exists. */
  isRemoteRequest?: (request: FastifyRequest) => boolean;
};

export function registerRemoteAccessRoutes(app: FastifyInstance, options: RemoteAccessRouteOptions): void {
  const isRemoteRequest = options.isRemoteRequest ?? (() => false);

  const status = (request: FastifyRequest) =>
    options.service.getStatus({
      managementAllowed: options.isManagementRequest(request),
      remoteRequest: isRemoteRequest(request)
    });

  const requireManagement = (request: FastifyRequest, reply: FastifyReply) => {
    if (options.isManagementRequest(request)) return true;
    void reply.code(403).send({
      code: "REMOTE_ACCESS_LOCAL_REQUEST_REQUIRED",
      message: "Remote access can be configured only on the scoreboard computer, from localhost."
    });
    return false;
  };

  app.get("/api/remote-access/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return status(request);
  });

  app.put("/api/remote-access/configuration", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireManagement(request, reply)) return reply;
    // Never echo the parse error: it would describe, and could quote, the token.
    const body = remoteAccessConfigurationRequestSchema.safeParse(request.body);
    if (!body.success) return sendInvalid(reply, "Paste a valid ngrok authtoken and confirm saving it.");
    try {
      await options.service.configure(body.data.authtoken);
      return status(request);
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.delete("/api/remote-access/configuration", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireManagement(request, reply)) return reply;
    const body = remoteAccessRemoveConfigurationRequestSchema.safeParse(request.body);
    if (!body.success) return sendInvalid(reply, "Confirm removing the ngrok configuration.");
    try {
      await options.service.removeConfiguration();
      return status(request);
    } catch (error) {
      return sendFailure(reply, error);
    }
  });
}

function sendInvalid(reply: FastifyReply, message: string) {
  return reply.code(400).send({ code: "REMOTE_ACCESS_INVALID_REQUEST", message });
}

function sendFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof RemoteAccessFailure) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  // Unknown errors may carry provider text; never forward it.
  return reply.code(500).send({ code: "REMOTE_ACCESS_SECRET_STORE_FAILED", message: "Remote access configuration failed." });
}
