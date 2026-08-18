import { useMemo, useState } from "react";
import { api } from "../api";
import { useUpdateStatus } from "../hooks";
import { showToast } from "../toast";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, FieldHint } from "./ui";

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

export function SoftwareUpdateCard({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) {
  const update = useUpdateStatus();
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
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Software updates</CardTitle>
            <CardDescription>{update.error ?? "Loading update status…"}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const activeWork = ["checking", "downloading", "verifying", "staging", "install-requested", "restarting"].includes(status.phase);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Software updates</CardTitle>
          <CardDescription>Stable Windows portable releases from the official GitHub repository.</CardDescription>
        </div>
        <Badge variant={status.managedUpdatesSupported ? "success" : "default"}>
          {status.managedUpdatesSupported ? `Version ${status.current.version}` : "Unavailable"}
        </Badge>
      </CardHeader>
      <CardContent>
        {!status.managedUpdatesSupported ? (
          <FieldHint>{status.unsupportedReason}</FieldHint>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <strong>Installed build</strong>
                <FieldHint>
                  {status.current.releaseTag ?? status.current.version}
                  {status.current.builtAt ? ` · built ${formatDate(status.current.builtAt)}` : ""}
                  {status.current.sourceCommit ? ` · ${status.current.sourceCommit.slice(0, 8)}` : ""}
                </FieldHint>
              </div>
              <div>
                <strong>Last checked</strong>
                <FieldHint>{formatDate(status.lastCheckedAt)}</FieldHint>
              </div>
            </div>

            {!isLocal ? (
              <p className="rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainerLow p-3 text-sm text-md3-onSurfaceVariant">
                Open this Settings page through localhost on the scoreboard computer to control updates.
              </p>
            ) : null}

            {status.lastResult ? (
              <div className="rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainerLow p-4">
                <strong>
                  {status.lastResult.outcome === "succeeded"
                    ? "Update completed"
                    : status.lastResult.outcome === "rolled-back"
                      ? "Update rolled back safely"
                      : "Update failed"}
                </strong>
                <FieldHint>
                  {status.lastResult.fromVersion} → {status.lastResult.targetVersion} · {status.lastResult.message}
                </FieldHint>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="ghost"
                  onClick={() => void runAction("dismiss", api.dismissUpdateResult)}
                >
                  Dismiss
                </Button>
              </div>
            ) : null}

            {status.available ? (
              <div className="rounded-md3m border border-md3-primary/40 bg-md3-primary/5 p-4">
                <strong>Version {status.available.version} is available</strong>
                <FieldHint>
                  Published {formatDate(status.available.publishedAt)} · {formatBytes(status.available.assetSize)}
                  {status.skippedVersion === status.available.version ? " · skipped for automatic notices" : ""}
                </FieldHint>
                <div className="action-row compact mt-3">
                  <a className="text-sm font-semibold text-md3-primary underline" href={status.available.releasePageUrl} target="_blank" rel="noreferrer">
                    View release notes
                  </a>
                  {!status.prepared ? (
                    <Button
                      size="sm"
                      disabled={!isLocal || activeWork || Boolean(busyAction)}
                      onClick={() => void runAction("download", () => api.downloadUpdate(status.available!.version))}
                    >
                      Download update
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!isLocal || activeWork || Boolean(busyAction)}
                    onClick={() => void runAction("skip", () => api.toggleSkipUpdate(status.available!.version))}
                  >
                    {status.skippedVersion === status.available.version ? "Unskip version" : "Skip this version"}
                  </Button>
                </div>
              </div>
            ) : null}

            {status.prepared && ["downloading", "verifying", "staging"].includes(status.phase) ? (
              <div>
                <strong>{status.phase === "downloading" ? `Downloading ${progress}%` : status.phase === "verifying" ? "Verifying download" : "Preparing update"}</strong>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-md3-surfaceContainerHigh">
                  <div className="h-full bg-md3-primary transition-all" style={{ width: `${status.phase === "downloading" ? progress : 100}%` }} />
                </div>
                <FieldHint>
                  {formatBytes(status.prepared.downloadedBytes)} of {formatBytes(status.prepared.totalBytes)}
                </FieldHint>
              </div>
            ) : null}

            {status.phase === "ready-to-install" && status.prepared ? (
              <div className="rounded-md3m border border-md3-outlineVariant p-4">
                <strong>Version {status.prepared.version} is ready to install</strong>
                <FieldHint>
                  Choose a non-live moment. The updater will stop the server, create a local data snapshot, restart on the same port, and roll back automatically if health checks fail.
                </FieldHint>
                {hasUnsavedChanges ? <p className="text-sm text-md3-danger">Save or discard Settings changes before restarting.</p> : null}
                {!showInstallConfirmation ? (
                  <Button
                    className="mt-3"
                    disabled={!isLocal || hasUnsavedChanges}
                    onClick={() => setShowInstallConfirmation(true)}
                  >
                    Install and restart
                  </Button>
                ) : (
                  <div className="mt-3 grid gap-3">
                    <label className="checkbox">
                      <Checkbox checked={restartAcknowledged} onChange={(event) => setRestartAcknowledged(event.target.checked)} />
                      I understand the admin UI and overlay will briefly disconnect.
                    </label>
                    <div className="action-row compact">
                      <Button
                        disabled={!restartAcknowledged || Boolean(busyAction)}
                        onClick={() => void runAction("install", () => api.installUpdate(status.prepared!.version))}
                      >
                        Confirm install and restart
                      </Button>
                      <Button variant="ghost" onClick={() => setShowInstallConfirmation(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {status.error ? (
              <div className="rounded-md3m border border-md3-danger/50 bg-md3-danger/5 p-4">
                <strong>{status.error.code}</strong>
                <FieldHint>{status.error.message}</FieldHint>
              </div>
            ) : null}

            <div className="action-row compact">
              <Button
                variant="secondary"
                disabled={!isLocal || activeWork || Boolean(busyAction)}
                onClick={() => void runAction("check", api.checkForUpdate)}
              >
                {status.phase === "checking" ? "Checking…" : "Check for updates"}
              </Button>
              {status.rollbackAvailable ? (
                <Button
                  variant="outline"
                  disabled={!isLocal || activeWork || hasUnsavedChanges || Boolean(busyAction)}
                  onClick={() => {
                    if (window.confirm("Roll back to the previous healthy app version and restart? Current data will be snapshotted first.")) {
                      void runAction("rollback", api.rollbackUpdate);
                    }
                  }}
                >
                  Roll back previous version
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
