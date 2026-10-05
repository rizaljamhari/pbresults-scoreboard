import { useMemo, useState } from "react";
import { ArrowUpRight, CircleAlert, Info, RotateCcw } from "lucide-react";
import { api } from "../api";
import type { useUpdateStatus } from "../hooks";
import { showToast } from "../toast";
import { Button, Chip, SettingRow } from "./admin/kit";
import { confirmAction } from "../confirm";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
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

/** Update status and actions, drawn as rows inside the Maintenance "Software updates" group. */
export function SoftwareUpdateRows({ update }: { update: ReturnType<typeof useUpdateStatus> }) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [showInstallConfirmation, setShowInstallConfirmation] = useState(false);
  const [restartAcknowledged, setRestartAcknowledged] = useState(false);
  const status = update.data;
  const isLocal = localControlAvailable();
  const progress = useMemo(() => {
    if (!status?.prepared?.totalBytes) return 0;
    return Math.min(100, Math.round((status.prepared.downloadedBytes / status.prepared.totalBytes) * 100));
  }, [status?.prepared]);

  async function runAction(name: string, action: () => Promise<NonNullable<typeof status>>) {
    setBusyAction(name);
    try {
      update.setData(await action());
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Update operation failed." });
    } finally {
      setBusyAction(null);
    }
  }

  if (!status) {
    return (
      <div className="ad-callout">
        <Info aria-hidden />
        <span>{update.error ?? "Loading update status…"}</span>
      </div>
    );
  }

  if (!status.managedUpdatesSupported) {
    return (
      <>
        <div className="ad-callout">
          <Info aria-hidden />
          <span>{status.unsupportedReason ?? "Managed updates only work in the Windows portable package."}</span>
        </div>
        <SettingRow title={`Version ${status.current.version}`} hint={status.current.releaseTag ?? "Development build"}>
          {null}
        </SettingRow>
      </>
    );
  }

  const activeWork = ["checking", "downloading", "verifying", "staging", "install-requested", "restarting"].includes(status.phase);
  const locked = !isLocal || activeWork || Boolean(busyAction);

  return (
    <>
      {!isLocal ? (
        <div className="ad-callout ad-callout--info">
          <Info aria-hidden />
          <span>Open Maintenance through localhost on the scoreboard computer to control updates.</span>
        </div>
      ) : null}

      <SettingRow
        title={
          <>
            Version {status.current.version} <Chip tone="ok">Installed</Chip>
          </>
        }
        hint={
          <>
            {status.current.releaseTag ?? status.current.version}
            {status.current.builtAt ? ` · built ${formatDate(status.current.builtAt)}` : ""}
            {status.current.sourceCommit ? ` · ${status.current.sourceCommit.slice(0, 8)}` : ""} · last checked {formatDate(status.lastCheckedAt)}
          </>
        }
      >
        <Button disabled={locked} onClick={() => void runAction("check", api.checkForUpdate)}>
          {status.phase === "checking" ? "Checking…" : "Check now"}
        </Button>
        {status.rollbackAvailable ? (
          <Button
            variant="ghost"
            disabled={locked}
            onClick={async () => {
              const confirmed = await confirmAction({
                title: "Roll back to the previous version?",
                message: "The app restarts on the previous healthy version. The admin and the overlay disconnect briefly. Your current data is snapshotted first.",
                confirmLabel: "Roll back and restart",
                tone: "danger"
              });
              if (confirmed) void runAction("rollback", api.rollbackUpdate);
            }}
          >
            <RotateCcw aria-hidden />
            Roll back
          </Button>
        ) : null}
      </SettingRow>

      {status.lastResult ? (
        <SettingRow
          title={
            status.lastResult.outcome === "succeeded"
              ? "Update completed"
              : status.lastResult.outcome === "rolled-back"
                ? "Update rolled back safely"
                : "Update failed"
          }
          hint={`${status.lastResult.fromVersion} → ${status.lastResult.targetVersion} · ${status.lastResult.message}`}
        >
          <Button variant="ghost" onClick={() => void runAction("dismiss", api.dismissUpdateResult)}>
            Dismiss
          </Button>
        </SettingRow>
      ) : null}

      {status.available ? (
        <SettingRow
          title={
            <>
              Version {status.available.version} is available <Chip>New</Chip>
            </>
          }
          hint={
            <>
              Published {formatDate(status.available.publishedAt)} · {formatBytes(status.available.assetSize)}
              {status.skippedVersion === status.available.version ? " · skipped for automatic notices" : ""}
            </>
          }
        >
          <a className="ad-btn ad-btn--text" href={status.available.releasePageUrl} target="_blank" rel="noreferrer">
            Release notes
            <ArrowUpRight aria-hidden />
          </a>
          <Button variant="ghost" disabled={locked} onClick={() => void runAction("skip", () => api.toggleSkipUpdate(status.available!.version))}>
            {status.skippedVersion === status.available.version ? "Unskip" : "Skip"}
          </Button>
          {!status.prepared ? (
            <Button disabled={locked} onClick={() => void runAction("download", () => api.downloadUpdate(status.available!.version))}>
              Download
            </Button>
          ) : null}
        </SettingRow>
      ) : null}

      {status.prepared && ["downloading", "verifying", "staging"].includes(status.phase) ? (
        <div className="ad-set-block">
          <b>{status.phase === "downloading" ? `Downloading ${progress}%` : status.phase === "verifying" ? "Verifying download" : "Preparing update"}</b>
          <div className="ad-progress" role="progressbar" aria-valuenow={status.phase === "downloading" ? progress : 100} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ transform: `scaleX(${(status.phase === "downloading" ? progress : 100) / 100})` }} />
          </div>
          <p className="ad-hint">
            {formatBytes(status.prepared.downloadedBytes)} of {formatBytes(status.prepared.totalBytes)}
          </p>
        </div>
      ) : null}

      {status.phase === "ready-to-install" && status.prepared ? (
        <div className="ad-set-block">
          <b>Version {status.prepared.version} is ready to install</b>
          <p className="ad-hint">
            Choose a moment when nothing is live. The updater stops the server, snapshots your data, restarts on the same port, and rolls back
            by itself if the health checks fail.
          </p>
          {!showInstallConfirmation ? (
            <div>
              <Button disabled={!isLocal} onClick={() => setShowInstallConfirmation(true)}>
                Install and restart…
              </Button>
            </div>
          ) : (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input className="ad-check" type="checkbox" checked={restartAcknowledged} onChange={(event) => setRestartAcknowledged(event.target.checked)} />
                The admin and the overlay will disconnect briefly. Nothing is live right now.
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  variant="primary"
                  disabled={!restartAcknowledged || Boolean(busyAction)}
                  onClick={() => void runAction("install", () => api.installUpdate(status.prepared!.version))}
                >
                  Install and restart
                </Button>
                <Button variant="ghost" onClick={() => setShowInstallConfirmation(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {status.diskUsage ? (
        <SettingRow
          title="Disk space"
          hint={`${status.diskUsage.versionCount} installed version${status.diskUsage.versionCount === 1 ? "" : "s"} (${formatBytes(status.diskUsage.versionsBytes)}) · ${status.diskUsage.snapshotCount} pre-update data snapshot${status.diskUsage.snapshotCount === 1 ? "" : "s"} (${formatBytes(status.diskUsage.snapshotsBytes)}). Only the current and previous versions are kept.`}
        >
          {null}
        </SettingRow>
      ) : null}

      {status.error ? (
        <div className="ad-callout ad-callout--critical">
          <CircleAlert aria-hidden />
          <span>
            {status.error.message} ({status.error.code})
          </span>
        </div>
      ) : null}
    </>
  );
}

