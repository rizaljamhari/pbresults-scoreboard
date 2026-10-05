import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, Zap } from "lucide-react";
import { api } from "../api";
import { useSettings, useUpdateStatus } from "../hooks";
import { showToast } from "../toast";
import type { AppSettings } from "../../shared/theme";
import { Chip, SettingRow, Switch, Toolbar } from "../components/admin/kit";
import { BackupRows } from "../components/BackupRows";
import { RemoteAccessRows } from "../components/RemoteAccessRows";
import { SoftwareUpdateRows } from "../components/SoftwareUpdateRows";
import { SectionToc, useSectionNav } from "../components/SectionNav";

const SECTIONS = [
  { id: "set-backup", label: "Backup and restore" },
  { id: "set-updates", label: "Software updates" },
  { id: "set-remote", label: "Remote access" }
] as const;

const CHECK_HOURS_MIN = 1;
const CHECK_HOURS_MAX = 168;

/** Backups, updates and remote access. Every control here acts at once; there is nothing to save. */
export function MaintenancePage() {
  const settings = useSettings();
  const update = useUpdateStatus();
  const bodyRef = useRef<HTMLDivElement>(null);
  const { activeSection, jumpTo } = useSectionNav(SECTIONS, bodyRef, true);

  return (
    <div className="ad-page ad-scope">
      <Toolbar title="Maintenance">
        <Chip tone="quiet">
          <Zap aria-hidden />
          Changes here apply right away
        </Chip>
      </Toolbar>

      <div className="ad-body" ref={bodyRef}>
        <div className="ad-settings">
          <div className="ad-toc-col">
            <SectionToc sections={SECTIONS} activeSection={activeSection} onJump={jumpTo} label="Maintenance sections" />
            <p className="ad-hint ad-toc-note">
              The feed address, branding and uploads are on <Link to="/admin/settings">Settings</Link>.
            </p>
          </div>

          <div>
            <section className="ad-set-group" id="set-backup">
              <h2>Backup and restore</h2>
              <div className="ad-surface" style={{ overflow: "hidden" }}>
                <BackupRows onRestored={(restored) => settings.setData(restored.settings)} />
              </div>
            </section>

            <section className="ad-set-group" id="set-updates">
              <h2>Software updates</h2>
              <div className="ad-surface" style={{ overflow: "hidden" }}>
                <SoftwareUpdateRows update={update} />
                {update.data?.managedUpdatesSupported && settings.data ? <UpdatePreferenceRows settings={settings.data} onSaved={settings.setData} /> : null}
              </div>
            </section>

            <section className="ad-set-group" id="set-remote">
              <h2>Remote access</h2>
              <div className="ad-surface" style={{ overflow: "hidden" }}>
                <RemoteAccessRows />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Saved as soon as they change, on top of the latest settings so nothing edited elsewhere is undone. */
function UpdatePreferenceRows({ settings, onSaved }: { settings: AppSettings; onSaved: (next: AppSettings) => void }) {
  const [hoursDraft, setHoursDraft] = useState(String(settings.updateCheckIntervalHours));
  const [saving, setSaving] = useState(false);

  useEffect(() => setHoursDraft(String(settings.updateCheckIntervalHours)), [settings.updateCheckIntervalHours]);

  const hours = Number(hoursDraft);
  const hoursError = !Number.isInteger(hours) || hours < CHECK_HOURS_MIN || hours > CHECK_HOURS_MAX ? `Use a whole number from ${CHECK_HOURS_MIN} to ${CHECK_HOURS_MAX} hours.` : null;

  async function save(patch: Partial<AppSettings>) {
    setSaving(true);
    try {
      onSaved(await api.updateSettings({ ...(await api.getSettings()), ...patch }));
      showToast({ kind: "success", message: "Update preference saved.", durationMs: 1800 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to save the update preference." });
    } finally {
      setSaving(false);
    }
  }

  function commitHours() {
    if (hoursError || hours === settings.updateCheckIntervalHours) return;
    void save({ updateCheckIntervalHours: hours });
  }

  return (
    <>
      <SettingRow
        title="Check for updates automatically"
        htmlFor="maint-update-check"
        hint={
          hoursError ? (
            <span className="ad-inline-warning" role="alert">
              <CircleAlert aria-hidden />
              {hoursError}
            </span>
          ) : (
            "Stable releases from the official GitHub repository."
          )
        }
      >
        <label className="ad-unit" title="How often to check">
          <input
            className="ad-input"
            type="number"
            min={CHECK_HOURS_MIN}
            max={CHECK_HOURS_MAX}
            aria-label="Check every, in hours"
            aria-invalid={hoursError ? true : undefined}
            value={hoursDraft}
            disabled={!settings.updateCheckEnabled || saving}
            onChange={(event) => setHoursDraft(event.target.value)}
            onBlur={commitHours}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitHours();
            }}
          />
          <span>hours</span>
        </label>
        <Switch
          id="maint-update-check"
          label="Check for updates automatically"
          checked={settings.updateCheckEnabled}
          disabled={saving}
          onChange={(updateCheckEnabled) => void save({ updateCheckEnabled })}
        />
      </SettingRow>
      <SettingRow title="Download updates automatically" hint="Installing always asks first." htmlFor="maint-update-download">
        <Switch
          id="maint-update-download"
          label="Download updates automatically"
          checked={settings.updateAutoDownload}
          disabled={saving}
          onChange={(updateAutoDownload) => void save({ updateAutoDownload })}
        />
      </SettingRow>
    </>
  );
}
