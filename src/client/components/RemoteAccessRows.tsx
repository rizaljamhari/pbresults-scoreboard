import { useState, type KeyboardEvent } from "react";
import { ArrowUpRight, CircleAlert, Copy, Eye, EyeOff, Info, Power, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { useNow, useRemoteAccessStatus } from "../hooks";
import { showToast } from "../toast";
import {
  REMOTE_ACCESS_DEFAULT_DURATION_MINUTES,
  REMOTE_ACCESS_DURATIONS_MINUTES,
  type LocalRemoteAccessStatus,
  type RemoteAccessStatus
} from "../../shared/remoteAccess";
import { Button, Chip, SettingRow } from "./admin/kit";

const NGROK_AUTHTOKEN_URL = "https://dashboard.ngrok.com/get-started/your-authtoken";

export function formatTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(minutes: number): string {
  return minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
}

/** "1 h 42 min left", counting down to the server's fixed end time. */
export function formatRemaining(expiresAt: string | null, now: number): string {
  if (!expiresAt) return "";
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "ending now";
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min left` : `${minutes} min left`;
}

/** Open admin pages through the tunnel. Tabs, not people: everyone off site shares one login. */
export function formatRemoteConnections(count: number): string {
  if (count === 0) return "no one off site is connected";
  return count === 1 ? "1 person off site is connected" : `${count} people off site are connected`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isLocalStatus(status: RemoteAccessStatus | LocalRemoteAccessStatus): status is LocalRemoteAccessStatus {
  return status.managementAllowed && "configurationSource" in status;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ kind: "success", message: `${what} copied.` });
  } catch {
    showToast({ kind: "error", message: `Could not copy the ${what.toLowerCase()}. Select it and copy by hand.` });
  }
}

/** Remote access status and controls, drawn as rows inside the Settings "Remote access" group. */
export function RemoteAccessRows() {
  const remote = useRemoteAccessStatus();
  const status = remote.data;
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function runAction(name: string, action: () => Promise<LocalRemoteAccessStatus>, success?: string) {
    setBusyAction(name);
    try {
      remote.setData(await action());
      if (success) showToast({ kind: "success", message: success });
      return true;
    } catch (error) {
      showToast({ kind: "error", message: errorText(error, "Remote access failed.") });
      // The server records failures in lastError; show it without waiting for the event.
      remote.refresh?.();
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  if (!status) {
    return (
      <div className="ad-callout">
        <Info aria-hidden />
        <span>{remote.error ?? "Loading remote access…"}</span>
      </div>
    );
  }

  if (!isLocalStatus(status)) return <RemoteAccessReadOnly status={status} />;

  const sessionOn = status.phase === "active" || status.phase === "degraded";
  // A failed start leaves nothing open; a failed stop still holds the tunnel and needs Stop again.
  const stopStuck = status.phase === "failed" && status.lastError?.code === "REMOTE_ACCESS_STOP_FAILED";

  return (
    <>
      {status.lastError && !sessionOn ? (
        <div className="ad-callout ad-callout--critical">
          <CircleAlert aria-hidden />
          <span>{status.lastError.message}</span>
        </div>
      ) : null}

      {!status.configured ? (
        <TokenSetup busy={busyAction !== null} onSave={(token) => runAction("save", () => api.saveRemoteAccessToken(token), "ngrok connected.")} />
      ) : sessionOn ? (
        <ActiveSession status={status} busy={busyAction !== null} onStop={() => runAction("stop", api.stopRemoteAccess, "Remote access stopped.")} />
      ) : status.phase === "starting" || busyAction === "start" ? (
        <div className="ad-callout ad-callout--info">
          <Info aria-hidden />
          <span>Starting remote access and checking it works from the internet…</span>
        </div>
      ) : status.phase === "stopping" ? (
        <div className="ad-callout">
          <Info aria-hidden />
          <span>Stopping remote access…</span>
        </div>
      ) : stopStuck ? (
        <SettingRow title="Remote access did not stop cleanly" hint="Remote requests are already refused. Stop again to close the connection to ngrok.">
          <Button variant="danger" disabled={busyAction !== null} onClick={() => void runAction("stop", api.stopRemoteAccess, "Remote access stopped.")}>
            Stop again
          </Button>
        </SettingRow>
      ) : (
        <ConfiguredInactive
          status={status}
          busyAction={busyAction}
          onReplace={(token) => runAction("save", () => api.saveRemoteAccessToken(token), "ngrok authtoken replaced.")}
          onRemove={() => runAction("remove", api.removeRemoteAccessToken, "ngrok authtoken removed.")}
          onStart={(minutes) => runAction("start", () => api.startRemoteAccess(minutes))}
        />
      )}
    </>
  );
}

/** For LAN and remote browsers: what is happening, never the credentials or the controls. */
function RemoteAccessReadOnly({ status }: { status: RemoteAccessStatus }) {
  const now = useNow(30_000);
  const sessionOn = status.phase === "active" || status.phase === "degraded";
  return (
    <>
      <div className="ad-callout ad-callout--info">
        <Info aria-hidden />
        <span>
          {status.remoteRequest
            ? "You are connected through remote access. It is managed on the scoreboard computer."
            : "Remote access is set up and started on the scoreboard computer, through localhost."}
        </span>
      </div>
      <div className="ad-set-block">
        <b>
          Remote access{" "}
          {sessionOn ? <Chip tone={status.phase === "degraded" ? "critical" : "warning"}>{status.phase === "degraded" ? "Reconnecting" : "On"}</Chip> : <Chip>Off</Chip>}
        </b>
        <p className="ad-hint ad-break" style={{ margin: 0 }}>
          {sessionOn ? `${status.url ?? ""} · until ${formatTime(status.expiresAt)} · ${formatRemaining(status.expiresAt, now)}` : status.configured ? "Ready to start." : "Not set up."}
        </p>
      </div>
    </>
  );
}

function TokenInput({ busy, onSubmit, submitLabel, onCancel }: { busy: boolean; onSubmit: (token: string) => void; submitLabel: string; onCancel?: () => void }) {
  const [token, setToken] = useState("");
  const trimmed = token.trim();
  const submit = () => {
    if (trimmed && !busy) onSubmit(trimmed);
  };
  // This sits inside the Settings form: Enter must save the token, never the whole page.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <input
        className="ad-input"
        style={{ flex: "1 1 260px", minWidth: 0 }}
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-label="ngrok authtoken"
        placeholder="Paste the ngrok authtoken"
        value={token}
        disabled={busy}
        onChange={(event) => setToken(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button variant="primary" disabled={!trimmed || busy} onClick={submit}>
        {busy ? "Testing…" : submitLabel}
      </Button>
      {onCancel ? (
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}

function TokenSetup({ busy, onSave }: { busy: boolean; onSave: (token: string) => Promise<boolean> }) {
  return (
    <div className="ad-set-block">
      <b>Connect an ngrok account</b>
      <p className="ad-hint">
        Remote access lets trusted staff off site open this admin in a normal browser, through ngrok. Paste the account's authtoken once. It is saved
        on this computer only, outside event data and backups, and staff off site never see it. If this folder is ever copied somewhere else,
        replace the authtoken in the ngrok dashboard.
      </p>
      <TokenInput busy={busy} submitLabel="Save and test" onSubmit={(token) => void onSave(token)} />
      <div>
        <a className="ad-btn ad-btn--text" href={NGROK_AUTHTOKEN_URL} target="_blank" rel="noreferrer">
          Find your authtoken
          <ArrowUpRight aria-hidden />
        </a>
      </div>
    </div>
  );
}

function ConfiguredInactive({
  status,
  busyAction,
  onReplace,
  onRemove,
  onStart
}: {
  status: LocalRemoteAccessStatus;
  busyAction: string | null;
  onReplace: (token: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onStart: (minutes: number) => Promise<boolean>;
}) {
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [minutes, setMinutes] = useState<number>(REMOTE_ACCESS_DEFAULT_DURATION_MINUTES);
  const [acknowledged, setAcknowledged] = useState(false);
  const busy = busyAction !== null;
  const fromEnvironment = status.configurationSource === "environment";

  return (
    <>
      <SettingRow
        title={
          <>
            ngrok account <Chip tone="ok">Connected</Chip>
          </>
        }
        hint={fromEnvironment ? "Set by the NGROK_AUTHTOKEN environment variable, so it cannot be changed here." : "The authtoken is saved on this computer."}
      >
        {!fromEnvironment && !replacing ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setReplacing(true)}>
              Replace token
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Remove the ngrok authtoken from this computer? Remote access cannot start until a new one is saved.")) void onRemove();
              }}
            >
              Remove
            </Button>
          </>
        ) : null}
      </SettingRow>

      {replacing ? (
        <div className="ad-set-block">
          <TokenInput
            busy={busyAction === "save"}
            submitLabel="Save and test"
            onCancel={() => setReplacing(false)}
            onSubmit={(token) => void onReplace(token).then((ok) => ok && setReplacing(false))}
          />
        </div>
      ) : null}

      {!confirming ? (
        <SettingRow title="Remote access" hint="Off. Start it when someone off site needs to help, for a limited time.">
          <Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>
            <Power aria-hidden />
            Start remote access…
          </Button>
        </SettingRow>
      ) : (
        <div className="ad-set-block">
          <b>Start remote access</b>
          <label style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            Ends after
            <select className="ad-select" style={{ width: "auto" }} aria-label="Session length" value={minutes} disabled={busy} onChange={(event) => setMinutes(Number(event.target.value))}>
              {REMOTE_ACCESS_DURATIONS_MINUTES.map((value) => (
                <option key={value} value={value}>
                  {formatDuration(value)}
                </option>
              ))}
            </select>
          </label>
          <ul className="ad-hint" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>Anyone with the address, username and password gets full control of themes, settings, teams and live operations.</li>
            <li>Updates, backup restore and remote access itself stay on this computer only.</li>
            <li>Changes are shared: if two people edit the same thing, the last save wins.</li>
            <li>A new password is made every time. Stopping, or the time running out, locks everyone out at once.</li>
          </ul>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input className="ad-check" type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />I
            only share these details with trusted staff.
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              variant="primary"
              disabled={!acknowledged || busy}
              onClick={() =>
                void onStart(minutes).then((ok) => {
                  if (ok) {
                    setConfirming(false);
                    setAcknowledged(false);
                  }
                })
              }
            >
              {busyAction === "start" ? "Starting…" : "Start"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setAcknowledged(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function ActiveSession({ status, busy, onStop }: { status: LocalRemoteAccessStatus; busy: boolean; onStop: () => Promise<boolean> }) {
  const now = useNow(15_000);
  const [revealed, setRevealed] = useState(false);
  const credentials = status.credentials;
  const url = status.url ?? "";
  const degraded = status.phase === "degraded";
  // Separate lines, never user:password@host: that form leaks through history, previews and logs.
  const details = credentials ? `Address: ${url}\nUsername: ${credentials.username}\nPassword: ${credentials.password}\nEnds: ${formatTime(status.expiresAt)}` : "";

  return (
    <>
      {degraded ? (
        <div className="ad-callout ad-callout--critical">
          <TriangleAlert aria-hidden />
          <span>The connection to ngrok dropped and is reconnecting. Everything on this computer keeps working; staff off site may be cut off for now.</span>
        </div>
      ) : null}

      <SettingRow
        title={
          <>
            Remote access <Chip tone={degraded ? "critical" : "warning"}>{degraded ? "Reconnecting" : "On"}</Chip>
          </>
        }
        hint={`Started ${formatTime(status.startedAt)} · ends ${formatTime(status.expiresAt)} · ${formatRemaining(status.expiresAt, now)} · ${formatRemoteConnections(status.remoteConnections)}`}
      >
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Stop remote access now? Everyone off site is locked out at once.")) void onStop();
          }}
        >
          {busy ? "Stopping…" : "Stop remote access"}
        </Button>
      </SettingRow>

      <SettingRow title="Address" hint={<span className="ad-break">{url}</span>}>
        <Button variant="ghost" onClick={() => void copy(url, "Address")}>
          <Copy aria-hidden />
          Copy
        </Button>
      </SettingRow>

      {credentials ? (
        <>
          <SettingRow title="Username" hint={<span className="ad-break">{credentials.username}</span>}>
            <Button variant="ghost" onClick={() => void copy(credentials.username, "Username")}>
              <Copy aria-hidden />
              Copy
            </Button>
          </SettingRow>
          <SettingRow
            title="Password"
            hint={
              <input
                className="ad-input"
                style={{ width: "100%", maxWidth: 280 }}
                readOnly
                type={revealed ? "text" : "password"}
                autoComplete="new-password"
                aria-label="Remote access password"
                value={credentials.password}
              />
            }
          >
            <Button variant="ghost" aria-pressed={revealed} onClick={() => setRevealed((value) => !value)}>
              {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {revealed ? "Hide" : "Show"}
            </Button>
            <Button variant="ghost" onClick={() => void copy(credentials.password, "Password")}>
              <Copy aria-hidden />
              Copy
            </Button>
          </SettingRow>
          <SettingRow
            title="Send to staff off site"
            hint="Copies the address, username, password and end time as separate lines. Send them only to people you trust, ideally the password through a different channel."
          >
            <Button onClick={() => void copy(details, "Access details")}>
              <Copy aria-hidden />
              Copy access details
            </Button>
          </SettingRow>
        </>
      ) : null}

      <div className="ad-callout">
        <Info aria-hidden />
        <span>On ngrok's free plan, people off site first see an ngrok warning page and must click Visit Site before the password prompt.</span>
      </div>
    </>
  );
}
