/**
 * The theme AI assistant's provider settings and keys. Stored as plain text in secrets/, like the ngrok token (plan
 * §4): outside data/, so they never reach exports or backups. This module is the one place to change if they ever
 * need protecting at rest.
 */
import fs from "node:fs";
import { z } from "zod";
import { aiProviderIds, type AiProviderId, type AiSettingsUpdate, type AiSettingsView } from "../../shared/aiAssistant.js";
import { writeSecretFile } from "../remoteAccessSecrets.js";
import { aiProviders, type ProviderConfig } from "./providers.js";

const providerConfigSchema = z.object({ apiKey: z.string().optional(), model: z.string().optional(), baseUrl: z.string().optional() });

const settingsFileSchema = z.object({
  version: z.literal(1),
  protection: z.literal("none"),
  activeProvider: z.enum(aiProviderIds).nullable(),
  providers: z.record(z.enum(aiProviderIds), providerConfigSchema).default({})
});
type SettingsFile = z.infer<typeof settingsFileSchema>;

const providerNotes: Record<AiProviderId, string> = {
  anthropic: "Paid per request. Usually the best results on theme edits.",
  openai: "Paid per request.",
  gemini: "The free tier needs only a Google AI Studio key. Google may use free-tier requests to improve its models.",
  openrouter: "Choose a model ending in “:free” to pay nothing. Free models are limited to about 50 requests a day.",
  ollama: "Runs on this computer: free, private and works offline. Needs a capable PC, and results are weaker than the online providers."
};

export interface AiSettingsStore {
  view(canManage: boolean): AiSettingsView;
  /** The active provider and its config, or null when none is chosen. */
  active(): { id: AiProviderId; config: ProviderConfig } | null;
  config(id: AiProviderId): ProviderConfig;
  update(change: AiSettingsUpdate): void;
}

function emptySettings(): SettingsFile {
  return { version: 1, protection: "none", activeProvider: null, providers: {} };
}

export function createAiSettingsStore(options: { filePath: string } | { memory: true }): AiSettingsStore {
  let memory = emptySettings();

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

  function isConfigured(id: AiProviderId, config: ProviderConfig | undefined) {
    return Boolean(aiProviders[id].needs === "baseUrl" ? config?.baseUrl : config?.apiKey);
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
            keyHint: config?.apiKey ? config.apiKey.slice(-4) : null,
            baseUrl: config?.baseUrl ?? null,
            model: config?.model || provider.defaultModel,
            defaultModel: provider.defaultModel,
            note: providerNotes[id]
          };
        })
      };
    },
    active() {
      const settings = read();
      if (!settings.activeProvider) return null;
      return { id: settings.activeProvider, config: settings.providers[settings.activeProvider] ?? {} };
    },
    config(id) {
      return read().providers[id] ?? {};
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
    }
  };
}
