import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useLiveState, useSettings, useThemes } from "../hooks";
import { showToast } from "../toast";
import { areSettingsEqual, createSettingsDraft } from "./settingsFormUtils";

export function SettingsPage() {
  const settings = useSettings();
  const themes = useThemes();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(settings.data ? createSettingsDraft(settings.data) : null);

  const hasUnsavedChanges = useMemo(() => {
    if (!settings.data || !draft) {
      return false;
    }
    return !areSettingsEqual(draft, settings.data);
  }, [draft, settings.data]);

  useEffect(() => {
    if (!settings.data) {
      return;
    }
    if (!draft) {
      setDraft(createSettingsDraft(settings.data));
      return;
    }
    if (!hasUnsavedChanges) {
      setDraft(createSettingsDraft(settings.data));
    }
  }, [settings.data, draft, hasUnsavedChanges]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  async function onSubmit() {
    if (!draft) {
      return;
    }
    setSaving(true);
    try {
      const next = await api.updateSettings(draft);
      settings.setData(next);
      setDraft(createSettingsDraft(next));
      showToast({ kind: "success", message: "Settings saved." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      if (!hasUnsavedChanges || saving) {
        return;
      }
      event.preventDefault();
      void onSubmit();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasUnsavedChanges, saving, draft]);

  function handleDiscardChanges() {
    if (!settings.data || !hasUnsavedChanges || !draft) {
      return;
    }
    const confirmed = window.confirm("Discard unsaved settings changes?");
    if (!confirmed) {
      return;
    }
    setDraft(createSettingsDraft(settings.data));
    showToast({ kind: "info", message: "Draft changes discarded.", durationMs: 1800 });
  }

  if (!settings.data) {
    return <section className="panel">Loading settings…</section>;
  }

  async function handleExportApp() {
    try {
      const payload = await api.exportApp();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `pbresults-scoreboard-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      showToast({ kind: "success", message: "App backup exported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to export app backup." });
    }
  }

  async function handleImportApp(file: File) {
    try {
      const text = await file.text();
      const imported = await api.importApp(JSON.parse(text));
      settings.setData(imported.settings);
      themes.setData(imported.themes);
      showToast({ kind: "success", message: "App backup restored." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to restore app backup." });
    }
  }

  return (
    <section className="admin-page panel-stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2>Source and publishing settings</h2>
          </div>
          <div className="action-row compact">
            {hasUnsavedChanges ? <span className="status-pill">Unsaved changes</span> : <span className="status-pill status-pill--ok">Saved</span>}
            <button className="secondary-button" type="button" onClick={() => handleDiscardChanges()} disabled={!hasUnsavedChanges || saving}>
              Discard changes
            </button>
          </div>
        </div>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <label>
            Upstream base URL
            <input
              name="upstreamBaseUrl"
              value={draft?.upstreamBaseUrl ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        upstreamBaseUrl: event.target.value
                      }
                    : current
                )
              }
            />
          </label>
          <label>
            Published theme
            <select
              name="publishedThemeId"
              value={draft?.publishedThemeId ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        publishedThemeId: event.target.value || null
                      }
                    : current
                )
              }
            >
              <option value="">None</option>
              {themes.data?.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Poll interval (ms)
            <input
              name="pollIntervalMs"
              type="number"
              min={100}
              step={50}
              value={draft?.pollIntervalMs ?? settings.data.pollIntervalMs}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        pollIntervalMs: Number(event.target.value || 0)
                      }
                    : current
                )
              }
            />
          </label>
          <div className="action-row compact">
            <button disabled={saving || !hasUnsavedChanges} type="submit">
              {saving ? "Saving…" : "Save settings"}
            </button>
            <span className="hint">Tip: press Ctrl/Cmd+S to save.</span>
          </div>
        </form>
      </div>

      <div className="panel">
        <p className="eyebrow">Health</p>
        <h2>Current live feed</h2>
        {live.data ? (
          <div className="stats-grid">
            <div>
              <strong>Source status</strong>
              <span>{live.data.sourceStatus}</span>
            </div>
            <div>
              <strong>State / period</strong>
              <span>
                {live.data.state} / {live.data.period}
              </span>
            </div>
            <div>
              <strong>Round / switched</strong>
              <span>
                {live.data.round} / {live.data.sidesSwitched}
              </span>
            </div>
            <div>
              <strong>Display teams</strong>
              <span>
                {live.data.displayLeftTeam.name} vs {live.data.displayRightTeam.name}
              </span>
            </div>
          </div>
        ) : (
          <p>{live.error ?? "Waiting for live data…"}</p>
        )}
      </div>

      <div className="panel">
        <p className="eyebrow">Portability</p>
        <h2>Full app backup and restore</h2>
        <p className="hint">Export settings, themes, and uploaded logo assets as one JSON bundle.</p>
        <div className="action-row compact">
          <button className="secondary-button" type="button" onClick={() => void handleExportApp()}>
            Export full app backup
          </button>
          <label className="secondary-button">
            Import full app backup
            <input
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleImportApp(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
