import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useSettings, useThemes } from "../hooks";
import { showToast } from "../toast";
import {
  AdminPageFrame,
  AdminPageHeader,
  Badge,
  Button,
  Card,
  Checkbox,
  FieldHint,
  Input,
  Select,
  buttonVariants
} from "../components/ui";
import { areSettingsEqual, createSettingsDraft } from "./settingsFormUtils";

export function SettingsPage() {
  const settings = useSettings();
  const themes = useThemes();
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
  }, [settings.data, hasUnsavedChanges]);

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
    return (
      <Card>
        <FieldHint>Loading settings…</FieldHint>
      </Card>
    );
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
    <AdminPageFrame className="panel-stack">
      <AdminPageHeader
        eyebrow="Runtime"
        title="Source and publishing settings"
        description="Control live polling, publish target theme, and source configuration."
        actions={(
          <div className="action-row compact">
            {hasUnsavedChanges ? <Badge variant="default">Unsaved changes</Badge> : <Badge variant="success">Saved</Badge>}
            <Button
              variant="secondary"
              type="button"
              onClick={() => handleDiscardChanges()}
              disabled={!hasUnsavedChanges || saving}
            >
              Discard changes
            </Button>
          </div>
        )}
      />

      <Card>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <label>
            Upstream base URL
            <Input
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
            <Select
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
            </Select>
          </label>
          <label>
            Poll interval (ms)
            <Input
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
          <label className="checkbox">
            <Checkbox
              name="pollEnabled"
              type="checkbox"
              checked={draft?.pollEnabled ?? settings.data.pollEnabled}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        pollEnabled: event.target.checked
                      }
                    : current
                )
              }
            />
            Enable live polling
          </label>
          <label className="checkbox">
            <Checkbox
              name="autoRemoveBackgroundUploads"
              type="checkbox"
              checked={draft?.autoRemoveBackgroundUploads ?? settings.data.autoRemoveBackgroundUploads}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        autoRemoveBackgroundUploads: event.target.checked
                      }
                    : current
                )
              }
            />
            Automatically remove image backgrounds on upload
          </label>
          <div className="action-row compact">
            <Button disabled={saving || !hasUnsavedChanges} type="submit">
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <FieldHint>Tip: press Ctrl/Cmd+S to save.</FieldHint>
          </div>
        </form>
      </Card>

      <Card>
        <p className="admin-page-eyebrow">Portability</p>
        <h3 className="m-0 text-[var(--admin-section-size)] font-semibold text-md3-onBackground">Full app backup and restore</h3>
        <FieldHint>Export settings, themes, and uploaded logo assets as one JSON bundle.</FieldHint>
        <div className="action-row compact">
          <Button variant="secondary" type="button" onClick={() => void handleExportApp()}>
            Export full app backup
          </Button>
          <label className={buttonVariants({ variant: "secondary" })}>
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
      </Card>
    </AdminPageFrame>
  );
}
