import { describe, expect, it } from "vitest";
import type { AiProviderId } from "../../shared/aiAssistant";
import { builtinThemes } from "../../shared/builtinThemes";
import { createAiSettingsStore } from "./aiSettings";
import { AiProviderError, aiProviders, type AiProvider, type CompleteInput } from "./providers";
import { parseAnswer, runThemeEdit } from "./themeAssistant";

function fakeProviders(answers: string[]) {
  const calls: CompleteInput[] = [];
  const fake: AiProvider = {
    ...aiProviders.anthropic,
    async complete(input) {
      calls.push(structuredClone({ ...input, signal: undefined }) as unknown as CompleteInput);
      const text = answers.shift();
      if (text === undefined) throw new Error("no more answers");
      return { text, usage: { inputTokens: 100, outputTokens: 10 } };
    }
  };
  return { providers: { ...aiProviders, anthropic: fake } as Record<AiProviderId, AiProvider>, calls };
}

function activeSettings() {
  const settings = createAiSettingsStore({ memory: true });
  settings.update({ activeProvider: "anthropic", providers: { anthropic: { apiKey: "sk-test-1234" } } });
  return settings;
}

const draft = () => structuredClone(builtinThemes[0]) as unknown as Record<string, unknown>;
const signal = new AbortController().signal;
const goodAnswer = JSON.stringify({ summary: "Bigger name.", ops: [{ op: "replace", path: "/components/homeName/fontSize", value: 72 }] });

describe("parseAnswer", () => {
  it("finds the JSON inside code fences or prose", () => {
    expect(parseAnswer("Here you go:\n```json\n" + goodAnswer + "\n```").ops).toHaveLength(1);
  });

  it("explains cut-off and wrongly shaped answers", () => {
    expect(() => parseAnswer('{"summary": "x", "ops": [')).toThrow("no JSON object");
    expect(() => parseAnswer('{"summary": "x", "ops": [}')).toThrow("cut off or malformed");
    expect(() => parseAnswer('{"summary": "x"}')).toThrow("didn't match the edit format");
  });
});

describe("runThemeEdit", () => {
  it("returns checked edits and sends the theme without its versions", async () => {
    const { providers, calls } = fakeProviders([goodAnswer]);
    const result = await runThemeEdit(activeSettings(), { draft: draft(), request: "Make the left name bigger", history: [] }, signal, providers);
    expect(result).toMatchObject({ summary: "Bigger name.", provider: "anthropic", model: "claude-opus-5-5", usage: { inputTokens: 100, outputTokens: 10 } });
    const sent = calls[0].messages.at(-1)!.text;
    expect(sent).toContain("Request: Make the left name bigger");
    expect(sent).not.toContain('"versions"');
  });

  it("retries once with the problem, then succeeds", async () => {
    const { providers, calls } = fakeProviders([JSON.stringify({ summary: "x", ops: [{ op: "replace", path: "/components/homeName/fontSize", value: "huge" }] }), goodAnswer]);
    const result = await runThemeEdit(activeSettings(), { draft: draft(), request: "Bigger", history: [] }, signal, providers);
    expect(result.ops).toHaveLength(1);
    expect(calls[1].messages.at(-1)!.text).toContain("isn't valid");
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it("gives up after a second unusable answer", async () => {
    const { providers } = fakeProviders(["not json", '{"summary": "x", "ops": [{"op": "remove", "path": "/id"}]}']);
    await expect(runThemeEdit(activeSettings(), { draft: draft(), request: "Bigger", history: [] }, signal, providers)).rejects.toThrow("nothing was changed");
  });

  it("tells the AI which earlier changes weren't kept", async () => {
    const { providers, calls } = fakeProviders([goodAnswer]);
    const earlier = { request: "Red scores", summary: "Made scores red.", ops: [{ op: "replace" as const, path: "/components/homeScore/backgroundColor", value: "#f00" }] };
    await runThemeEdit(activeSettings(), { draft: draft(), request: "Bigger", history: [{ ...earlier, kept: false }, { ...earlier, kept: true }] }, signal, providers);
    const notes = calls[0].messages.filter((message) => message.text.includes("didn't keep that change"));
    expect(notes).toHaveLength(1);
  });

  it("refuses when no provider is set up", async () => {
    await expect(runThemeEdit(createAiSettingsStore({ memory: true }), { draft: draft(), request: "x", history: [] }, signal)).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("AI settings", () => {
  it("never shows keys, only their last four characters", () => {
    const view = activeSettings().view(true);
    expect(JSON.stringify(view)).not.toContain("sk-test");
    expect(view.providers.find((provider) => provider.id === "anthropic")).toMatchObject({ configured: true, keyHint: "1234" });
  });

  it("removing the active provider clears the choice", () => {
    const settings = activeSettings();
    settings.update({ providers: { anthropic: { remove: true } } });
    expect(settings.active()).toBeNull();
  });
});
