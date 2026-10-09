import { useEffect, useRef, useState } from "react";
import { CircleAlert, Download, Info, RotateCcw, Upload } from "lucide-react";
import { api } from "../api";
import { useBackups } from "../hooks";
import { showToast } from "../toast";
import type { BackupPreview } from "../../shared/backup";
import type { AppSettings, BackupReason, ThemeDefinition } from "../../shared/theme";
import { Button, Chip, SettingRow, downloadJson } from "./admin/kit";

type RestoreResult = { settings: AppSettings; themes: ThemeDefinition[] };
type PendingRestore = { label: string; preview: BackupPreview; run: () => Promise<RestoreResult> };

const reasonLabels: Record<BackupReason, string> = {
  manual: "Manual",
  startup: "Server start",
  shutdown: "Server stop",
  "pre-restore": "Before restore",
  "pre-import": "Before import",
  export: "Export"
};

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function localControlAvailable(): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Backup status, the extra folder, stored backups and restore, drawn as rows inside the Maintenance "Backup and restore" group. */
export function BackupRows({ onRestored }: { onRestored: (result: RestoreResult) => void }) {
  const backups = useBackups();
  const status = backups.data;
  const isLocal = localControlAvailable();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [retainDraft, setRetainDraft] = useState(30);
  const importInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);

  // The confirmation sits above the backup list; bring it into view when a row lower down asks for it.
  useEffect(() => {
    if (!pending) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pendingRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [pending]);

  useEffect(() => {
    if (!status) return;
    setFolderDraft(status.extraFolder ?? "");
    setRetainDraft(status.retainAutomatic);
  }, [status?.extraFolder, status?.retainAutomatic]);

  async function run(name: string, action: () => Promise<void>) {
    setBusyAction(name);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  function backUpNow() {
    return run("backup", async () => {
      try {
        backups.setData(await api.createBackup());
        showToast({ kind: "success", message: "Backup saved." });
      } catch (error) {
        backups.refresh();
        showToast({ kind: "error", message: errorText(error, "The backup failed.") });
      }
    });
  }

  function exportFile() {
    return run("export", async () => {
      try {
        downloadJson(await api.exportApp(), `pbresults-scoreboard-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
        showToast({ kind: "success", message: "Backup exported." });
      } catch (error) {
        showToast({ kind: "error", message: errorText(error, "Failed to export the backup.") });
      }
    });
  }

  function previewStored(file: string, createdAt: string) {
    return run(`inspect:${file}`, async () => {
      try {
        const preview = await api.inspectBackupFile(file);
        setPending({ label: `the backup from ${formatDate(createdAt)}`, preview, run: () => api.restoreBackupFile(file) });
      } catch (error) {
        showToast({ kind: "error", message: errorText(error, "This backup cannot be restored.") });
      }
    });
  }

  function previewUpload(file: File) {
    return run("inspect:upload", async () => {
      try {
        const payload: unknown = JSON.parse(await file.text());
        const preview = await api.inspectBackupPackage(payload);
        setPending({ label: `"${file.name}"`, preview, run: () => api.importApp(payload) });
      } catch (error) {
        showToast({
          kind: "error",
          message: error instanceof SyntaxError ? "This file is not a scoreboard backup." : errorText(error, "This file cannot be restored.")
        });
      }
    });
  }

  function confirmRestore() {
    if (!pending) return;
    return run("restore", async () => {
      try {
        onRestored(await pending.run());
        setPending(null);
        showToast({ kind: "success", message: "Backup restored. A safety backup of the previous data was saved first." });
      } catch (error) {
        showToast({ kind: "error", message: errorText(error, "Failed to restore the backup.") });
      } finally {
        backups.refresh();
      }
    });
  }

  function saveConfig() {
    return run("config", async () => {
      try {
        backups.setData(await api.updateBackupConfig({ extraFolder: folderDraft.trim() || null, retainAutomatic: retainDraft }));
        showToast({ kind: "success", message: folderDraft.trim() ? "Extra folder saved and tested." : "Backup settings saved." });
      } catch (error) {
        showToast({ kind: "error", message: errorText(error, "Failed to save the backup settings.") });
      }
    });
  }

  const locked = Boolean(busyAction) || Boolean(status?.busy);
  const configDirty = status ? folderDraft.trim() !== (status.extraFolder ?? "") || retainDraft !== status.retainAutomatic : false;
  const lastFailureIsNewest =
    status?.lastFailure && (!status.lastSuccess || new Date(status.lastFailure.at) > new Date(status.lastSuccess.at));
  const visibleBackups = status ? (showAll ? status.backups : status.backups.slice(0, 10)) : [];

  return (
    <>
      <SettingRow
        title="Automatic backups"
        hint={
          status?.lastSuccess ? (
            <>
              Last saved {formatDate(status.lastSuccess.at)} · {reasonLabels[status.lastSuccess.reason]} · {formatBytes(status.lastSuccess.sizeBytes)}
              {status.lastSuccess.extraCopy === "ok" ? " · copied to the extra folder" : ""}
              {status.lastSuccess.extraCopy === "failed" ? " · extra folder copy failed" : ""}
            </>
          ) : (
            "Saved when the server starts and stops, and before every restore or import."
          )
        }
      >
        <Button disabled={locked} onClick={() => void backUpNow()}>
          {busyAction === "backup" ? "Backing up…" : "Back up now"}
        </Button>
      </SettingRow>

      {lastFailureIsNewest && status?.lastFailure ? (
        <div className="pba-callout pba-callout--critical">
          <CircleAlert aria-hidden />
          <span>
            <b>Backup failed</b> · {formatDate(status.lastFailure.at)} · {status.lastFailure.error}
          </span>
        </div>
      ) : null}
      {status?.lastSuccess?.extraCopy === "failed" ? (
        <div className="pba-callout pba-callout--warning">
          <CircleAlert aria-hidden />
          <span>
            <b>Extra folder copy failed</b> · {status.lastSuccess.extraCopyError}
          </span>
        </div>
      ) : null}

      <div className="pba-set-block">
        <b>Extra backup folder</b>
        <p className="pba-hint">
          {isLocal
            ? "Optional second copy of every backup, such as a USB drive."
            : "Open Maintenance through localhost on the scoreboard computer to change backup folders."}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <input
            className="pba-input"
            style={{ flex: "1 1 220px", minWidth: 0 }}
            placeholder="Full folder path, e.g. E:\Scoreboard backups"
            aria-label="Extra backup folder"
            value={folderDraft}
            disabled={!isLocal || locked}
            onChange={(event) => setFolderDraft(event.target.value)}
          />
          <span className="pba-hint" aria-hidden>
            Automatic backups
          </span>
          <label className="pba-unit" title="How many automatic backups to keep">
            <input
              className="pba-input"
              type="number"
              min={5}
              max={500}
              aria-label="Automatic backups to keep"
              value={retainDraft}
              disabled={!isLocal || locked}
              onChange={(event) => setRetainDraft(Number(event.target.value || 30))}
            />
            <span>kept</span>
          </label>
          <Button disabled={!isLocal || locked || !configDirty} onClick={() => void saveConfig()}>
            Save and test
          </Button>
        </div>
        {status ? (
          <p className="pba-hint" style={{ overflowWrap: "anywhere" }}>
            Backups are always kept in {status.backupsDir}
          </p>
        ) : null}
      </div>

      <SettingRow
        title="Backup file"
        hint={
          isLocal
            ? "Download everything as one file, or restore from a file you saved earlier."
            : "Download everything as one file. Open Maintenance through localhost on the scoreboard computer to restore."
        }
      >
        <Button disabled={locked} onClick={() => void exportFile()}>
          <Download aria-hidden />
          Export
        </Button>
        <Button variant="ghost" disabled={!isLocal || locked} onClick={() => importInputRef.current?.click()}>
          <Upload aria-hidden />
          {busyAction === "inspect:upload" ? "Checking…" : "Restore from file…"}
        </Button>
        <input
          ref={importInputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void previewUpload(file);
            event.currentTarget.value = "";
          }}
        />
      </SettingRow>

      {pending ? (
        <div className="pba-set-block" ref={pendingRef}>
          <b>Restore {pending.label}?</b>
          <p className="pba-hint">
            {pending.preview.counts.themes} themes · {pending.preview.counts.teams} teams · {pending.preview.counts.assets} logos (
            {formatBytes(pending.preview.totalAssetBytes)})
            {pending.preview.counts.operatorTextOverrides !== null
              ? ` · ${pending.preview.counts.teamResolutionOverrides} team overrides · ${pending.preview.counts.operatorTextOverrides} operator text values`
              : ""}
            {` · saved ${formatDate(pending.preview.createdAt)}`}
            {pending.preview.appVersion ? ` by version ${pending.preview.appVersion}` : ""}
          </p>
          {pending.preview.warnings.map((warning) => (
            <div key={warning} className="pba-callout pba-callout--warning">
              <Info aria-hidden />
              <span>{warning}</span>
            </div>
          ))}
          <p className="pba-hint">
            This replaces the current settings, themes, teams, logos and operations state. A safety backup of the current data is saved
            first.
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="primary" disabled={locked} onClick={() => void confirmRestore()}>
              {busyAction === "restore" ? "Restoring…" : "Restore"}
            </Button>
            <Button variant="ghost" disabled={busyAction === "restore"} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!status ? (
        <div className="pba-callout">
          <Info aria-hidden />
          <span>{backups.error ?? "Loading backups…"}</span>
        </div>
      ) : status.backups.length > 0 ? (
        <div className="pba-set-block">
          <b>Saved backups</b>
          <table className="pba-table pba-backup-table">
            <thead>
              <tr>
                <th>Saved</th>
                <th>Reason</th>
                <th className="pba-num">Size</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleBackups.map((entry) => (
                <tr key={entry.file}>
                  <td>{formatDate(entry.createdAt)}</td>
                  <td>{entry.automatic ? reasonLabels[entry.reason] : <Chip>{reasonLabels[entry.reason]}</Chip>}</td>
                  <td className="pba-num">{formatBytes(entry.sizeBytes)}</td>
                  <td className="pba-num">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!isLocal || locked}
                      title={isLocal ? undefined : "Restore on the scoreboard computer, through localhost"}
                      onClick={() => void previewStored(entry.file, entry.createdAt)}
                    >
                      <RotateCcw aria-hidden />
                      {busyAction === `inspect:${entry.file}` ? "Checking…" : "Restore…"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {status.backups.length > 10 ? (
            <div>
              <Button variant="text" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show fewer" : `Show all ${status.backups.length}`}
              </Button>
            </div>
          ) : null}
          <p className="pba-hint">Manual backups are never deleted automatically. The newest {status.retainAutomatic} automatic backups are kept.</p>
        </div>
      ) : null}
    </>
  );
}
