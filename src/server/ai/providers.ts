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

export type ProviderConfig = { apiKey?: string; model?: string; baseUrl?: string };

export type CompleteInput = {
  config: ProviderConfig;
  system: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  signal: AbortSignal;
};

/** Why a provider call failed, in terms the panel can explain without technical detail. */
export type AiFailureKind = "not-configured" | "bad-key" | "rate-limited" | "model-not-found" | "unreachable" | "refused" | "provider-error";

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
  /** Ollama runs locally and needs an address instead of a key. */
  needs: "apiKey" | "baseUrl";
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
  label: "Claude (Anthropic)",
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
  label: "OpenRouter (free models available)",
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
  label: "Google Gemini (free tier available)",
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
  label: "Ollama (local, free, offline)",
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

export const aiProviders: Record<AiProviderId, AiProvider> = { anthropic, openai, gemini, openrouter, ollama };

// Every id in the shared list has an adapter.
void (aiProviderIds satisfies readonly (keyof typeof aiProviders)[]);
