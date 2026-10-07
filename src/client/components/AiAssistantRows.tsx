import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { api } from "../api";
import { showToast } from "../toast";
import { confirmAction } from "../confirm";
import type { AiProviderId, AiProviderView, AiSettingsUpdate, AiSettingsView } from "../../shared/aiAssistant";
import { Button, Chip, SettingRow } from "./admin/kit";

const SETUP_LINKS: Partial<Record<AiProviderId, { url: string; label: string }>> = {
  chatgpt: { url: "https://chatgpt.com/#settings", label: "ChatGPT settings and usage" },
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "Get a Claude API key" },
  openai: { url: "https://platform.openai.com/api-keys", label: "Get an OpenAI API key" },
  gemini: { url: "https://aistudio.google.com/apikey", label: "Get a free Gemini API key" },
  openrouter: { url: "https://openrouter.ai/settings/keys", label: "Get an OpenRouter API key" },
  ollama: { url: "https://ollama.com/download", label: "Download Ollama" }
};

const OLLAMA_DEFAULT_URL = "http://localhost:11434";
/** How long Settings watches for a ChatGPT sign-in finishing in the other tab. */
const SIGN_IN_WATCH_MS = 5 * 60_000;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Free models first: on OpenRouter they're the reason to pick it. */
function sortModels(models: string[]): string[] {
  return [...models].sort((a, b) => Number(b.endsWith(":free")) - Number(a.endsWith(":free")) || a.localeCompare(b));
}

const rowStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 } as const;

/**
 * The theme AI assistant's providers, drawn as rows inside the Maintenance "AI assistant" group: one line per
 * provider, with only the one being set up opened.
 */
export function AiAssistantRows() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<AiProviderId | null>(null);

  useEffect(() => {
    api.getAiSettings().then(setView, (failure) => setError(errorText(failure, "Couldn't load the AI settings.")));
  }, []);

  async function update(change: AiSettingsUpdate, success?: string) {
    setBusy(true);
    try {
      setView(await api.updateAiSettings(change));
      if (success) showToast({ kind: "success", message: success });
      return true;
    } catch (failure) {
      showToast({ kind: "error", message: errorText(failure, "Couldn't save the AI settings.") });
      return false;
    } finally {
      setBusy(false);
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
            ? `The theme editor's AI assistant uses ${active.label}. It can be changed only on the scoreboard computer.`
            : "The AI assistant isn't set up. It can be set up only on the scoreboard computer."}
        </span>
      </div>
    );
  }

  const configured = view.providers.filter((provider) => provider.configured);

  return (
    <>
      <SettingRow
        title="Provider in use"
        hint="The theme editor's AI assistant sends the theme, any image you attach and a capture of the canvas to this provider. Keys and sign-ins stay on this computer, outside event data and backups."
      >
        <select
          className="ad-select"
          style={{ width: "auto" }}
          aria-label="Provider in use"
          value={view.activeProvider ?? ""}
          disabled={busy || configured.length === 0}
          onChange={(event) => void update({ activeProvider: (event.target.value || null) as AiProviderId | null })}
        >
          <option value="">{configured.length ? "None (assistant off)" : "Set one up below"}</option>
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
          open={open === provider.id}
          busy={busy}
          onToggle={() => setOpen((current) => (current === provider.id ? null : provider.id))}
          onView={setView}
          onSave={(patch, success) =>
            update({ providers: { [provider.id]: patch }, ...(view.activeProvider === null && !patch.remove ? { activeProvider: provider.id } : {}) }, success)
          }
        />
      ))}
    </>
  );
}

type ProviderPatch = { apiKey?: string; model?: string; baseUrl?: string; remove?: boolean };

function ProviderRow({
  provider,
  isActive,
  open,
  busy,
  onToggle,
  onView,
  onSave
}: {
  provider: AiProviderView;
  isActive: boolean;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onView: (view: AiSettingsView) => void;
  onSave: (patch: ProviderPatch, success?: string) => Promise<boolean>;
}) {
  const status = isActive ? (
    <Chip tone="ok">In use</Chip>
  ) : provider.needsSignInAgain ? (
    <Chip tone="warning">Sign in again</Chip>
  ) : provider.configured ? (
    <Chip tone="quiet">Ready</Chip>
  ) : null;

  return (
    <>
      <SettingRow
        title={
          <>
            {provider.label} {status}
          </>
        }
        hint={[provider.tag, provider.configured && provider.account ? provider.account : null].filter(Boolean).join(" · ") || undefined}
      >
        <Button variant={open ? "ghost" : "default"} size="sm" aria-expanded={open} onClick={onToggle}>
          {open ? "Close" : provider.configured ? "Manage" : "Set up"}
        </Button>
      </SettingRow>
      {open ? <ProviderDetails provider={provider} busy={busy} onView={onView} onSave={onSave} /> : null}
    </>
  );
}

function ProviderDetails({
  provider,
  busy,
  onView,
  onSave
}: {
  provider: AiProviderView;
  busy: boolean;
  onView: (view: AiSettingsView) => void;
  onSave: (patch: ProviderPatch, success?: string) => Promise<boolean>;
}) {
  const [editingKey, setEditingKey] = useState(!provider.configured);
  const [keyDraft, setKeyDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState(provider.baseUrl ?? OLLAMA_DEFAULT_URL);
  const [modelDraft, setModelDraft] = useState(provider.model);
  const [models, setModels] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [waitingForSignIn, setWaitingForSignIn] = useState(false);
  const watchRef = useRef<number | null>(null);
  const listId = useId();
  const link = SETUP_LINKS[provider.id];

  useEffect(() => setModelDraft(provider.model), [provider.model]);
  useEffect(() => setEditingKey(!provider.configured), [provider.configured]);
  useEffect(() => () => stopWatching(), []);

  function stopWatching() {
    if (watchRef.current !== null) window.clearInterval(watchRef.current);
    watchRef.current = null;
    setWaitingForSignIn(false);
  }

  /** Lists the models, which proves the key, address or sign-in works. */
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

  async function signIn() {
    try {
      const { url } = await api.startChatgptSignIn();
      window.open(url, "_blank", "noopener");
    } catch (failure) {
      showToast({ kind: "error", message: errorText(failure, "Couldn't start ChatGPT sign-in.") });
      return;
    }
    // The sign-in finishes in the other tab; watch for it here.
    stopWatching();
    setWaitingForSignIn(true);
    const startedAt = Date.now();
    watchRef.current = window.setInterval(async () => {
      if (Date.now() - startedAt > SIGN_IN_WATCH_MS) return stopWatching();
      const next = await api.getAiSettings().catch(() => null);
      const chatgpt = next?.providers.find((entry) => entry.id === "chatgpt");
      if (next && chatgpt?.configured && chatgpt.account) {
        stopWatching();
        onView(next);
        showToast({ kind: "success", message: `Connected to ChatGPT as ${chatgpt.account}.` });
      }
    }, 2000);
  }

  async function signOut() {
    const confirmed = await confirmAction({
      title: "Sign out of ChatGPT?",
      message: "The assistant stops using this ChatGPT plan. You can sign in again at any time.",
      confirmLabel: "Sign out",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      onView(await api.signOutChatgpt());
      showToast({ kind: "success", message: "Signed out of ChatGPT." });
    } catch (failure) {
      showToast({ kind: "error", message: errorText(failure, "Couldn't sign out of ChatGPT.") });
    }
  }

  function saveModel() {
    const model = modelDraft.trim();
    if (model !== provider.model) void onSave({ model }, "Model saved.");
  }

  const onEnter = (event: KeyboardEvent<HTMLInputElement>, action: () => void) => {
    if (event.key === "Enter") {
      event.preventDefault();
      action();
    }
  };
  const disabled = busy || testing;
  const ready = provider.configured && (provider.needs !== "apiKey" || !editingKey);

  return (
    <div className="ad-set-block">
      <p className="ad-hint">{provider.note}</p>

      {provider.needs === "signIn" && !provider.configured ? (
        <div style={rowStyle}>
          <Button variant="primary" disabled={disabled} onClick={() => void signIn()}>
            Continue with ChatGPT
          </Button>
          {waitingForSignIn ? <span className="ad-hint">Finish signing in in the tab that opened…</span> : null}
          {provider.needsSignInAgain && !waitingForSignIn ? <span className="ad-hint">The last sign-in expired.</span> : null}
        </div>
      ) : null}

      {provider.needs === "apiKey" && editingKey ? (
        <div style={rowStyle}>
          <input
            className="ad-input"
            style={{ flex: "1 1 260px", minWidth: 0 }}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${provider.label} API key`}
            placeholder={provider.keyHint ? `Saved key ends in …${provider.keyHint}. Paste a new one to replace it` : "Paste the API key"}
            value={keyDraft}
            disabled={disabled}
            onChange={(event) => setKeyDraft(event.target.value)}
            onKeyDown={(event) => onEnter(event, () => void saveKey())}
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

      {provider.needs === "baseUrl" ? (
        <div style={rowStyle}>
          <input
            className="ad-input"
            style={{ flex: "1 1 260px", minWidth: 0 }}
            spellCheck={false}
            aria-label="Ollama address"
            value={urlDraft}
            disabled={disabled}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => onEnter(event, () => void saveAddress())}
          />
          <Button disabled={!urlDraft.trim() || disabled} onClick={() => void saveAddress()}>
            {testing ? "Testing…" : provider.baseUrl ? "Test again" : "Save and test"}
          </Button>
        </div>
      ) : null}

      {ready ? (
        <div style={rowStyle}>
          <input
            className="ad-input"
            style={{ flex: "1 1 220px", minWidth: 0 }}
            list={listId}
            spellCheck={false}
            aria-label={`${provider.label} model`}
            placeholder={provider.defaultModel ? `Model (default ${provider.defaultModel})` : "Load the list and pick a model"}
            value={modelDraft}
            disabled={disabled}
            onChange={(event) => setModelDraft(event.target.value)}
            onBlur={saveModel}
            onKeyDown={(event) => onEnter(event, saveModel)}
          />
          <datalist id={listId}>{models?.map((model) => <option key={model} value={model} />)}</datalist>
          <Button variant="ghost" disabled={disabled} onClick={() => void test()}>
            {testing ? "Loading…" : models ? `${models.length} models` : "Load model list"}
          </Button>
          {provider.needs === "apiKey" ? (
            <Button variant="ghost" disabled={disabled} onClick={() => setEditingKey(true)}>
              Replace key
            </Button>
          ) : null}
          {provider.needs === "signIn" ? (
            <Button variant="danger" disabled={disabled} onClick={() => void signOut()}>
              Sign out
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={disabled}
              onClick={async () => {
                const confirmed = await confirmAction({
                  title: `Remove ${provider.label}?`,
                  message: provider.needs === "apiKey" ? "The saved key is deleted from this computer." : "The saved address and model are forgotten.",
                  confirmLabel: "Remove",
                  tone: "danger"
                });
                if (confirmed) void onSave({ remove: true }, `${provider.label} removed.`);
              }}
            >
              Remove
            </Button>
          )}
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
