import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  REMOTE_ACCESS_CONFIRMATIONS,
  remoteAccessConfigurationRequestSchema,
  remoteAccessRemoveConfigurationRequestSchema,
  remoteAccessStartRequestSchema,
  remoteAccessStopRequestSchema
} from "../shared/remoteAccess.js";
import { RemoteAccessFailure, type RemoteAccessService } from "./remoteAccessService.js";
import { REMOTE_ACCESS_PROBE_PATH } from "./remoteRequestSecurity.js";

type RemoteAccessRouteOptions = {
  service: RemoteAccessService;
  /** Whether a request comes from the scoreboard computer itself and may manage remote access. */
  isManagementRequest: (request: FastifyRequest) => boolean;
  /** Whether a request arrived through the tunnel. */
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
      message: "Remote access can be managed only on the scoreboard computer, from localhost."
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

  app.post("/api/remote-access/start", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireManagement(request, reply)) return reply;
    const body = remoteAccessStartRequestSchema.safeParse(request.body);
    if (!body.success) {
      const confirmed = (request.body as { confirmation?: unknown } | undefined)?.confirmation === REMOTE_ACCESS_CONFIRMATIONS.start;
      return confirmed
        ? reply.code(400).send({ code: "REMOTE_ACCESS_INVALID_DURATION", message: "Choose one of the offered session lengths." })
        : sendInvalid(reply, "Confirm starting remote access.");
    }
    try {
      await options.service.start(body.data.durationMinutes);
      return reply.code(201).send(status(request));
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.post("/api/remote-access/stop", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireManagement(request, reply)) return reply;
    const body = remoteAccessStopRequestSchema.safeParse(request.body);
    if (!body.success) return sendInvalid(reply, "Confirm stopping remote access.");
    try {
      await options.service.stop("manual");
      return status(request);
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  // Internal: the server calls this through its own public URL while starting. It answers only for that session's
  // provisional marker, after the boundary has stripped Basic Auth, and only when the request really came via ngrok.
  app.get(REMOTE_ACCESS_PROBE_PATH, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const remote = request.remoteAccess;
    const accepted =
      remote !== null &&
      remote !== undefined &&
      !options.isManagementRequest(request) &&
      options.service.acceptProbe({
        sessionId: remote.sessionId,
        authorizationPresent: request.headers.authorization !== undefined,
        forwardedProto: typeof request.headers["x-forwarded-proto"] === "string" ? request.headers["x-forwarded-proto"] : undefined
      });
    return accepted ? reply.code(204).send() : reply.code(404).send({ message: "Not found" });
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
  return reply.code(500).send({ code: "REMOTE_ACCESS_PROVIDER_UNAVAILABLE", message: "Remote access failed." });
}
