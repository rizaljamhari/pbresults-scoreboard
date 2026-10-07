/**
 * Turns a designer's request into checked theme edits: builds the prompt, asks the active provider, and validates
 * the answer by applying it to a copy of the draft. One retry, with the errors, when the answer can't be used. The
 * server never saves anything: the editor applies the returned ops to its own draft.
 */
import type { AiProviderId, ThemeEditRequest, ThemeEditResponse } from "../../shared/aiAssistant.js";
import { themeSchema } from "../../shared/theme.js";
import { applyThemeOps, themeEditAnswerSchema, type ThemeEditAnswer } from "../../shared/themeOps.js";
import { themeReference } from "../../shared/themeReference.js";
import type { AiSettingsStore } from "./aiSettings.js";
import { AiProviderError, aiProviders, type AiMessage, type AiProvider, type AiUsage } from "./providers.js";

const MAX_OUTPUT_TOKENS = 16_000;

const instructions = `You help design broadcast scoreboard overlays for paintball streams. The designer describes a change to their theme; you answer with edits to the theme JSON.

Answer with one JSON object and nothing else:
{"summary": "<one or two plain sentences on what you changed, for the designer>", "ops": [<edits>]}

Each edit is one of:
{"op": "replace", "path": "/components/homeName/fontSize", "value": 60}
{"op": "add", "path": "/freeComponents/-", "value": {...a complete new layer...}}
{"op": "remove", "path": "/freeComponents/@sponsor-strip"}

Paths are JSON Pointers into the theme. In a list, "@<id>" picks the item with that id, "-" means "add at the end", and a number is a position. Prefer "@<id>" over positions. Change the smallest thing that does the job: replace one field rather than a whole piece.

Rules:
- Never change ids, and never remove or rename the fixed pieces under "components". Hide them with "visible": false instead.
- New layers need a new unique id and every required field.
- Keep team names readable: they're up to 8 characters long and the overlay sits on top of live video.
- If the designer has selected a piece, change only that piece unless they ask for more.
- When an image is attached, it's either a reference to take the look from or a capture of the current preview; the message says which.
- If something can't be done with the theme's fields, say so in the summary and return no ops. Don't guess.

The theme format:

`;

/** The instructions and theme reference: identical on every request, so providers can cache them. */
export function systemPrompt(): string {
  return instructions + themeReference();
}

/** Pulls the JSON object out of an answer, tolerating code fences or a sentence around it. */
export function parseAnswer(text: string): ThemeEditAnswer {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The answer had no JSON object in it.");
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The answer's JSON was cut off or malformed.");
  }
  const parsed = themeEditAnswerSchema.safeParse(json);
  if (!parsed.success) throw new Error(`The answer didn't match the edit format: ${formatIssues(parsed.error.issues)}`);
  return parsed.data;
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length ? `/${issue.path.join("/")}` : "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Applies the answer to the draft and checks the result is still a valid theme. Throws with errors the AI can fix. */
export function checkAnswer(draft: Record<string, unknown>, answer: ThemeEditAnswer): void {
  const next = applyThemeOps(draft, answer.ops);
  const result = themeSchema.safeParse(next);
  if (!result.success) throw new Error(`The edited theme isn't valid: ${formatIssues(result.error.issues)}`);
}

function describeTurn(request: string, options: { focusPieceId?: string; reference: boolean; preview: boolean }): string {
  const notes: string[] = [];
  if (options.focusPieceId) notes.push(`The designer has selected the piece "${options.focusPieceId}".`);
  if (options.reference && options.preview) notes.push("The first image is the designer's reference; the second is a capture of the current preview.");
  else if (options.reference) notes.push("The image is the designer's reference.");
  else if (options.preview) notes.push("The image is a capture of the current preview.");
  return [...notes, `Request: ${request}`].join("\n");
}

function addUsage(total: AiUsage | null, next: AiUsage | null): AiUsage | null {
  if (!next) return total;
  return { inputTokens: (total?.inputTokens ?? 0) + next.inputTokens, outputTokens: (total?.outputTokens ?? 0) + next.outputTokens };
}

export async function runThemeEdit(
  settings: AiSettingsStore,
  input: ThemeEditRequest & { history: NonNullable<ThemeEditRequest["history"]> },
  signal: AbortSignal,
  providers: Record<AiProviderId, AiProvider> = aiProviders
): Promise<ThemeEditResponse> {
  const active = settings.active();
  if (!active) throw new AiProviderError("not-configured", "No AI provider is set up yet. Choose one in Settings.");
  const provider = providers[active.id];

  // The draft must already be a valid theme: the AI is never asked to fix something it didn't break.
  const draft = themeSchema.parse(input.draft) as Record<string, unknown>;
  const { versions: _versions, ...forAi } = draft;

  const messages: AiMessage[] = [];
  for (const turn of input.history) {
    messages.push({ role: "user", text: `Request: ${turn.request}` });
    messages.push({ role: "assistant", text: JSON.stringify({ summary: turn.summary, ops: turn.ops }) });
  }
  messages.push({
    role: "user",
    text: `${describeTurn(input.request, { focusPieceId: input.focusPieceId, reference: Boolean(input.reference), preview: Boolean(input.preview) })}\n\nThe current theme:\n${JSON.stringify(forAi)}`,
    images: [input.reference, input.preview].filter((image): image is NonNullable<typeof image> => Boolean(image))
  });

  const system = systemPrompt();
  let usage: AiUsage | null = null;
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await provider.complete({ config: active.config, system, messages, maxOutputTokens: MAX_OUTPUT_TOKENS, signal });
    usage = addUsage(usage, completion.usage);
    try {
      const answer = parseAnswer(completion.text);
      checkAnswer(draft, answer);
      return { summary: answer.summary, ops: answer.ops, provider: active.id, model: active.config.model || provider.defaultModel, usage };
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
      messages.push({ role: "assistant", text: completion.text || "(empty answer)" });
      messages.push({ role: "user", text: `That can't be applied. ${lastProblem}\nSend the corrected answer: the whole JSON object again, with every edit.` });
    }
  }
  throw new AiProviderError("provider-error", `The AI's change didn't fit the theme format, so nothing was changed. Try again or rephrase. (${lastProblem})`);
}
