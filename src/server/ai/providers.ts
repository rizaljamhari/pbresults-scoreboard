/**
 * One adapter per AI provider behind a single interface, so the theme assistant doesn't care who answers. Claude goes
 * through Anthropic's SDK; the others are plain HTTP. Every provider is asked for JSON in the prompt and the answer is
 * validated by our own code, which works the same everywhere.
 */
import Anthropic from "@anthropic-ai/sdk";
import { aiProviderIds, type AiProviderId } from "../../shared/aiAssistant.js";

export type AiImage = { mediaType: "image/png" | "image/jpeg" | "image/webp"; data: string };
export type AiMessage = { role: "user" | "assistant"; text: string; images?: AiImage[] };
export type AiUsage = { inputTokens: number; outputTokens: number };
export type AiCompletion = { text: string; usage: AiUsage | null };

export type ProviderConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** ChatGPT sign-in: a current access token, refreshed by the settings store when needed. */
  accessToken?: () => Promise<string>;
  /** ChatGPT sign-in: OpenAI rejected the token, so the person has to sign in again. */
  onSignedOut?: () => void;
};

export type CompleteInput = {
  config: ProviderConfig;
  system: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  signal: AbortSignal;
};

/** Why a provider call failed, in terms the panel can explain without technical detail. */
export type AiFailureKind =
  | "not-configured"
  | "bad-key"
  | "rate-limited"
  | "model-not-found"
  | "unreachable"
  | "refused"
  | "provider-error"
  | "signed-out"
  | "plan-limit"
  | "not-eligible";

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    message: string
  ) {
    super(message);
  }
}

export interface AiProvider {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  /** Ollama runs locally and needs an address instead of a key; ChatGPT needs a sign-in. */
  needs: "apiKey" | "baseUrl" | "signIn";
  complete(input: CompleteInput): Promise<AiCompletion>;
  listModels(config: ProviderConfig, signal: AbortSignal): Promise<string[]>;
}

function unreachable(provider: string): AiProviderError {
  return provider === "Ollama"
    ? new AiProviderError("unreachable", "Couldn't reach Ollama. Check that it's running and the address in Settings is right.")
    : new AiProviderError("unreachable", `Couldn't reach ${provider}. Check the internet connection.`);
}

function failureForStatus(provider: string, status: number, detail: string): AiProviderError {
  if (status === 401 || status === 403) return new AiProviderError("bad-key", `${provider} rejected the API key.`);
  if (status === 429) return new AiProviderError("rate-limited", `${provider}'s rate limit is reached. Wait a minute and try again.`);
  if (status === 404) return new AiProviderError("model-not-found", `${provider} doesn't have that model. Pick another in Settings.`);
  return new AiProviderError("provider-error", `${provider} returned an error (${status})${detail ? `: ${detail.slice(0, 200)}` : "."}`);
}

async function postJson(provider: string, url: string, init: { headers: Record<string, string>; body: unknown; signal: AbortSignal }): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...init.headers }, body: JSON.stringify(init.body), signal: init.signal });
  } catch (error) {
    if (init.signal.aborted) throw error;
    throw unreachable(provider);
  }
  if (!response.ok) throw failureForStatus(provider, response.status, await response.text().catch(() => ""));
  return response.json();
}

async function getJson(provider: string, url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw unreachable(provider);
  }
  if (!response.ok) throw failureForStatus(provider, response.status, await response.text().catch(() => ""));
  return response.json();
}

function requireModel(provider: string, config: ProviderConfig, fallback: string): string {
  const model = config.model || fallback;
  if (!model) throw new AiProviderError("not-configured", `Pick a ${provider} model in Settings.`);
  return model;
}

function requireKey(provider: string, config: ProviderConfig): string {
  if (!config.apiKey) throw new AiProviderError("not-configured", `${provider} has no API key yet. Add one in Settings.`);
  return config.apiKey;
}

// --- Anthropic (Claude) ---

/** Models that take effort and the server-side refusal fallback. Older ones reject both. */
function isCurrentClaude(model: string) {
  return /^claude-(opus|sonnet|fable)-5/.test(model);
}

const anthropic: AiProvider = {
  id: "anthropic",
  label: "Claude",
  defaultModel: "claude-opus-5-5",
  needs: "apiKey",
  async complete({ config, system, messages, maxOutputTokens, signal }) {
    const client = new Anthropic({ apiKey: requireKey("Anthropic", config), maxRetries: 1 });
    const model = config.model || anthropic.defaultModel;
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxOutputTokens,
      // The instructions and theme reference are identical on every request, so they're cached.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: messages.map((message) => ({
        role: message.role,
        content: [
          ...(message.images ?? []).map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } })),
          { type: "text" as const, text: message.text }
        ]
      }))
    };
    if (isCurrentClaude(model)) {
      Object.assign(params, { output_config: { effort: "medium" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    }
    try {
      const response = await client.beta.messages.create(params, { signal });
      if (response.stop_reason === "refusal") throw new AiProviderError("refused", "Claude declined this request. Try rephrasing it.");
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      const usage = response.usage;
      return { text, usage: { inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), outputTokens: usage.output_tokens } };
    } catch (error) {
      throw anthropicFailure(error, signal);
    }
  },
  async listModels(config, signal) {
    const client = new Anthropic({ apiKey: requireKey("Anthropic", config), maxRetries: 0 });
    try {
      const models: string[] = [];
      for await (const model of client.models.list({ limit: 100 }, { signal })) models.push(model.id);
      return models;
    } catch (error) {
      throw anthropicFailure(error, signal);
    }
  }
};

function anthropicFailure(error: unknown, signal: AbortSignal): unknown {
  if (error instanceof AiProviderError || signal.aborted) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return failureForStatus("Anthropic", 401, "");
  if (error instanceof Anthropic.RateLimitError) return failureForStatus("Anthropic", 429, "");
  if (error instanceof Anthropic.NotFoundError) return failureForStatus("Anthropic", 404, "");
  if (error instanceof Anthropic.APIConnectionError) return new AiProviderError("unreachable", "Couldn't reach Anthropic. Check the internet connection.");
  if (error instanceof Anthropic.APIError) return failureForStatus("Anthropic", error.status ?? 500, error.message);
  return error;
}

// --- OpenAI and OpenRouter (same request format) ---

type ChatCompletion = { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

function chatCompletionsProvider(options: { id: "openai" | "openrouter"; label: string; name: string; baseUrl: string; defaultModel: string; maxTokensField: string; headers?: Record<string, string> }): AiProvider {
  return {
    id: options.id,
    label: options.label,
    defaultModel: options.defaultModel,
    needs: "apiKey",
    async complete({ config, system, messages, maxOutputTokens, signal }) {
      const key = requireKey(options.name, config);
      const body = {
        model: requireModel(options.name, config, options.defaultModel),
        [options.maxTokensField]: maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          ...messages.map((message) => ({
            role: message.role,
            content: [
              ...(message.images ?? []).map((image) => ({ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } })),
              { type: "text", text: message.text }
            ]
          }))
        ]
      };
      const answer = (await postJson(options.name, `${options.baseUrl}/chat/completions`, { headers: { authorization: `Bearer ${key}`, ...options.headers }, body, signal })) as ChatCompletion;
      const choice = answer.choices?.[0];
      if (choice?.finish_reason === "content_filter") throw new AiProviderError("refused", `${options.name} declined this request. Try rephrasing it.`);
      return { text: choice?.message?.content ?? "", usage: answer.usage ? { inputTokens: answer.usage.prompt_tokens ?? 0, outputTokens: answer.usage.completion_tokens ?? 0 } : null };
    },
    async listModels(config, signal) {
      const key = requireKey(options.name, config);
      const answer = (await getJson(options.name, `${options.baseUrl}/models`, { authorization: `Bearer ${key}` }, signal)) as { data?: { id: string }[] };
      return (answer.data ?? []).map((model) => model.id).sort();
    }
  };
}

const openai = chatCompletionsProvider({ id: "openai", label: "OpenAI", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5", maxTokensField: "max_completion_tokens" });

const openrouter = chatCompletionsProvider({
  id: "openrouter",
  label: "OpenRouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  // Free models come and go, so the designer picks one from the live list instead of us guessing.
  defaultModel: "",
  maxTokensField: "max_tokens",
  headers: { "x-title": "PBResults Scoreboard" }
});

// --- Google Gemini ---

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

const gemini: AiProvider = {
  id: "gemini",
  label: "Google Gemini",
  defaultModel: "gemini-3-flash",
  needs: "apiKey",
  async complete({ config, system, messages, maxOutputTokens, signal }) {
    const key = requireKey("Gemini", config);
    const model = config.model || gemini.defaultModel;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [...(message.images ?? []).map((image) => ({ inlineData: { mimeType: image.mediaType, data: image.data } })), { text: message.text }]
      })),
      generationConfig: { responseMimeType: "application/json", maxOutputTokens }
    };
    const answer = (await postJson("Gemini", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      headers: { "x-goog-api-key": key },
      body,
      signal
    })) as GeminiResponse;
    const candidate = answer.candidates?.[0];
    if (answer.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") throw new AiProviderError("refused", "Gemini declined this request. Try rephrasing it.");
    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");
    const usage = answer.usageMetadata;
    return { text, usage: usage ? { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 } : null };
  },
  async listModels(config, signal) {
    const key = requireKey("Gemini", config);
    const answer = (await getJson("Gemini", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key }, signal)) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[];
    };
    return (answer.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => model.name.replace(/^models\//, ""))
      .sort();
  }
};

// --- Ollama (local) ---

const ollamaDefaultUrl = "http://localhost:11434";

const ollama: AiProvider = {
  id: "ollama",
  label: "Ollama",
  defaultModel: "qwen2.5vl",
  needs: "baseUrl",
  async complete({ config, system, messages, maxOutputTokens, signal }) {
    const baseUrl = (config.baseUrl || ollamaDefaultUrl).replace(/\/+$/, "");
    const body = {
      model: config.model || ollama.defaultModel,
      stream: false,
      format: "json",
      // Ollama's default context is too small for a theme plus its reference.
      options: { num_ctx: 32768, num_predict: maxOutputTokens },
      messages: [{ role: "system", content: system }, ...messages.map((message) => ({ role: message.role, content: message.text, images: message.images?.map((image) => image.data) }))]
    };
    const answer = (await postJson("Ollama", `${baseUrl}/api/chat`, { headers: {}, body, signal })) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    return { text: answer.message?.content ?? "", usage: { inputTokens: answer.prompt_eval_count ?? 0, outputTokens: answer.eval_count ?? 0 } };
  },
  async listModels(config, signal) {
    const baseUrl = (config.baseUrl || ollamaDefaultUrl).replace(/\/+$/, "");
    const answer = (await getJson("Ollama", `${baseUrl}/api/tags`, {}, signal)) as { models?: { name: string }[] };
    return (answer.models ?? []).map((model) => model.name).sort();
  }
};

// --- ChatGPT plan (Sign in with ChatGPT) ---
// https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference

const CHATGPT_SETTINGS_HINT = "Check your ChatGPT settings → Usage.";

type ResponsesEvent = {
  type?: string;
  delta?: string;
  code?: string;
  message?: string;
  response?: { usage?: { input_tokens?: number; output_tokens?: number }; error?: { code?: string; message?: string } | null; output?: { content?: { type?: string; text?: string }[] }[] };
};

/** Turns an OpenAI error code from a plan-usage request into something the panel can act on. */
function chatgptFailure(code: string | undefined, status: number, detail: string): AiProviderError {
  if (code === "subscription_sharing_usage_limit_exceeded") {
    return new AiProviderError("plan-limit", `Your ChatGPT plan's limit for this app is reached. ${CHATGPT_SETTINGS_HINT}`);
  }
  if (code === "subscription_sharing_user_not_eligible") {
    return new AiProviderError("not-eligible", "This ChatGPT account can't share its plan with apps. It needs ChatGPT Plus or Pro, and plan sharing turned on.");
  }
  if (status === 401 || code === "insufficient_scope" || code === "invalid_grant" || code === "token_expired") {
    return new AiProviderError("signed-out", "ChatGPT needs you to sign in again. Continue with ChatGPT in Maintenance → AI assistant.");
  }
  return failureForStatus("ChatGPT", status || 500, detail);
}

async function readErrorCode(response: Response): Promise<{ code?: string; detail: string }> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    return { code: body.error?.code, detail: body.error?.message ?? text };
  } catch {
    return { detail: text };
  }
}

/** Reads a Responses API event stream and returns the text once `response.completed` arrives. */
async function readResponsesStream(body: ReadableStream<Uint8Array>): Promise<AiCompletion> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let event: ResponsesEvent;
      try {
        event = JSON.parse(data) as ResponsesEvent;
      } catch {
        continue;
      }
      if (event.type === "response.output_text.delta" && event.delta) text += event.delta;
      if (event.type === "response.failed" || event.type === "error") {
        const error = event.response?.error ?? { code: event.code, message: event.message };
        throw chatgptFailure(error?.code, 0, error?.message ?? "");
      }
      if (event.type === "response.completed") {
        // Only a completed response counts; fall back to the final output if no deltas arrived.
        const finalText = (event.response?.output ?? []).flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
        const usage = event.response?.usage;
        return { text: text || finalText, usage: usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : null };
      }
    }
  }
  throw new AiProviderError("provider-error", "ChatGPT stopped before finishing its answer. Try again.");
}

async function chatgptToken(config: ProviderConfig): Promise<string> {
  if (!config.accessToken) throw new AiProviderError("signed-out", "ChatGPT isn't signed in. Continue with ChatGPT in Maintenance → AI assistant.");
  return config.accessToken();
}

const chatgpt: AiProvider = {
  id: "chatgpt",
  label: "ChatGPT",
  defaultModel: "",
  needs: "signIn",
  async complete({ config, system, messages, maxOutputTokens, signal }) {
    const model = requireModel("ChatGPT", config, "");
    const send = async (withImages: boolean) => {
      const token = await chatgptToken(config);
      const body = {
        model,
        instructions: system,
        input: messages.map((message) =>
          message.role === "assistant"
            ? { role: "assistant", content: [{ type: "output_text", text: message.text }] }
            : {
                role: "user",
                content: [
                  ...(withImages ? (message.images ?? []) : []).map((image) => ({ type: "input_image", image_url: `data:${image.mediaType};base64,${image.data}` })),
                  { type: "input_text", text: message.text }
                ]
              }
        ),
        max_output_tokens: maxOutputTokens,
        // Plan usage requires both: nothing is stored on OpenAI's side, and the answer streams.
        store: false,
        stream: true
      };
      try {
        return await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}`, accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw unreachable("ChatGPT");
      }
    };
    const hasImages = messages.some((message) => message.images?.length);
    let response = await send(true);
    // The docs don't say whether plan usage accepts images; if it refuses them, answer from the text alone.
    if (response.status === 400 && hasImages) response = await send(false);
    if (!response.ok || !response.body) {
      const { code, detail } = await readErrorCode(response);
      const failure = chatgptFailure(code, response.status, detail);
      if (failure.kind === "signed-out") config.onSignedOut?.();
      throw failure;
    }
    return readResponsesStream(response.body);
  },
  async listModels(config, signal) {
    const token = await chatgptToken(config);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${token}` }, signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw unreachable("ChatGPT");
    }
    if (!response.ok) {
      const { code, detail } = await readErrorCode(response);
      const failure = chatgptFailure(code, response.status, detail);
      if (failure.kind === "signed-out") config.onSignedOut?.();
      throw failure;
    }
    // A ChatGPT plan's catalog comes back as `models` with slugs; only "list" entries are meant to be offered.
    const answer = (await response.json()) as { models?: { slug?: string; visibility?: string }[]; data?: { id?: string }[] };
    if (answer.models) return answer.models.filter((model) => model.visibility === undefined || model.visibility === "list").flatMap((model) => (model.slug ? [model.slug] : []));
    return (answer.data ?? []).flatMap((model) => (model.id ? [model.id] : []));
  }
};

export const aiProviders: Record<AiProviderId, AiProvider> = { chatgpt, anthropic, openai, gemini, openrouter, ollama };

// Every id in the shared list has an adapter.
void (aiProviderIds satisfies readonly (keyof typeof aiProviders)[]);
