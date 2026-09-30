import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, TriangleAlert, Upload } from "lucide-react";
import { api } from "../api";
import { useSettings, useThemes, useUpdateStatus } from "../hooks";
import { showToast } from "../toast";
import type { AppSettings } from "../../shared/theme";
import { Button, Chip, Grow, SettingRow, Switch, Toolbar } from "../components/admin/kit";
import { SoftwareUpdateRows } from "../components/SoftwareUpdateRows";
import { areSettingsEqual, createSettingsDraft } from "./settingsFormUtils";

const SECTIONS = [
  { id: "set-feed", label: "Live feed" },
  { id: "set-air", label: "On air" },
  { id: "set-uploads", label: "Uploads" },
  { id: "set-updates", label: "Software updates" },
  { id: "set-backup", label: "Backup and restore" }
] as const;

export function SettingsPage() {
  const settings = useSettings();
  const themes = useThemes();
  const update = useUpdateStatus();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(settings.data ? createSettingsDraft(settings.data) : null);
  const [externallyChanged, setExternallyChanged] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const lastServerSettingsRef = useRef(settings.data);
  const bodyRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

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
    const previous = lastServerSettingsRef.current;
    lastServerSettingsRef.current = settings.data;
    if (!draft) {
      setDraft(createSettingsDraft(settings.data));
      setExternallyChanged(false);
      return;
    }
    if (previous && areSettingsEqual(previous, settings.data)) {
      return;
    }
    const wasDirty = previous ? !areSettingsEqual(draft, previous) : false;
    if (!wasDirty) {
      setDraft(createSettingsDraft(settings.data));
      setExternallyChanged(false);
    } else {
      setExternallyChanged(true);
    }
  }, [settings.data]);

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
      lastServerSettingsRef.current = next;
      settings.setData(next);
      setDraft(createSettingsDraft(next));
      setExternallyChanged(false);
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

  // The section list follows the scroll position.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveSection(visible[0].target.id);
        }
      },
      { root, rootMargin: "0px 0px -60% 0px" }
    );
    SECTIONS.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [Boolean(settings.data)]);

  function patch(next: Partial<AppSettings>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function handleDiscardChanges() {
    if (!settings.data || !hasUnsavedChanges || !draft) {
      return;
    }
    if (!window.confirm("Discard your unsaved settings changes?")) {
      return;
    }
    setDraft(createSettingsDraft(settings.data));
    setExternallyChanged(false);
    showToast({ kind: "info", message: "Changes discarded.", durationMs: 1800 });
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
      showToast({ kind: "success", message: "Backup exported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to export the backup." });
    }
  }

  async function handleImportApp(file: File) {
    if (!window.confirm(`Restore "${file.name}"? It replaces the current settings, themes, teams and logos.`)) {
      return;
    }
    try {
      const text = await file.text();
      const imported = await api.importApp(JSON.parse(text));
      lastServerSettingsRef.current = imported.settings;
      settings.setData(imported.settings);
      themes.setData(imported.themes);
      setDraft(createSettingsDraft(imported.settings));
      setExternallyChanged(false);
      showToast({ kind: "success", message: "Backup restored." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to restore the backup." });
    }
  }

  const updatesSupported = update.data?.managedUpdatesSupported ?? true;

  return (
    <div className="ad-page ad-scope">
      <Toolbar title="Settings">
        {!draft ? null : hasUnsavedChanges ? (
          <Chip tone="warning">Unsaved changes</Chip>
        ) : (
          <Chip tone="quiet">
            <Check aria-hidden />
            All changes saved
          </Chip>
        )}
        <Grow />
        <Button variant="ghost" onClick={handleDiscardChanges} disabled={!hasUnsavedChanges || saving}>
          Discard
        </Button>
        <Button variant="primary" onClick={() => void onSubmit()} disabled={!hasUnsavedChanges || saving} title="Save (Ctrl/Cmd+S)">
          {saving ? "Saving…" : "Save"}
        </Button>
      </Toolbar>

      <div className="ad-body" ref={bodyRef}>
        {!draft ? (
          <p className="ad-hint" style={{ padding: 20 }}>
            Loading settings…
          </p>
        ) : (
          <div className="ad-settings">
            <nav className="ad-toc" aria-label="Settings sections">
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  aria-current={activeSection === section.id ? "true" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setActiveSection(section.id);
                  }}
                >
                  {section.label}
                </a>
              ))}
            </nav>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onSubmit();
              }}
            >
              {externallyChanged ? (
                <div className="ad-surface" style={{ marginBottom: 20, overflow: "hidden" }}>
                  <div className="ad-callout ad-callout--warning">
                    <TriangleAlert aria-hidden />
                    <span style={{ flex: 1 }}>Settings were changed somewhere else while you were editing.</span>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!settings.data) return;
                        setDraft(createSettingsDraft(settings.data));
                        setExternallyChanged(false);
                      }}
                    >
                      Load their version
                    </Button>
                  </div>
                </div>
              ) : null}

              <section className="ad-set-group" id="set-feed">
                <h2>Live feed</h2>
                <div className="ad-surface">
                  <SettingRow title="PBResults address" hint="Where the scoreboard reads /live from.">
                    <input
                      className="ad-input"
                      aria-label="PBResults address"
                      value={draft.upstreamBaseUrl}
                      onChange={(event) => patch({ upstreamBaseUrl: event.target.value })}
                    />
                  </SettingRow>
                  <SettingRow title="Check the feed every" hint="Lower is faster; 500 ms suits most events.">
                    <label className="ad-unit">
                      <input
                        className="ad-input"
                        type="number"
                        min={100}
                        step={50}
                        aria-label="Check the feed every, in milliseconds"
                        value={draft.pollIntervalMs}
                        onChange={(event) => patch({ pollIntervalMs: Number(event.target.value || 0) })}
                      />
                      <span>ms</span>
                    </label>
                  </SettingRow>
                  <SettingRow title="Live polling" hint="Turn off to freeze the scoreboard on its last data.">
                    <Switch label="Live polling" checked={draft.pollEnabled} onChange={(pollEnabled) => patch({ pollEnabled })} />
                  </SettingRow>
                </div>
              </section>

              <section className="ad-set-group" id="set-air">
                <h2>On air</h2>
                <div className="ad-surface">
                  <SettingRow title="Theme on air" hint="What vMix shows. You can also put a theme on air from Themes.">
                    <select
                      className="ad-select"
                      aria-label="Theme on air"
                      value={draft.publishedThemeId ?? ""}
                      onChange={(event) => patch({ publishedThemeId: event.target.value || null })}
                    >
                      <option value="">None</option>
                      {themes.data?.map((theme) => (
                        <option key={theme.id} value={theme.id}>
                          {theme.name}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                </div>
              </section>

              <section className="ad-set-group" id="set-uploads">
                <h2>Uploads</h2>
                <div className="ad-surface">
                  <SettingRow title="Remove image backgrounds" hint="Cut out logo backgrounds automatically when you upload.">
                    <Switch
                      label="Remove image backgrounds"
                      checked={draft.autoRemoveBackgroundUploads}
                      onChange={(autoRemoveBackgroundUploads) => patch({ autoRemoveBackgroundUploads })}
                    />
                  </SettingRow>
                </div>
              </section>

              <section className="ad-set-group" id="set-updates">
                <h2>Software updates</h2>
                <div className="ad-surface" style={{ overflow: "hidden" }}>
                  <SoftwareUpdateRows update={update} hasUnsavedChanges={hasUnsavedChanges} />
                  <SettingRow title="Check for updates automatically" hint="Stable releases from the official GitHub repository." dim={!updatesSupported}>
                    <label className="ad-unit" title="How often to check">
                      <input
                        className="ad-input"
                        type="number"
                        min={1}
                        max={168}
                        aria-label="Check every, in hours"
                        value={draft.updateCheckIntervalHours}
                        disabled={!updatesSupported || !draft.updateCheckEnabled}
                        onChange={(event) => patch({ updateCheckIntervalHours: Number(event.target.value || 6) })}
                      />
                      <span>hours</span>
                    </label>
                    <Switch
                      label="Check for updates automatically"
                      checked={draft.updateCheckEnabled}
                      disabled={!updatesSupported}
                      onChange={(updateCheckEnabled) => patch({ updateCheckEnabled })}
                    />
                  </SettingRow>
                  <SettingRow title="Download updates automatically" hint="Installing always asks first." dim={!updatesSupported}>
                    <Switch
                      label="Download updates automatically"
                      checked={draft.updateAutoDownload}
                      disabled={!updatesSupported}
                      onChange={(updateAutoDownload) => patch({ updateAutoDownload })}
                    />
                  </SettingRow>
                </div>
              </section>

              <section className="ad-set-group" id="set-backup">
                <h2>Backup and restore</h2>
                <div className="ad-surface">
                  <SettingRow title="Full backup" hint="Settings, themes, teams and uploaded logos in one file.">
                    <Button onClick={() => void handleExportApp()}>
                      <Download aria-hidden />
                      Export
                    </Button>
                    <Button variant="ghost" onClick={() => importInputRef.current?.click()}>
                      <Upload aria-hidden />
                      Restore…
                    </Button>
                    <input
                      ref={importInputRef}
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
                  </SettingRow>
                </div>
              </section>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
