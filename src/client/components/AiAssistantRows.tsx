import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { api } from "../api";
import { showToast } from "../toast";
import { confirmAction } from "../confirm";
import type { AiProviderId, AiProviderView, AiSettingsUpdate, AiSettingsView } from "../../shared/aiAssistant";
import { Button, Chip, SettingRow } from "./admin/kit";

const KEY_PAGES: Partial<Record<AiProviderId, { url: string; label: string }>> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "Get a Claude API key" },
  openai: { url: "https://platform.openai.com/api-keys", label: "Get an OpenAI API key" },
  gemini: { url: "https://aistudio.google.com/apikey", label: "Get a free Gemini API key" },
  openrouter: { url: "https://openrouter.ai/settings/keys", label: "Get an OpenRouter API key" },
  ollama: { url: "https://ollama.com/download", label: "Download Ollama" }
};

const OLLAMA_DEFAULT_URL = "http://localhost:11434";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Free models first: on OpenRouter they're the reason to pick it. */
function sortModels(models: string[]): string[] {
  return [...models].sort((a, b) => Number(b.endsWith(":free")) - Number(a.endsWith(":free")) || a.localeCompare(b));
}

/** The theme AI assistant's providers and keys, drawn as rows inside the Maintenance "AI assistant" group. */
export function AiAssistantRows() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<AiProviderId | "active" | null>(null);

  useEffect(() => {
    api.getAiSettings().then(setView, (failure) => setError(errorText(failure, "Couldn't load the AI settings.")));
  }, []);

  async function update(change: AiSettingsUpdate, who: AiProviderId | "active", success?: string) {
    setBusy(who);
    try {
      setView(await api.updateAiSettings(change));
      if (success) showToast({ kind: "success", message: success });
      return true;
    } catch (failure) {
      showToast({ kind: "error", message: errorText(failure, "Couldn't save the AI settings.") });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!view) {
    return (
      <div className="ad-callout">
        <Info aria-hidden />
        <span>{error ?? "Loading AI settings…"}</span>
      </div>
    );
  }

  const active = view.providers.find((provider) => provider.id === view.activeProvider) ?? null;

  if (!view.canManage) {
    return (
      <div className="ad-callout">
        <Info aria-hidden />
        <span>
          {active
            ? `The theme editor's AI assistant uses ${active.label}. Keys can be changed only on the scoreboard computer.`
            : "The AI assistant isn't set up. It can be set up only on the scoreboard computer."}
        </span>
      </div>
    );
  }

  const configured = view.providers.filter((provider) => provider.configured);

  return (
    <>
      <div className="ad-set-block">
        <p className="ad-hint">
          The theme editor's AI assistant turns a description ("match this poster", "use Oswald everywhere") into edits you review before they're applied.
          It sends the theme, any image you attach and a capture of the editor canvas to the provider you choose. Keys are saved on this computer only,
          outside event data and backups. Nothing on air depends on the assistant.
        </p>
      </div>
      <SettingRow title="Provider in use" hint={configured.length ? "The assistant uses this one. Set up others below to switch." : "Set up a provider below first."}>
        <select
          className="ad-select"
          style={{ width: "auto" }}
          aria-label="Provider in use"
          value={view.activeProvider ?? ""}
          disabled={busy !== null || configured.length === 0}
          onChange={(event) => void update({ activeProvider: (event.target.value || null) as AiProviderId | null }, "active")}
        >
          <option value="">None (assistant off)</option>
          {configured.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </SettingRow>
      {view.providers.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          isActive={provider.id === view.activeProvider}
          busy={busy !== null}
          onSave={(patch, success) =>
            update(
              { providers: { [provider.id]: patch }, ...(view.activeProvider === null && !patch.remove ? { activeProvider: provider.id } : {}) },
              provider.id,
              success
            )
          }
        />
      ))}
    </>
  );
}

function ProviderRow({
  provider,
  isActive,
  busy,
  onSave
}: {
  provider: AiProviderView;
  isActive: boolean;
  busy: boolean;
  onSave: (patch: { apiKey?: string; model?: string; baseUrl?: string; remove?: boolean }, success?: string) => Promise<boolean>;
}) {
  const [editingKey, setEditingKey] = useState(!provider.configured);
  const [keyDraft, setKeyDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState(provider.baseUrl ?? OLLAMA_DEFAULT_URL);
  const [modelDraft, setModelDraft] = useState(provider.model);
  const [models, setModels] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const listId = useId();
  const link = KEY_PAGES[provider.id];

  useEffect(() => setModelDraft(provider.model), [provider.model]);
  useEffect(() => setEditingKey(!provider.configured), [provider.configured]);

  /** Lists the models, which proves the key or address works. */
  async function test(options: { apiKey?: string; baseUrl?: string } = {}) {
    setTesting(true);
    try {
      const { models: found } = await api.listAiModels(provider.id, options);
      setModels(sortModels(found));
      return true;
    } catch (failure) {
      showToast({ kind: "error", message: errorText(failure, `Couldn't reach ${provider.label}.`) });
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function saveKey() {
    const apiKey = keyDraft.trim();
    if (!apiKey || !(await test({ apiKey }))) return;
    if (await onSave({ apiKey }, `${provider.label} connected.`)) {
      setKeyDraft("");
      setEditingKey(false);
    }
  }

  async function saveAddress() {
    const baseUrl = urlDraft.trim();
    if (!baseUrl || !(await test({ baseUrl }))) return;
    await onSave({ baseUrl }, "Ollama connected.");
  }

  function saveModel() {
    const model = modelDraft.trim();
    if (model !== provider.model) void onSave({ model }, "Model saved.");
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, action: () => void) => {
    if (event.key === "Enter") {
      event.preventDefault();
      action();
    }
  };
  const disabled = busy || testing;
  const needsKey = provider.needs === "apiKey";

  return (
    <div className="ad-set-block">
      <b>
        {provider.label} {isActive ? <Chip tone="ok">In use</Chip> : provider.configured && needsKey ? <Chip tone="quiet">Ready</Chip> : null}
      </b>
      <p className="ad-hint">
        {provider.note}
        {needsKey && provider.keyHint ? ` Saved key ends in …${provider.keyHint}.` : ""}
      </p>

      {needsKey && editingKey ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <input
            className="ad-input"
            style={{ flex: "1 1 260px", minWidth: 0 }}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${provider.label} API key`}
            placeholder="Paste the API key"
            value={keyDraft}
            disabled={disabled}
            onChange={(event) => setKeyDraft(event.target.value)}
            onKeyDown={(event) => onKeyDown(event, () => void saveKey())}
          />
          <Button disabled={!keyDraft.trim() || disabled} onClick={() => void saveKey()}>
            {testing ? "Testing…" : "Save and test"}
          </Button>
          {provider.configured ? (
            <Button variant="ghost" disabled={disabled} onClick={() => setEditingKey(false)}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {!needsKey ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <input
            className="ad-input"
            style={{ flex: "1 1 260px", minWidth: 0 }}
            spellCheck={false}
            aria-label="Ollama address"
            value={urlDraft}
            disabled={disabled}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => onKeyDown(event, () => void saveAddress())}
          />
          <Button disabled={!urlDraft.trim() || disabled} onClick={() => void saveAddress()}>
            {testing ? "Testing…" : provider.baseUrl ? "Test again" : "Save and test"}
          </Button>
        </div>
      ) : null}

      {provider.configured && (!needsKey || !editingKey) ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <input
            className="ad-input"
            style={{ flex: "1 1 220px", minWidth: 0 }}
            list={listId}
            spellCheck={false}
            aria-label={`${provider.label} model`}
            placeholder={provider.id === "openrouter" ? "Load the list and pick a model ending in :free" : `Model (default ${provider.defaultModel})`}
            value={modelDraft}
            disabled={disabled}
            onChange={(event) => setModelDraft(event.target.value)}
            onBlur={saveModel}
            onKeyDown={(event) => onKeyDown(event, saveModel)}
          />
          <datalist id={listId}>{models?.map((model) => <option key={model} value={model} />)}</datalist>
          <Button variant="ghost" disabled={disabled} onClick={() => void test()}>
            {testing ? "Loading…" : models ? `${models.length} models loaded` : "Load model list"}
          </Button>
          {needsKey ? (
            <Button variant="ghost" disabled={disabled} onClick={() => setEditingKey(true)}>
              Replace key
            </Button>
          ) : null}
          <Button
            variant="danger"
            disabled={disabled}
            onClick={async () => {
              const confirmed = await confirmAction({
                title: `Remove ${provider.label}?`,
                message: needsKey ? "The saved key is deleted from this computer." : "The saved address and model are forgotten.",
                confirmLabel: "Remove",
                tone: "danger"
              });
              if (confirmed) void onSave({ remove: true }, `${provider.label} removed.`);
            }}
          >
            Remove
          </Button>
        </div>
      ) : null}

      {link ? (
        <div>
          <a className="ad-btn ad-btn--text" href={link.url} target="_blank" rel="noreferrer">
            {link.label}
            <ArrowUpRight aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  );
}
