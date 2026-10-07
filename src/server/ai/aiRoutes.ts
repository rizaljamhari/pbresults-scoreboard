import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { aiProviderIds, aiSettingsUpdateSchema, themeEditRequestSchema, type ThemeEditFailure } from "../../shared/aiAssistant.js";
import { ThemeOpError } from "../../shared/themeOps.js";
import type { AiSettingsStore } from "./aiSettings.js";
import { ChatgptAuthError, type ChatgptAuth } from "./chatgptAuth.js";
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
  timeout: 504,
  "signed-out": 409,
  "plan-limit": 429,
  "not-eligible": 403
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** The small page ChatGPT's sign-in returns to. It lives on the server's own port, so it stays plain HTML. */
function callbackPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16181d;color:#e8e9ec;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:420px;padding:24px}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#a9adb7}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

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

export function registerAiRoutes(
  app: FastifyInstance,
  deps: { settings: AiSettingsStore; chatgptAuth: ChatgptAuth; port: number; isManagementRequest: (request: FastifyRequest) => boolean }
) {
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

  /** Starts "Continue with ChatGPT". The browser opens the returned URL; ChatGPT sends it back to /auth/callback. */
  app.post("/api/ai/chatgpt/sign-in", async (request, reply) => {
    if (!requireManagement(request, reply)) return reply;
    const registration = deps.settings.chatgptRegistration();
    return { url: deps.chatgptAuth.start({ port: deps.port, hostId: deps.settings.hostId(), ...registration }) };
  });

  app.post("/api/ai/chatgpt/sign-out", async (request, reply) => {
    if (!requireManagement(request, reply)) return reply;
    const previous = settings.signOutChatgpt();
    if (previous) void deps.chatgptAuth.revoke(previous);
    return settings.view(true);
  });

  // OpenAI requires exactly http://127.0.0.1:<port>/auth/callback, so this sits outside /api.
  app.get("/auth/callback", async (request, reply) => {
    reply.type("text/html; charset=utf-8");
    if (!deps.isManagementRequest(request)) return reply.code(403).send(callbackPage("Sign-in refused", "ChatGPT can be connected only on the scoreboard computer."));
    try {
      const credentials = await deps.chatgptAuth.finish(request.query as Record<string, string | undefined>);
      settings.saveChatgpt(credentials);
      if (!credentials.scopes.includes("chatgpt.tokens.use.direct")) {
        return callbackPage(
          "Signed in, but plan usage is off",
          `Signed in as ${credentials.account}, but ChatGPT plan usage wasn't allowed. Sign in again and allow it, or use another provider.`
        );
      }
      // Pick a model straight away so the assistant works without another step.
      if (!settings.view(true).providers.find((provider) => provider.id === "chatgpt")?.model) {
        const controller = new AbortController();
        const models = await aiProviders.chatgpt.listModels(settings.config("chatgpt"), controller.signal).catch(() => []);
        if (models[0]) settings.update({ providers: { chatgpt: { model: models[0] } } });
      }
      return callbackPage("Connected to ChatGPT", `Signed in as ${credentials.account}. The theme assistant now uses your ChatGPT plan. You can close this tab.`);
    } catch (error) {
      const message = error instanceof ChatgptAuthError ? error.message : "ChatGPT sign-in failed. Try again from Maintenance → AI assistant.";
      if (!(error instanceof ChatgptAuthError)) request.log.error({ err: error }, "ChatGPT sign-in failed");
      return reply.code(400).send(callbackPage("ChatGPT sign-in didn't finish", message));
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
