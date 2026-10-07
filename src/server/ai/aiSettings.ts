/**
 * The theme AI assistant's provider settings, keys and ChatGPT sign-in. Stored as plain text in secrets/, like the
 * ngrok token (plan §4): outside data/, so they never reach exports or backups. This module is the one place to change
 * if they ever need protecting at rest.
 */
import fs from "node:fs";
import { z } from "zod";
import { aiProviderIds, type AiProviderId, type AiSettingsUpdate, type AiSettingsView } from "../../shared/aiAssistant.js";
import { writeSecretFile } from "../remoteAccessSecrets.js";
import { ChatgptAuthError, newHostId, PLAN_USAGE_SCOPE, type ChatgptAuth, type ChatgptCredentials } from "./chatgptAuth.js";
import { AiProviderError, aiProviders, type ProviderConfig } from "./providers.js";

const chatgptCredentialsSchema = z.object({
  clientId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  idToken: z.string(),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
  sub: z.string(),
  account: z.string()
});

const providerConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  chatgpt: chatgptCredentialsSchema.optional(),
  /** Set when the sign-in expired or was revoked; the credentials stay so signing in again skips the account picker. */
  chatgptSignedOut: z.boolean().optional(),
  /** The client id OpenAI issued on first sign-in. Kept through sign-out: the app is registered once. */
  chatgptClientId: z.string().optional()
});
type StoredProviderConfig = z.infer<typeof providerConfigSchema>;

const settingsFileSchema = z.object({
  version: z.literal(1),
  protection: z.literal("none"),
  activeProvider: z.enum(aiProviderIds).nullable(),
  providers: z.record(z.enum(aiProviderIds), providerConfigSchema).default({}),
  /** This installation's id for ChatGPT sign-in; OpenAI requires the same one on every sign-in. */
  hostId: z.string().optional()
});
type SettingsFile = z.infer<typeof settingsFileSchema>;

const providerNotes: Record<AiProviderId, string> = {
  chatgpt: "Sign in with a ChatGPT Plus or Pro account and requests count toward that plan, with no API key. You can cap how much this app uses in ChatGPT's settings.",
  anthropic: "Paid per request. Usually the best results on theme edits.",
  openai: "Paid per request.",
  gemini: "The free tier needs only a Google AI Studio key. Google may use free-tier requests to improve its models.",
  openrouter: "Choose a model ending in “:free” to pay nothing. Free models are limited to about 50 requests a day.",
  ollama: "Runs on this computer: free, private and works offline. Needs a capable PC, and results are weaker than the online providers."
};

const providerTags: Record<AiProviderId, string | null> = {
  chatgpt: "Uses your plan",
  anthropic: null,
  openai: null,
  gemini: "Free tier",
  openrouter: "Free models",
  ollama: "Free, offline"
};

/** Refresh a little early so a request never starts with a token about to expire. */
const REFRESH_MARGIN_MS = 2 * 60_000;

export interface AiSettingsStore {
  view(canManage: boolean): AiSettingsView;
  /** The active provider and its config, or null when none is chosen. */
  active(): { id: AiProviderId; config: ProviderConfig } | null;
  config(id: AiProviderId): ProviderConfig;
  update(change: AiSettingsUpdate): void;
  hostId(): string;
  /** What a new sign-in reuses: the issued client id, and the last ID token to skip the account picker. */
  chatgptRegistration(): { clientId?: string; idTokenHint?: string };
  saveChatgpt(credentials: ChatgptCredentials): void;
  signOutChatgpt(): ChatgptCredentials | null;
}

function emptySettings(): SettingsFile {
  return { version: 1, protection: "none", activeProvider: null, providers: {} };
}

function hasPlanUsage(config: StoredProviderConfig | undefined): boolean {
  return Boolean(config?.chatgpt && !config.chatgptSignedOut && config.chatgpt.scopes.includes(PLAN_USAGE_SCOPE));
}

export function createAiSettingsStore(options: ({ filePath: string } | { memory: true }) & { chatgptAuth?: ChatgptAuth }): AiSettingsStore {
  let memory = emptySettings();
  let refreshing: Promise<string> | null = null;

  function read(): SettingsFile {
    if ("memory" in options) return memory;
    try {
      const parsed = settingsFileSchema.safeParse(JSON.parse(fs.readFileSync(options.filePath, "utf8")));
      return parsed.success ? parsed.data : emptySettings();
    } catch {
      // Missing or unreadable: nothing set up yet. Never partially use a damaged file.
      return emptySettings();
    }
  }

  function write(settings: SettingsFile) {
    if ("memory" in options) {
      memory = settings;
      return;
    }
    writeSecretFile(options.filePath, `${JSON.stringify(settings, null, 2)}\n`);
  }

  function isConfigured(id: AiProviderId, config: StoredProviderConfig | undefined) {
    const needs = aiProviders[id].needs;
    if (needs === "signIn") return hasPlanUsage(config);
    return Boolean(needs === "baseUrl" ? config?.baseUrl : config?.apiKey);
  }

  function markChatgptSignedOut() {
    const settings = read();
    const config = settings.providers.chatgpt;
    if (!config) return;
    settings.providers.chatgpt = { ...config, chatgptSignedOut: true };
    write(settings);
  }

  /** A current access token for the ChatGPT sign-in, refreshing it first when it's about to expire. */
  async function chatgptAccessToken(): Promise<string> {
    const config = read().providers.chatgpt;
    if (!config?.chatgpt || config.chatgptSignedOut) {
      throw new AiProviderError("signed-out", "ChatGPT isn't signed in. Continue with ChatGPT in Maintenance → AI assistant.");
    }
    if (config.chatgpt.expiresAt - REFRESH_MARGIN_MS > Date.now()) return config.chatgpt.accessToken;
    if (!options.chatgptAuth) throw new AiProviderError("signed-out", "ChatGPT sign-in has expired.");
    const auth = options.chatgptAuth;
    const current = config.chatgpt;
    // One refresh at a time: refresh tokens rotate, so two at once would sign the person out.
    refreshing ??= auth
      .refresh(current)
      .then((next) => {
        const settings = read();
        settings.providers.chatgpt = { ...settings.providers.chatgpt, chatgpt: next, chatgptSignedOut: false };
        write(settings);
        return next.accessToken;
      })
      .catch((error: unknown) => {
        if (error instanceof ChatgptAuthError && error.kind === "signed-out") {
          markChatgptSignedOut();
          throw new AiProviderError("signed-out", error.message);
        }
        if (error instanceof ChatgptAuthError) throw new AiProviderError(error.kind === "unreachable" ? "unreachable" : "provider-error", error.message);
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  function providerConfig(id: AiProviderId, stored: StoredProviderConfig | undefined): ProviderConfig {
    const { apiKey, model, baseUrl } = stored ?? {};
    if (id !== "chatgpt") return { apiKey, model, baseUrl };
    return { model, accessToken: chatgptAccessToken, onSignedOut: markChatgptSignedOut };
  }

  return {
    view(canManage) {
      const settings = read();
      return {
        activeProvider: settings.activeProvider,
        canManage,
        providers: aiProviderIds.map((id) => {
          const provider = aiProviders[id];
          const config = settings.providers[id];
          return {
            id,
            label: provider.label,
            needs: provider.needs,
            configured: isConfigured(id, config),
            tag: providerTags[id],
            keyHint: config?.apiKey ? config.apiKey.slice(-4) : null,
            baseUrl: config?.baseUrl ?? null,
            model: config?.model || provider.defaultModel,
            defaultModel: provider.defaultModel,
            note: providerNotes[id],
            account: config?.chatgpt?.account ?? null,
            needsSignInAgain: Boolean(config?.chatgpt && config.chatgptSignedOut)
          };
        })
      };
    },
    active() {
      const settings = read();
      if (!settings.activeProvider) return null;
      return { id: settings.activeProvider, config: providerConfig(settings.activeProvider, settings.providers[settings.activeProvider]) };
    },
    config(id) {
      return providerConfig(id, read().providers[id]);
    },
    update(change) {
      const settings = read();
      for (const [id, patch] of Object.entries(change.providers ?? {}) as [AiProviderId, NonNullable<AiSettingsUpdate["providers"]>[AiProviderId]][]) {
        if (!patch) continue;
        if (patch.remove) {
          delete settings.providers[id];
          if (settings.activeProvider === id) settings.activeProvider = null;
          continue;
        }
        const current = settings.providers[id] ?? {};
        settings.providers[id] = {
          ...current,
          ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey } : {}),
          ...(patch.model !== undefined ? { model: patch.model || undefined } : {}),
          ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {})
        };
      }
      if (change.activeProvider !== undefined) settings.activeProvider = change.activeProvider;
      write(settings);
    },
    hostId() {
      const settings = read();
      if (settings.hostId) return settings.hostId;
      settings.hostId = newHostId();
      write(settings);
      return settings.hostId;
    },
    chatgptRegistration() {
      const config = read().providers.chatgpt;
      return { clientId: config?.chatgpt?.clientId ?? config?.chatgptClientId, idTokenHint: config?.chatgpt?.idToken };
    },
    saveChatgpt(credentials) {
      const settings = read();
      settings.providers.chatgpt = { ...settings.providers.chatgpt, chatgpt: credentials, chatgptSignedOut: false, chatgptClientId: credentials.clientId };
      // The first provider set up becomes the one in use.
      if (settings.activeProvider === null && credentials.scopes.includes(PLAN_USAGE_SCOPE)) settings.activeProvider = "chatgpt";
      write(settings);
    },
    signOutChatgpt() {
      const settings = read();
      const config = settings.providers.chatgpt;
      const previous = config?.chatgpt ?? null;
      settings.providers.chatgpt = { model: config?.model, chatgptClientId: previous?.clientId ?? config?.chatgptClientId };
      if (settings.activeProvider === "chatgpt") settings.activeProvider = null;
      write(settings);
      return previous;
    }
  };
}
