import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { useAssets, useSettings } from "../hooks";
import { showToast } from "../toast";
import { DEFAULT_APP_NAME } from "../../shared/theme";
import { Button, Chip, Grow, SettingRow, Switch, Toolbar } from "../components/admin/kit";
import { AssetLibraryPicker } from "../components/AssetLibraryPicker";
import { SectionToc, useSectionNav } from "../components/SectionNav";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard";
import {
  POLL_INTERVAL_MAX_MS,
  POLL_INTERVAL_MIN_MS,
  applySettingsDraft,
  areSettingsEqual,
  createSettingsDraft,
  pollIntervalError,
  type SettingsDraft
} from "./settingsFormUtils";
import { modalPromptOpen } from "../confirm";
import { confirmAction } from "../confirm";

const SECTIONS = [
  { id: "set-feed", label: "Live feed" },
  { id: "set-brand", label: "Branding" },
  { id: "set-uploads", label: "Uploads" }
] as const;

/** Preferences saved together with one Save. Actions that run at once live on Maintenance. */
export function SettingsPage() {
  const settings = useSettings();
  const assets = useAssets();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft | null>(settings.data ? createSettingsDraft(settings.data) : null);
  const [externallyChanged, setExternallyChanged] = useState(false);
  const lastServerSettingsRef = useRef(settings.data);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { activeSection, jumpTo } = useSectionNav(SECTIONS, bodyRef, draft !== null);

  const hasUnsavedChanges = Boolean(settings.data && draft && !areSettingsEqual(draft, settings.data));
  const intervalError = draft ? pollIntervalError(draft.pollIntervalMs) : null;
  const canSave = hasUnsavedChanges && !saving && !intervalError;

  useEffect(() => {
    if (!settings.data) return;
    const previous = lastServerSettingsRef.current;
    lastServerSettingsRef.current = settings.data;
    if (!draft) {
      setDraft(createSettingsDraft(settings.data));
      setExternallyChanged(false);
      return;
    }
    // Only the fields edited here count: putting a theme on air elsewhere is not a conflict.
    if (previous && areSettingsEqual(previous, settings.data)) return;
    const wasDirty = previous ? !areSettingsEqual(draft, previous) : false;
    if (!wasDirty) {
      setDraft(createSettingsDraft(settings.data));
      setExternallyChanged(false);
    } else {
      setExternallyChanged(true);
    }
  }, [settings.data]);

  async function save(): Promise<boolean> {
    if (!draft || intervalError) return false;
    setSaving(true);
    try {
      const next = await api.updateSettings(applySettingsDraft(await api.getSettings(), draft));
      lastServerSettingsRef.current = next;
      settings.setData(next);
      setDraft(createSettingsDraft(next));
      setExternallyChanged(false);
      showToast({ kind: "success", message: "Settings saved." });
      return true;
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to save settings." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s" || modalPromptOpen()) return;
      event.preventDefault();
      if (canSave) void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSave, draft]);

  function patch(next: Partial<SettingsDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function discard() {
    if (!settings.data) return;
    setDraft(createSettingsDraft(settings.data));
    setExternallyChanged(false);
  }

  async function handleDiscardChanges() {
    if (!hasUnsavedChanges) return;
    const confirmed = await confirmAction({
      title: "Discard your changes?",
      message: "Your unsaved settings changes are lost.",
      confirmLabel: "Discard changes",
      tone: "danger"
    });
    if (!confirmed) return;
    discard();
    showToast({ kind: "info", message: "Changes discarded.", durationMs: 1800 });
  }

  async function handleUploadBrandLogo(file: File) {
    try {
      const result = await api.uploadAsset(file);
      assets.setData([result.asset, ...(assets.data ?? []).filter((asset) => asset.id !== result.asset.id)]);
      patch({ brandLogoAssetId: result.asset.id });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to upload the logo." });
    }
  }

  return (
    <div className="pba-page pba-scope">
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
        <Button variant="primary" onClick={() => void save()} disabled={!canSave} title="Save (Ctrl/Cmd+S)">
          {saving ? "Saving…" : "Save"}
        </Button>
      </Toolbar>

      <UnsavedChangesGuard dirty={hasUnsavedChanges} saving={saving} onSave={save} onDiscard={discard} />

      <div className="pba-body" ref={bodyRef}>
        {!draft ? (
          <p className="pba-hint" style={{ padding: 20 }}>
            Loading settings…
          </p>
        ) : (
          <div className="pba-settings">
            <div className="pba-toc-col">
              <SectionToc sections={SECTIONS} activeSection={activeSection} onJump={jumpTo} label="Settings sections" />
              <p className="pba-hint pba-toc-note">
                Updates, backups and remote access are on <Link to="/admin/maintenance">Maintenance</Link>.
              </p>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave) void save();
              }}
            >
              {externallyChanged ? (
                <div className="pba-surface" style={{ marginBottom: 20, overflow: "hidden" }}>
                  <div className="pba-callout pba-callout--warning">
                    <TriangleAlert aria-hidden />
                    <span style={{ flex: 1 }}>These settings were changed somewhere else while you were editing.</span>
                    <Button size="sm" variant="ghost" onClick={() => setExternallyChanged(false)}>
                      Keep mine
                    </Button>
                    <Button size="sm" onClick={discard}>
                      Load their version
                    </Button>
                  </div>
                </div>
              ) : null}

              <section className="pba-set-group" id="set-feed">
                <h2>Live feed</h2>
                <div className="pba-surface">
                  <SettingRow title="PBResults address" hint="Where the scoreboard reads /live from." htmlFor="set-upstream">
                    <input
                      id="set-upstream"
                      className="pba-input"
                      value={draft.upstreamBaseUrl}
                      onChange={(event) => patch({ upstreamBaseUrl: event.target.value })}
                    />
                  </SettingRow>
                  <SettingRow
                    title="Check the feed every"
                    htmlFor="set-poll-interval"
                    hint={
                      intervalError ? (
                        <span className="pba-inline-warning" role="alert">
                          <CircleAlert aria-hidden />
                          {intervalError}
                        </span>
                      ) : (
                        "Lower is faster; 500 ms suits most events. Start and stop polling from Operations."
                      )
                    }
                  >
                    <label className="pba-unit">
                      <input
                        id="set-poll-interval"
                        className="pba-input"
                        type="number"
                        min={POLL_INTERVAL_MIN_MS}
                        max={POLL_INTERVAL_MAX_MS}
                        step={50}
                        aria-invalid={intervalError ? true : undefined}
                        value={Number.isNaN(draft.pollIntervalMs) ? "" : draft.pollIntervalMs}
                        onChange={(event) => patch({ pollIntervalMs: event.target.value === "" ? Number.NaN : Number(event.target.value) })}
                      />
                      <span>ms</span>
                    </label>
                  </SettingRow>
                </div>
              </section>

              <section className="pba-set-group" id="set-brand">
                <h2>Branding</h2>
                <div className="pba-surface">
                  <SettingRow title="App name" hint="Shown in the sidebar, the browser tab and the Windows console window. Leave empty to use the default." htmlFor="set-brand-name">
                    <input
                      id="set-brand-name"
                      className="pba-input"
                      maxLength={40}
                      placeholder={DEFAULT_APP_NAME}
                      value={draft.brandName}
                      onChange={(event) => patch({ brandName: event.target.value })}
                    />
                  </SettingRow>
                  <SettingRow title="Logo" hint="Shown in the sidebar and as the browser tab icon. A square image works best.">
                    <AssetLibraryPicker
                      label="Logo"
                      value={draft.brandLogoAssetId}
                      assets={assets.data ?? []}
                      onChange={(brandLogoAssetId) => patch({ brandLogoAssetId })}
                      onUpload={(file) => void handleUploadBrandLogo(file)}
                      align="end"
                    />
                  </SettingRow>
                  <SettingRow
                    title="Show “Powered by”"
                    hint={draft.brandName.trim() ? `Adds “Powered by ${DEFAULT_APP_NAME}” under your app name.` : "Available once you set an app name."}
                    dim={!draft.brandName.trim()}
                    htmlFor="set-brand-powered"
                  >
                    <Switch
                      id="set-brand-powered"
                      label="Show Powered by"
                      checked={draft.brandPoweredBy}
                      disabled={!draft.brandName.trim()}
                      onChange={(brandPoweredBy) => patch({ brandPoweredBy })}
                    />
                  </SettingRow>
                </div>
              </section>

              <section className="pba-set-group" id="set-uploads">
                <h2>Uploads</h2>
                <div className="pba-surface">
                  <SettingRow title="Remove image backgrounds" hint="Cut out logo backgrounds automatically when you upload." htmlFor="set-remove-bg">
                    <Switch
                      id="set-remove-bg"
                      label="Remove image backgrounds"
                      checked={draft.autoRemoveBackgroundUploads}
                      onChange={(autoRemoveBackgroundUploads) => patch({ autoRemoveBackgroundUploads })}
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
