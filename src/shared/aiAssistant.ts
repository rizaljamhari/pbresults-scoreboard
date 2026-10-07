/** What the theme AI assistant's editor panel, Settings section and server share. Keys never appear here. */
import { z } from "zod";
import { themeOpSchema } from "./themeOps.js";

export const aiProviderIds = ["chatgpt", "anthropic", "openai", "gemini", "openrouter", "ollama"] as const;
export type AiProviderId = (typeof aiProviderIds)[number];

/** One provider as Settings sees it: whether it's set up, never the key itself. */
export type AiProviderView = {
  id: AiProviderId;
  label: string;
  /** What setting it up takes: a pasted key, a local address, or signing in with ChatGPT. */
  needs: "apiKey" | "baseUrl" | "signIn";
  configured: boolean;
  /** A short cost note for the collapsed row, such as "Free tier" or "Uses your plan". */
  tag: string | null;
  /** The signed-in account, for ChatGPT. */
  account: string | null;
  /** Signed in before, but the sign-in expired or was revoked: show "Continue with ChatGPT" again. */
  needsSignInAgain: boolean;
  /** The last four characters of the key, so the designer can tell which key is saved. */
  keyHint: string | null;
  baseUrl: string | null;
  model: string;
  defaultModel: string;
  /** Plain-language note shown under the provider, such as how its free tier treats data. */
  note: string;
};

export type AiSettingsView = {
  activeProvider: AiProviderId | null;
  providers: AiProviderView[];
  /** False for remote staff: they can use the assistant but not see or change keys. */
  canManage: boolean;
};

export const aiSettingsUpdateSchema = z.object({
  activeProvider: z.enum(aiProviderIds).nullable().optional(),
  providers: z
    .record(
      z.enum(aiProviderIds),
      z.object({
        apiKey: z.string().trim().min(1).max(500).optional(),
        model: z.string().trim().max(200).optional(),
        baseUrl: z.string().trim().url().max(500).optional(),
        /** Forget this provider's key, model and address. */
        remove: z.boolean().optional()
      })
    )
    .optional()
});
export type AiSettingsUpdate = z.infer<typeof aiSettingsUpdateSchema>;

const imageSchema = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  /** Base64 without the data: prefix. */
  data: z.string().min(1).max(6_000_000)
});

export const themeEditRequestSchema = z.object({
  /** The editor's current draft, including any manual edits since the last request. */
  draft: z.record(z.string(), z.unknown()),
  request: z.string().trim().min(1).max(4000),
  /** Earlier turns of this editor session's thread, oldest first. */
  history: z
    .array(z.object({ request: z.string().max(4000), summary: z.string().max(2000), ops: z.array(themeOpSchema).max(200) }))
    .max(20)
    .default([]),
  reference: imageSchema.optional(),
  preview: imageSchema.optional(),
  /** The piece selected in the editor; the AI keeps its changes to it unless asked otherwise. */
  focusPieceId: z.string().max(200).optional()
});
export type ThemeEditRequest = z.input<typeof themeEditRequestSchema>;

export type ThemeEditResponse = {
  summary: string;
  ops: z.infer<typeof themeOpSchema>[];
  provider: AiProviderId;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
};

/** The error body for a failed assistant request; `kind` lets the panel pick its wording and next step. */
export type ThemeEditFailure = { kind: string; message: string };
