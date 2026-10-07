import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { aiProviderIds, aiSettingsUpdateSchema, themeEditRequestSchema, type ThemeEditFailure } from "../../shared/aiAssistant.js";
import { ThemeOpError } from "../../shared/themeOps.js";
import type { AiSettingsStore } from "./aiSettings.js";
import { AiProviderError, aiProviders } from "./providers.js";
import { runThemeEdit } from "./themeAssistant.js";

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_IN_FLIGHT = 3;
const MAX_PER_MINUTE = 20;

const statusForKind: Record<string, number> = {
  "not-configured": 409,
  "bad-key": 502,
  "rate-limited": 429,
  "model-not-found": 502,
  unreachable: 502,
  refused: 422,
  "provider-error": 502,
  timeout: 504
};

function sendFailure(reply: FastifyReply, kind: string, message: string) {
  const body: ThemeEditFailure = { kind, message };
  return reply.code(statusForKind[kind] ?? 500).send(body);
}

/** Aborts when the editor gives up (closes the connection) or the request runs too long. */
function requestSignal(reply: FastifyReply): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onClose = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.on("close", onClose);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      reply.raw.off("close", onClose);
    }
  };
}

export function registerAiRoutes(app: FastifyInstance, deps: { settings: AiSettingsStore; isManagementRequest: (request: FastifyRequest) => boolean }) {
  const { settings } = deps;
  let inFlight = 0;
  let recent: number[] = [];

  function requireManagement(request: FastifyRequest, reply: FastifyReply) {
    if (deps.isManagementRequest(request)) return true;
    reply.code(403).send({ message: "AI provider keys can be changed only on the scoreboard computer." });
    return false;
  }

  app.get("/api/ai/settings", async (request) => settings.view(deps.isManagementRequest(request)));

  app.put("/api/ai/settings", async (request, reply) => {
    if (!requireManagement(request, reply)) return reply;
    const change = aiSettingsUpdateSchema.safeParse(request.body);
    if (!change.success) return reply.code(400).send({ message: "Those AI settings aren't valid." });
    settings.update(change.data);
    return settings.view(true);
  });

  /** Lists a provider's models with the saved key, or a key typed but not saved yet. Doubles as the "Test" button. */
  app.post("/api/ai/models", async (request, reply) => {
    if (!requireManagement(request, reply)) return reply;
    const body = z
      .object({ provider: z.enum(aiProviderIds), apiKey: z.string().trim().min(1).optional(), baseUrl: z.string().trim().url().optional() })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Choose a provider." });
    const config = { ...settings.config(body.data.provider), ...(body.data.apiKey ? { apiKey: body.data.apiKey } : {}), ...(body.data.baseUrl ? { baseUrl: body.data.baseUrl } : {}) };
    const { signal, done } = requestSignal(reply);
    try {
      return { models: await aiProviders[body.data.provider].listModels(config, signal) };
    } catch (error) {
      if (error instanceof AiProviderError) return sendFailure(reply, error.kind, error.message);
      throw error;
    } finally {
      done();
    }
  });

  app.post("/api/ai/theme-edit", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const body = themeEditRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ kind: "bad-request", message: "The request to the AI assistant wasn't valid." } satisfies ThemeEditFailure);

    // Stop runaway retries from spending someone's credit.
    const now = Date.now();
    recent = recent.filter((time) => now - time < 60_000);
    if (inFlight >= MAX_IN_FLIGHT || recent.length >= MAX_PER_MINUTE) {
      return sendFailure(reply, "rate-limited", "Too many AI requests at once. Wait a moment and try again.");
    }
    recent.push(now);
    inFlight += 1;

    const { signal, timedOut, done } = requestSignal(reply);
    try {
      return await runThemeEdit(settings, body.data, signal);
    } catch (error) {
      if (timedOut()) return sendFailure(reply, "timeout", "The AI took too long to answer. Try a smaller request, or try again.");
      if (signal.aborted) return reply;
      if (error instanceof AiProviderError) return sendFailure(reply, error.kind, error.message);
      if (error instanceof z.ZodError || error instanceof ThemeOpError) {
        return reply.code(400).send({ kind: "bad-request", message: "The current draft isn't a valid theme, so it can't be sent to the AI. Fix or undo the last change first." } satisfies ThemeEditFailure);
      }
      request.log.error({ err: error }, "theme AI request failed");
      return sendFailure(reply, "provider-error", "Something went wrong talking to the AI. Try again.");
    } finally {
      inFlight -= 1;
      done();
    }
  });
}
