import { useEffect, useMemo, useRef, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { useSettings, useThemes, useUpdateStatus } from "../hooks";
import { showToast } from "../toast";
import type { AppSettings, ThemeDefinition } from "../../shared/theme";
import { Button, Chip, Grow, SettingRow, Switch, Toolbar } from "../components/admin/kit";
import { SoftwareUpdateRows } from "../components/SoftwareUpdateRows";
import { BackupRows } from "../components/BackupRows";
import { RemoteAccessRows } from "../components/RemoteAccessRows";
import { areSettingsEqual, createSettingsDraft } from "./settingsFormUtils";

const SECTIONS = [
  { id: "set-feed", label: "Live feed" },
  { id: "set-air", label: "On air" },
  { id: "set-uploads", label: "Uploads" },
  { id: "set-updates", label: "Software updates" },
  { id: "set-backup", label: "Backup and restore" },
  { id: "set-remote", label: "Remote access" }
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

  // Links such as the remote access banner's "Manage" open a section directly; the sections render once settings load.
  const draftReady = draft !== null;
  useEffect(() => {
    if (!draftReady) return;
    const id = window.location.hash.slice(1);
    const root = bodyRef.current;
    const target = SECTIONS.some((section) => section.id === id) ? document.getElementById(id) : null;
    if (!root || !target) return;
    // Scroll only the settings body: scrollIntoView would also scroll the page and hide the toolbar and banners.
    const pin = () => root.scrollTo({ top: target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop });
    pin();
    setActiveSection(id);
    // Sections above it (backups, updates) are still loading and push it down; keep it in view until they settle or the reader takes over.
    const resizes = new ResizeObserver(pin);
    if (root.firstElementChild) resizes.observe(root.firstElementChild);
    const release = () => resizes.disconnect();
    const timer = window.setTimeout(release, 3000);
    const takeover = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    takeover.forEach((type) => root.addEventListener(type, release, { passive: true }));
    return () => {
      release();
      window.clearTimeout(timer);
      takeover.forEach((type) => root.removeEventListener(type, release));
    };
  }, [draftReady]);

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

  // The section list follows the scroll position: the last section whose heading has passed the reading line.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !draftReady) {
      return;
    }
    const update = () => {
      // Short last sections never reach the reading line; at the bottom of the page, they are the one being read.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        setActiveSection(SECTIONS[SECTIONS.length - 1].id);
        return;
      }
      // Just below the top, where a heading lands when its section is opened from the list.
      const readingLine = root.getBoundingClientRect().top + 64;
      let current: string = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const top = document.getElementById(section.id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= readingLine) current = section.id;
      }
      setActiveSection(current);
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    return () => root.removeEventListener("scroll", update);
  }, [draftReady]);

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

  function handleRestored(restored: { settings: AppSettings; themes: ThemeDefinition[] }) {
    lastServerSettingsRef.current = restored.settings;
    settings.setData(restored.settings);
    themes.setData(restored.themes);
    setDraft(createSettingsDraft(restored.settings));
    setExternallyChanged(false);
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
                    // Scroll only the settings body; scrollIntoView would also scroll the page around it.
                    const root = bodyRef.current;
                    const target = document.getElementById(section.id);
                    if (root && target) {
                      root.scrollTo({ top: target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop, behavior: "smooth" });
                    }
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
                <div className="ad-surface" style={{ overflow: "hidden" }}>
                  <BackupRows hasUnsavedChanges={hasUnsavedChanges} onRestored={handleRestored} />
                </div>
              </section>

              <section className="ad-set-group" id="set-remote">
                <h2>Remote access</h2>
                <div className="ad-surface" style={{ overflow: "hidden" }}>
                  <RemoteAccessRows />
                </div>
              </section>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
