# Automatic Updates Technical Plan

Status: implemented; physical/VM Windows qualification pending
Roadmap priority: 1  
Initial target: Windows x64 portable package  
Release channel: stable GitHub Releases only  
Source repository: `rizaljamhari/pbresults-scoreboard`  
Last reviewed: 2026-08-18

## 1. Objective

Add a managed update workflow that lets an onsite operator update the Windows portable application without manually replacing the `app/` folder.

The completed workflow must:

1. identify the installed portable version reliably
2. find a newer stable release from the official GitHub repository
3. download and validate the matching Windows portable archive
4. prepare the release while the current server remains available
5. require an explicit local installation confirmation
6. stop the running server cleanly
7. create a consistent local snapshot of persistent data
8. activate the new application without overwriting persistent data or logs
9. restart on the same port
10. verify application health and version
11. automatically roll back after a failed start or failed health check
12. leave enough state for recovery after power loss at any installation phase

## 2. Existing baseline

The repository already provides most release-side prerequisites:

- `scripts/release.mjs` validates a stable semantic version and pushes an annotated tag.
- `.github/workflows/build-windows-portable.yml` builds tagged releases on Windows.
- The workflow publishes one versioned Windows portable ZIP to the matching GitHub Release.
- `scripts/package-windows-portable.mjs` separates replaceable `app/` files from persistent `data/` and `logs/`.
- Tagged builds write `appVersion` and `releaseTag` into root `BUILD-INFO.json`.
- `scripts/portable-launcher.mjs` selects a port, opens the admin page, launches the server, and records output.
- Existing version helpers accept only stable `MAJOR.MINOR.PATCH` tags.

Important gaps:

- Updating still requires stopping the application and replacing `app/` manually.
- The running application does not expose reliable packaged build metadata.
- `BUILD-INFO.json` is currently outside `app/`; following the documented app-only replacement process can leave it stale.
- There is no update feed contract or release-asset checksum.
- The current launcher lives inside the replaceable application and cannot coordinate an atomic version switch by itself.
- There is no health endpoint, install transaction, recovery journal, or rollback coordinator.
- All APIs are currently unauthenticated and the server listens on the LAN, so update mutations cannot safely be generally network-accessible.

## 3. Goals

### 3.1 Functional goals

- Report the current release version in Settings.
- Check for a stable update automatically and manually.
- Show available version, publication time, and a link to GitHub release notes.
- Download and stage without interrupting polling, overlay rendering, or admin use.
- Display download and preparation progress.
- Install only after explicit confirmation.
- Preserve `data/` and `logs/`.
- Preserve the selected server port across the restart.
- Restore the previous application and data snapshot automatically if the new version is unhealthy.
- Support one manual rollback to the immediately previous healthy version.
- Record the result so the restarted UI can explain success, rollback, or failure.

### 3.2 Reliability goals

- Never execute an archive that failed manifest or digest verification.
- Never extract an archive entry outside its staging directory.
- Never activate a partially extracted application.
- Never modify the active application directory in place.
- Never overwrite `data/` or `logs/` from release ZIP contents.
- Keep the active pointer valid before and after each atomic write.
- Make every install phase idempotent or recoverable.
- Leave the previous version untouched until the new version passes health verification.

### 3.3 User-experience goals

- Normal startup remains one double-click.
- Update checks do not block startup.
- Offline checks fail quietly into a visible, retryable status.
- Operators can postpone or skip a release.
- The UI gives a strong warning that the overlay and admin UI will reconnect during installation.
- No update installs automatically.
- A successful update returns the browser to a usable page without requiring file operations.

## 4. Non-goals for the first release

- Silent or unattended update installation.
- Prerelease, beta, nightly, or multiple release channels.
- Delta/binary patch downloads.
- Managed updates for macOS, Linux, development checkouts, or generic `pnpm start` deployments.
- Background Windows services.
- Application code signing or Windows installer signing.
- Updating Node independently from the application archive.
- Restoring arbitrary historical versions from GitHub.
- Cloud backup integration.
- Remote update installation before authentication and authorization are implemented.
- Data-schema migrations that cannot be reversed by restoring the pre-update snapshot.

## 5. Architectural decisions

### 5.1 GitHub Releases are the update source

The runtime checks:

```text
GET https://api.github.com/repos/rizaljamhari/pbresults-scoreboard/releases/latest
```

The request uses:

- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2026-03-10`
- a specific application `User-Agent`
- `If-None-Match` when a cached ETag exists
- a finite connection and response timeout

The repository is compiled into the packaged application. It is not an operator-editable URL. Tests may override the API base URL through an environment variable, but production UI and persisted settings cannot change the repository or feed.

The response is accepted only when:

- it is not a draft
- it is not a prerelease
- its tag matches stable `vMAJOR.MINOR.PATCH`
- the version is greater than the installed version
- it contains exactly one matching update manifest asset
- the manifest and release tag agree

Release notes are opened using GitHub's `html_url`. Remote release Markdown or HTML is not rendered inside the admin application.

### 5.2 A release manifest is the machine-readable contract

Each tagged release publishes two required assets:

```text
pbresults-scoreboard-windows-portable-v1.8.0.zip
pbresults-scoreboard-update-manifest-v1.8.0.json
```

Manifest schema version 1:

```json
{
  "schemaVersion": 1,
  "release": {
    "version": "1.8.0",
    "tag": "v1.8.0",
    "channel": "stable",
    "builtAt": "2026-08-17T12:00:00.000Z"
  },
  "target": {
    "platform": "win32",
    "arch": "x64",
    "packageKind": "portable"
  },
  "protocol": {
    "minimumUpdaterVersion": 1
  },
  "asset": {
    "name": "pbresults-scoreboard-windows-portable-v1.8.0.zip",
    "size": 123456789,
    "unpackedSize": 234567890,
    "sha256": "lowercase-64-character-hex-digest"
  },
  "payload": {
    "rootDirectory": "PBResults-Scoreboard",
    "applicationDirectory": "app",
    "buildInfoFile": "app/BUILD-INFO.json",
    "serverEntry": "app/dist/server/server/index.js"
  }
}
```

Validation rules:

- Reject unknown manifest schema versions.
- Reject a target other than `win32`, `x64`, and `portable`.
- Reject unsupported updater protocol requirements.
- Require the manifest filename, release tag, manifest version, ZIP filename, and embedded build metadata to agree.
- Treat sizes as non-negative safe integers and enforce a configured maximum.
- Enforce a 2 GiB archive hard limit and a 5 GiB unpacked-payload hard limit in updater protocol 1.
- Require a lowercase SHA-256 digest.
- Require payload paths to be normalized relative paths with no drive prefix, absolute root, empty segment, `.` segment, or `..` segment.

The SHA-256 digest detects corruption or asset substitution relative to the manifest. It does not protect against compromise of the GitHub repository or release credentials. Signed manifests and Windows code signing remain a later hardening step.

### 5.3 Packaged build metadata lives with each application version

`BUILD-INFO.json` must be copied into the packaged `app/` directory, not only the portable root.

Proposed embedded shape:

```json
{
  "schemaVersion": 1,
  "appVersion": "1.8.0",
  "releaseTag": "v1.8.0",
  "builtAt": "2026-08-17T12:00:00.000Z",
  "target": "windows-x64-portable",
  "bundledNodeVersion": "22.x.y",
  "updaterProtocolVersion": 1,
  "sourceRepository": "rizaljamhari/pbresults-scoreboard",
  "sourceCommit": "full-git-commit-sha"
}
```

The launcher sets `APP_BUILD_INFO_PATH` to the active application's file. The server validates it at startup. Development mode uses package metadata for display but returns `managedUpdatesSupported: false`.

The external release manifest and embedded build information must be generated from the same release metadata object to prevent drift.

### 5.4 Application versions are immutable directories

Target portable layout after the first managed update:

```text
PBResults-Scoreboard/
  Run Scoreboard.cmd
  portable-launcher.ps1
  portable-updater.ps1
  current-version.json
  app/                              legacy initial application
  versions/
    v1.8.0/                         immutable application directory
    v1.9.0/                         immutable application directory
  data/                             persistent application state
  logs/                             persistent runtime logs
  backups/
    pre-update/
  updates/
    downloads/
    staging/
    transactions/
    update-state.json
    update.lock
```

The first updater-enabled release can still run from the existing `app/` directory. Its startup bootstrap installs the stable root scripts and writes:

```json
{
  "schemaVersion": 1,
  "generation": 1,
  "active": {
    "version": "1.8.0",
    "releaseTag": "v1.8.0",
    "relativePath": "app"
  },
  "previous": null,
  "updatedAt": "2026-08-17T12:00:00.000Z"
}
```

The next managed update extracts only the release's application payload and moves it to `versions/v1.9.0`. It does not overlay the root of the downloaded portable bundle.

Do not use Windows symbolic links or junctions for the active pointer. They can require privileges or interact poorly with extraction tools. The launcher reads `current-version.json` and starts the executable under its relative path.

### 5.5 A stable root process owns activation and rollback

The running application must not replace itself. A root-level PowerShell coordinator performs installation after the application requests shutdown.

Responsibilities are split as follows:

**Server update service**

- check GitHub
- validate release and manifest metadata
- download with progress
- hash while downloading
- invoke safe staging/extraction
- expose status to the UI
- request an install transaction
- spawn the detached root updater
- gracefully close Fastify and exit

**Root updater coordinator**

- acquire the cross-process update lock
- validate the prepared transaction again
- wait for the old server process to exit
- create the stopped-state data snapshot
- finalize the staged application directory
- atomically update `current-version.json`
- start the selected application on the previous port
- poll the health endpoint
- commit success or perform rollback
- write the final result to persistent update state

**Root launcher**

- validate the active pointer and application path
- fall back to `previous` if the active path is absent or structurally invalid
- set root, data, upload, log, active-app, and build-info environment variables
- start the active bundled Node runtime and `start-portable.mjs`
- preserve the existing console/log behavior
- participate in incomplete-transaction recovery

PowerShell is used only as the stable Windows coordinator. Application logic, GitHub parsing, and UI status remain TypeScript. Root scripts receive versioned protocol tests in Windows CI.

### 5.6 Activation uses an atomic pointer, not directory overwrite

Activation algorithm:

1. Write the next pointer to `current-version.json.tmp` in the same directory.
2. Flush and close the temporary file.
3. Parse it again and validate its referenced application.
4. Replace `current-version.json` with the temporary file using a same-volume rename/replace operation.
5. Keep the previous pointer in the new document.

If activation fails before step 4, the old pointer remains active. If power is lost after step 4, the launcher sees either the complete old document or the complete new document, never an intentionally partial JSON file.

### 5.7 Installation is explicit and local-only

Automatic checking is enabled by default. Automatic download is initially disabled. Automatic installation does not exist.

Until application authentication and authorization are delivered:

- update check status may be read from the LAN
- `check`, `download`, `install`, and `rollback` mutations accept loopback requests only
- Fastify proxy trust remains disabled so forwarded headers cannot fake loopback origin
- the install request must include the exact expected version and an explicit confirmation token
- the server rejects installation when the prepared version no longer matches the request

The Settings page shown through `localhost` is the supported update-control surface for v1.

## 6. Update state model

### 6.1 Public status schema

Create shared Zod schemas and TypeScript types in `src/shared/update.ts`.

```ts
type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "update-available"
  | "downloading"
  | "verifying"
  | "staging"
  | "ready-to-install"
  | "install-requested"
  | "restarting"
  | "succeeded"
  | "rolled-back"
  | "failed";

type UpdateStatus = {
  managedUpdatesSupported: boolean;
  unsupportedReason: string | null;
  phase: UpdatePhase;
  current: {
    version: string;
    releaseTag: string | null;
    builtAt: string | null;
    sourceCommit: string | null;
    updaterProtocolVersion: number | null;
  };
  available: {
    version: string;
    releaseTag: string;
    publishedAt: string;
    releasePageUrl: string;
    assetSize: number;
  } | null;
  prepared: {
    version: string;
    releaseTag: string;
    downloadedBytes: number;
    totalBytes: number;
    stagedAt: string | null;
  } | null;
  lastCheckedAt: string | null;
  nextAutomaticCheckAt: string | null;
  skippedVersion: string | null;
  lastResult: {
    outcome: "succeeded" | "rolled-back" | "failed";
    fromVersion: string;
    targetVersion: string;
    completedAt: string;
    message: string;
  } | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
};
```

Persist only restart-relevant fields. Derive transient phases such as checking and byte progress in memory. On startup, merge the root updater's final result into the current build information and normalize stale in-progress states.

### 6.2 Internal transaction journal

Each install writes `updates/transactions/<transaction-id>.json`:

```ts
type UpdateTransactionPhase =
  | "prepared"
  | "shutdown-requested"
  | "old-process-stopped"
  | "snapshot-created"
  | "payload-finalized"
  | "pointer-activated"
  | "new-process-started"
  | "health-confirmed"
  | "rollback-started"
  | "rollback-completed"
  | "committed"
  | "failed";
```

The journal records:

- transaction id
- phase and phase timestamps
- source and target versions
- expected archive and manifest hashes
- old and new relative application paths
- previous server port
- old server and launcher process ids where available
- staged payload path
- pre-update snapshot path and checksum summary
- health deadline
- rollback outcome
- sanitized error code and message

Write journal updates atomically through a temporary file and same-directory replace.

### 6.3 Error codes

Use stable error codes so the UI and tests do not parse prose:

- `UPDATE_UNSUPPORTED_RUNTIME`
- `UPDATE_CHECK_OFFLINE`
- `UPDATE_GITHUB_RATE_LIMITED`
- `UPDATE_RELEASE_INVALID`
- `UPDATE_MANIFEST_MISSING`
- `UPDATE_MANIFEST_INVALID`
- `UPDATE_PROTOCOL_UNSUPPORTED`
- `UPDATE_ALREADY_CURRENT`
- `UPDATE_DOWNLOAD_FAILED`
- `UPDATE_DOWNLOAD_TOO_LARGE`
- `UPDATE_DIGEST_MISMATCH`
- `UPDATE_INSUFFICIENT_DISK_SPACE`
- `UPDATE_ARCHIVE_UNSAFE`
- `UPDATE_PAYLOAD_INVALID`
- `UPDATE_BUSY`
- `UPDATE_LOCAL_REQUEST_REQUIRED`
- `UPDATE_CONFIRMATION_REQUIRED`
- `UPDATE_SHUTDOWN_TIMEOUT`
- `UPDATE_SNAPSHOT_FAILED`
- `UPDATE_ACTIVATION_FAILED`
- `UPDATE_HEALTH_TIMEOUT`
- `UPDATE_VERSION_MISMATCH`
- `UPDATE_ROLLBACK_FAILED`

## 7. Server API

Add the following routes to `src/server/index.ts`.

### `GET /api/update/status`

Returns `UpdateStatus`.

This route never starts network work. It is safe for Settings polling and reports unsupported development environments without returning an error status.

### `POST /api/update/check`

Loopback-only for v1.

Behavior:

- return `409 UPDATE_BUSY` if download, stage, install, or rollback is active
- start a fresh GitHub check, bypassing only the time cache while still using ETag validation
- return the resulting `UpdateStatus`
- map offline and rate-limit failures into retryable status without losing a previously known available update

### `POST /api/update/download`

Request:

```json
{ "version": "1.8.0" }
```

Loopback-only for v1.

Behavior:

- require an available release with exactly that version
- enforce a single download/staging task
- return `202` with current status
- stream to an archive ending in `.part`
- calculate SHA-256 during the stream
- periodically update in-memory progress without writing every chunk to disk state
- validate final size and digest
- rename `.part` only after successful verification
- extract into a transaction-specific staging directory
- validate staged payload and embedded `BUILD-INFO.json`
- transition to `ready-to-install`

The UI polls status once per second while work is active and less frequently while idle. A new update-specific SSE route is unnecessary in v1.

### `POST /api/update/install`

Request:

```json
{
  "version": "1.8.0",
  "confirmation": "INSTALL_AND_RESTART"
}
```

Loopback-only for v1.

Behavior:

- require `ready-to-install`
- require the exact prepared version
- rerun disk, path, manifest, staged payload, and coordinator protocol checks
- create the transaction journal
- spawn the detached root updater with only the transaction path as its argument
- schedule graceful application shutdown after the `202` response is flushed
- stop accepting new connections
- close Fastify, polling subscriptions, and log streams cleanly
- exit with the documented update-requested code

The external updater never accepts archive URLs, target paths, or hashes directly from an HTTP request. It reads the server-created, validated transaction journal and validates it again against root containment rules.

### `POST /api/update/skip`

Request:

```json
{ "version": "1.8.0" }
```

Loopback-only for v1.

Persists the skipped version. Automatic checks suppress its banner, while manual checks continue to show it with an **Unskip** action. A later version is not skipped automatically.

### `POST /api/update/rollback`

Request:

```json
{
  "confirmation": "ROLL_BACK_AND_RESTART"
}
```

Loopback-only and offered only when:

- `current-version.json.previous` exists
- the referenced application passes structural validation
- no other update transaction is active

Manual rollback follows the same coordinator and health-check path. It creates a fresh data snapshot before switching. Restoring the older pre-update data snapshot is a separate, explicit confirmation because a successful newer app may have legitimate operator changes that must not be silently discarded.

## 8. Check and download behavior

### 8.1 Automatic check schedule

- Delay the first automatic check by 30 seconds after server readiness.
- Check every 6 hours while the app remains running.
- Add randomized jitter of up to 10 minutes for the recurring check.
- Persist the last check time and ETag.
- Do not retry aggressively while offline.
- After a retryable failure, use bounded backoff: 15 minutes, 1 hour, then the normal interval.
- Respect GitHub rate-limit reset headers.

Proposed settings defaults:

```ts
updateCheckEnabled: true;
updateCheckIntervalHours: 6;
updateAutoDownload: false;
```

These settings belong in `AppSettings` and normal backups. Feed identity, coordinator paths, and trust configuration do not.

### 8.2 Download implementation

- Use a temporary filename scoped by version and transaction id.
- Set explicit connect, idle, and total-duration timeouts.
- Require HTTPS.
- Validate the initial host and expected GitHub asset identity.
- Limit redirects to GitHub-controlled release asset hosts and a small maximum redirect count.
- Abort if `Content-Length` disagrees with the manifest when supplied.
- Abort when received bytes exceed manifest size before completion.
- Stream directly to disk; do not buffer the archive in memory.
- Update the SHA-256 hash from the same byte stream written to disk.
- `fsync` the completed file before rename where supported.
- Remove `.part` after cancellation, mismatch, or failure.
- Reuse an already verified archive only when its size and freshly calculated digest still match.

### 8.3 Disk-space preflight

Before downloading and again before installation, require free space for:

```text
archive size
+ unpacked application size
+ current data directory size for the safety snapshot
+ 250 MB fixed safety margin
+ 10% variable safety margin
```

The UI reports required and available bytes when this check fails. Unknown filesystem capacity is a blocking error rather than permission to continue.

## 9. Secure staging and payload validation

Use .NET ZIP APIs from the root PowerShell helper to inspect and extract each entry explicitly.

For every archive entry:

1. reject empty or malformed names where a file is expected
2. reject absolute paths and drive-qualified paths
3. combine the entry with the staging root
4. canonicalize with `System.IO.Path.GetFullPath`
5. require the result to remain under the canonical staging root plus directory separator
6. reject reparse points and links
7. enforce per-entry and total extracted-size limits
8. create directories explicitly
9. write files with create-new semantics

After extraction, require:

- exactly one declared portable root directory
- the declared application directory
- bundled `node/node.exe`
- `start-portable.mjs`
- `dist/client/`
- `dist/server/server/index.js`
- `package.json`
- embedded `BUILD-INFO.json`
- no release-provided `data/` or `logs/` content is selected for activation

Parse and validate embedded build information. It must match the release, manifest, platform, architecture, source repository, and expected updater protocol.

Only after all checks pass, rename the staged application to `updates/staging/<transaction-id>/prepared-app` and write a prepared marker containing a digest of its structural inventory.

## 10. Install transaction

### 10.1 Pre-shutdown preparation

Complete before interrupting the current application:

- release and manifest validation
- archive download and SHA-256 verification
- safe extraction
- embedded build validation
- disk-space calculation
- coordinator protocol compatibility
- staged payload inventory
- transaction journal creation

This keeps normal update downtime limited to shutdown, snapshot, activation, restart, and health verification.

### 10.2 Graceful shutdown

Refactor server startup/shutdown so update installation can:

- stop automatic update timers
- stop live polling timers
- stop accepting new HTTP connections
- close SSE connections with a retry hint
- call `app.close()`
- flush logs and transaction state
- exit within a bounded timeout

The updater waits for the recorded server PID to exit. If graceful shutdown exceeds 20 seconds, it records `UPDATE_SHUTDOWN_TIMEOUT` and leaves the old pointer active. The initial implementation must not force-kill a healthy old application merely to install an optional update.

### 10.3 Pre-update data snapshot

After the old server has stopped, copy the complete `data/` directory to:

```text
backups/pre-update/<UTC timestamp>-v<old>-to-v<new>/data/
```

Also write `snapshot.json` containing:

- source and target versions
- transaction id
- timestamp
- file count
- total bytes
- relative file names, sizes, and SHA-256 digests
- snapshot completion marker

Write into a `.partial` directory and rename only after every file and the manifest have been flushed and validated. A failed snapshot aborts installation while the old version remains active.

This snapshot is the update safety mechanism, not the final scheduled-backup product. Keep the latest three successful pre-update snapshots by default; never prune the only snapshot associated with an unresolved failed transaction.

### 10.4 Finalize application version

Move the prepared application directory to:

```text
versions/v<target-version>/
```

Rules:

- the target must be a direct child of `versions/`
- do not overwrite an existing non-identical directory
- if an identical, structurally valid version already exists, it may be reused
- if an invalid collision exists, quarantine it under `updates/quarantine/` and fail safely
- application directories become read-only by convention after activation; runtime writes must continue to use root `data/`, `logs/`, and `updates/`

### 10.5 Activate and restart

1. Atomically set the target as `active` and old application as `previous`.
2. Record `pointer-activated` in the journal.
3. Start the root launcher with the previous server port and browser-open disabled.
4. Record the new launcher PID.
5. Poll `http://127.0.0.1:<port>/api/health` for up to 60 seconds.

Health succeeds only when the endpoint returns:

```json
{
  "status": "ok",
  "ready": true,
  "appVersion": "1.8.0",
  "releaseTag": "v1.8.0",
  "target": "windows-x64-portable",
  "dataReadable": true,
  "clientBuildPresent": true
}
```

The version and tag must exactly match the transaction target. A response from an unrelated process on the same port does not pass.

### 10.6 Commit success

After health succeeds:

- mark the transaction `health-confirmed`, then `committed`
- write `lastResult.outcome = "succeeded"`
- retain the previous application for rollback
- retain the pre-update snapshot
- remove the verified archive and staging directory according to retention policy
- allow the application to prune versions older than active plus previous on a later clean startup

The updater exits without opening another browser. Existing browser tabs reconnect to the same origin.

## 11. Automatic rollback

Rollback triggers when:

- the new process cannot start
- the health deadline expires
- health reports the wrong version
- required data or client build checks fail
- the new launcher exits before becoming healthy

Rollback algorithm:

1. Mark `rollback-started`.
2. Stop the unhealthy new process tree if it started.
3. Move the new application out of the active position only by pointer change; keep its directory for diagnostics.
4. Restore the old application pointer atomically.
5. Because the new process may have mutated persistent state before failing, move current `data/` to a transaction-specific failed-data quarantine.
6. Restore the completed pre-update snapshot to `data/` through a temporary directory and atomic rename.
7. Restart the previous version on the same port.
8. Verify the previous version through the same health contract.
9. Write `rolled-back` when the old version is healthy.

If the previous version also fails health verification:

- do not loop between versions
- preserve both application directories, the current data quarantine, and the snapshot
- write `UPDATE_ROLLBACK_FAILED`
- print explicit recovery paths in the updater console and root log
- keep the updater console open so the onsite operator can read the failure

## 12. Power-loss and interrupted-transaction recovery

The root launcher examines the latest nonterminal transaction before every start.

Recovery matrix:

| Last durable phase | Expected state | Launcher action |
| --- | --- | --- |
| `prepared` or `shutdown-requested` | Old pointer active | Start old version; mark transaction interrupted |
| `old-process-stopped` | Old pointer active, snapshot may be absent | Start old version; do not activate |
| `snapshot-created` or `payload-finalized` | Old pointer active | Start old version; retain prepared payload for retry |
| `pointer-activated` or `new-process-started` | New pointer active | Start new version once and resume bounded health verification |
| `rollback-started` | Pointer may be old or new | Prefer structurally valid old pointer, restore snapshot if completion markers require it, then verify once |
| `health-confirmed` | New pointer active | Mark committed and start new version |

Additional rules:

- Never infer completion from directory existence alone; require journal and completion markers.
- Never delete a snapshot or application involved in a nonterminal transaction.
- Limit automated recovery to one attempt per transaction and boot to prevent loops.
- Write all recovery decisions to `logs/updater.log` and the transaction journal.

## 13. Browser and overlay reconnection

The server restart should preserve the previous port. Existing browser JavaScript will temporarily lose API and SSE connections.

Add the active application version to `/api/runtime-info`. Add a lightweight version watcher to the admin shell and live overlay:

1. remember the version loaded with the page
2. while the API is unavailable, continue existing retry behavior
3. after connectivity returns, compare runtime version
4. when it changes, perform one controlled `window.location.reload()`
5. guard against reload loops using session storage and a timestamp

This ensures the overlay loads the new client bundle rather than continuing indefinitely with an older in-memory JavaScript build against a newer server.

Target behavior:

- admin page reconnects or reloads automatically
- live overlay reloads automatically on the same URL
- vMix/OBS browser source does not need its URL changed
- the screen may be unavailable briefly, which is why installation requires explicit operator timing

## 14. Settings UI

Add a `SoftwareUpdateCard` to `SettingsPage` rather than expanding the existing settings form state.

### 14.1 Idle/current state

Display:

- installed version and release tag
- build date and short source commit when available
- managed update support status
- last successful check
- automatic-check enabled state
- **Check for updates** button

### 14.2 Update available

Display:

- available version
- release publication time
- archive download size
- **View release notes** external link
- **Download update**
- **Skip this version**

Do not render release-note HTML inside the application.

### 14.3 Downloading and staging

Display:

- downloaded and total bytes
- percentage when total is known
- current phase: downloading, verifying, or preparing
- non-dismissable progress while the operation owns the update lock
- retry action after a retryable failure

Cancellation is not required in v1. Closing the browser does not cancel the server-side task.

### 14.4 Ready to install

Display:

- prepared version
- expected restart warning
- confirmation that a local safety snapshot will be created
- reminder to choose a non-live moment
- **Install and restart** button

The button opens a confirmation dialog requiring a checkbox such as:

> I understand the admin UI and overlay will briefly disconnect.

The client sends the exact version and fixed confirmation token only after confirmation.

### 14.5 Result after restart

Display a persistent result banner once:

- success: old and new version
- automatic rollback: target version and sanitized reason
- failure: actionable recovery message and updater log location

Allow the operator to dismiss the banner without deleting the underlying update history.

### 14.6 Unsaved settings interaction

If `SettingsPage` has unsaved changes:

- downloading remains allowed
- installation is disabled
- explain that settings must be saved or discarded before restart

The API remains authoritative and independently checks install readiness; UI disabling is not the only safeguard.

## 15. Runtime and launcher changes

### 15.1 Runtime paths

Extend `src/server/runtimePaths.ts` with validated paths or metadata for:

- active application directory
- build-info file
- update work directory
- pre-update backup directory
- root coordinator scripts

Never derive writable update destinations from request input. Resolve all paths from trusted `APP_ROOT_DIR` and validate containment.

### 15.2 Health endpoint

Add `GET /api/health` independent of upstream PBResults availability. An upstream feed error must not cause update rollback.

Readiness checks only local application integrity:

- server route registration completed
- persistent data directory passed its startup read/write probe
- settings/themes/teams/assets/operations files parse successfully
- client build exists in packaged mode
- build metadata parses successfully

Do not mutate data merely to answer health. Run a create, flush, and delete probe once during startup, cache its result, and add a storage-validation function separate from bootstrap writes for the health route.

### 15.3 Root bootstrap

On startup of the first updater-enabled release:

- detect packaged Windows portable mode
- atomically install missing root launcher/updater templates from the active application
- replace an older root coordinator only when the packaged coordinator version is newer and no coordinator holds the update lock
- never overwrite a newer root coordinator protocol with an older template
- create and validate `current-version.json` pointing to legacy `app/` when absent
- create update working directories
- verify root and update directories are writable
- report unsupported status instead of crashing when bootstrap cannot be installed

This lets operators perform the existing manual `app/` replacement one final time to receive the updater. All subsequent supported releases can use managed updates.

### 15.4 Coordinator protocol upgrades

Every root script reports an integer protocol version. A release manifest declares its minimum.

For v1:

- updater protocol 1 installs packages requiring protocol 1
- a package requiring a newer protocol is downloaded only if desired but cannot be installed
- UI explains that a manual bootstrap update is required

Coordinator self-upgrade uses an independent integer version marker in each PowerShell script. Bootstrap validates a
same-directory temporary copy, flushes it, and atomically replaces the root script only when the packaged version is
newer. Identical or newer root scripts are retained. An active updater lock defers replacement until the next normal
startup so a transaction never changes the coordinator scripts it is using.

Existing v1.9 installations still need a one-time manual root-script repair. Their running bootstrap only copies a
coordinator when it is missing, so it cannot acquire this self-upgrade behavior automatically. The repair replaces
only `portable-launcher.ps1` and `portable-updater.ps1`; persistent `data/` must remain untouched.

## 16. Release pipeline changes

### 16.1 Packaging script

Update `scripts/package-windows-portable.mjs` to:

- write embedded `app/BUILD-INFO.json`
- include source commit and updater protocol
- include root launcher and updater templates
- include copies under `app/updater-bootstrap/` for existing-layout bootstrap
- calculate the final ZIP byte size and SHA-256 digest
- calculate unpacked application size
- generate the versioned update manifest
- verify the generated manifest against build information
- retain the current full portable ZIP for clean installations

The package command should produce exactly:

```text
release/windows-portable/
  PBResults-Scoreboard/
  pbresults-scoreboard-windows-portable-v1.8.0.zip
  pbresults-scoreboard-update-manifest-v1.8.0.json
```

For untagged/manual builds, generate test metadata but do not publish it as a stable update.

### 16.2 GitHub Actions workflow

Update `.github/workflows/build-windows-portable.yml` to:

- upload both ZIP and manifest as Actions artifacts
- validate that one ZIP and one matching manifest exist
- parse the manifest in PowerShell
- recompute ZIP size and SHA-256 on the runner
- compare tag, filename, size, and digest before release upload
- upload both assets to the draft GitHub Release
- publish only after both uploads succeed
- preserve current tag-on-main validation

Do not publish a release whose manifest and ZIP disagree. If the release already exists as a draft, use `--clobber` for both assets and revalidate before publishing.

### 16.3 Release compatibility rule

Release documentation must state:

- the first updater-enabled release is installed through the current manual app replacement workflow
- starting that release once bootstraps managed updates
- releases compatible with updater protocol 1 can then install automatically
- maintainers must not publish irreversible data migrations without raising the compatibility design and updater protocol as needed

## 17. Proposed code and file changes

### Shared contracts

- `src/shared/update.ts`
  - build-info, manifest, status, error, and request schemas
  - update phase and public response types
- `src/shared/theme.ts`
  - automatic-check settings additions, if update settings remain part of `AppSettings`

### Server

- `src/server/buildInfo.ts`
  - packaged/development build metadata loading and validation
- `src/server/updateService.ts`
  - state machine, GitHub check, ETag cache, download, verification, staging request, scheduling
- `src/server/updateStorage.ts`
  - atomic status and transaction persistence
- `src/server/updateSecurity.ts`
  - loopback enforcement, trusted URL checks, path containment helpers
- `src/server/health.ts`
  - non-mutating readiness checks
- `src/server/runtimePaths.ts`
  - trusted updater and active-application paths
- `src/server/index.ts`
  - health and update routes; graceful shutdown lifecycle
- `src/server/livePoller.ts`
  - explicit stop/dispose method if current lifecycle cannot shut down cleanly

### Client

- `src/client/api.ts`
  - update status and mutation calls
- `src/client/hooks.ts`
  - update status polling hook and runtime-version watcher
- `src/client/components/SoftwareUpdateCard.tsx`
  - status, progress, confirmation, errors, results
- `src/client/pages/SettingsPage.tsx`
  - update card placement and unsaved-change integration
- `src/client/components/AppShell.tsx`
  - optional nonintrusive update-available indicator
- `src/client/pages/OverlayPage.tsx`
  - version-change reload behavior

### Portable scripts and release tooling

- `scripts/portable-launcher.ps1`
  - stable pointer-aware root launcher
- `scripts/portable-updater.ps1`
  - lock, extraction helper, snapshot, activation, health, rollback, recovery
- `scripts/portable-launcher.mjs`
  - active-app environment support and clean update exit handling
- `scripts/package-windows-portable.mjs`
  - build info, root templates, manifest, checksums
- `scripts/release-utils.mjs`
  - manifest metadata helpers while preserving stable version behavior
- `.github/workflows/build-windows-portable.yml`
  - manifest validation and dual-asset publishing

### Documentation

- `README.md`
  - operator update summary
- `docs/project-context.md`
  - managed portable layout and recovery model
- `docs/api-reference.md`
  - health and update endpoints
- packaged `README-OPERATOR.txt`
  - normal update, failed update, and manual recovery instructions

## 18. Test strategy

### 18.1 Unit tests

Test:

- stable version comparison and rejection of prereleases
- GitHub release filtering
- ETag `304` handling
- GitHub rate-limit and offline errors
- manifest schema and cross-field validation
- target/platform rejection
- updater protocol rejection
- URL and redirect allow rules
- active-pointer schema and containment
- transaction phase transitions
- stale transient-state normalization
- byte progress calculations
- disk-space calculations
- download size enforcement
- SHA-256 match and mismatch
- exact staged payload inventory
- update skip/unskip behavior
- local-request enforcement, including spoofed forwarded headers
- health version matching
- cleanup retention with protected active, previous, and unresolved versions

### 18.2 Server integration tests

Use a local fake GitHub/release server through test-only dependency injection.

Cover:

- no update available
- newer release available
- malformed GitHub response
- duplicate manifests
- missing ZIP
- manifest/tag mismatch
- interrupted download and retry
- wrong content length
- oversized response
- digest mismatch removes partial file
- verified archive reuse
- simultaneous download requests
- install request without local origin
- install request with wrong expected version
- install request with the correct UI state while the server independently rejects stale or mismatched prepared state
- restart result imported into public update status

### 18.3 PowerShell unit/contract tests on Windows CI

Test root helpers against temporary directories:

- atomic JSON replacement
- exclusive update lock and stale-lock behavior
- safe relative path resolution
- ZIP traversal entry rejection
- absolute and drive-qualified ZIP entry rejection
- extraction size limits
- payload structural validation
- pointer fallback when active path is missing
- pointer rejection outside portable root
- transaction recovery decisions for every durable phase
- paths containing spaces and non-ASCII characters

### 18.4 End-to-end Windows update tests

Create two small packaged fixtures, version A and version B, and a local release server.

Happy path:

1. launch version A from legacy `app/`
2. seed settings, teams, an uploaded asset, and operations state
3. check and download version B
4. request installation
5. verify version A stops
6. verify the data snapshot completes
7. verify `versions/vB` is activated
8. verify version B starts on the same port
9. verify health reports version B
10. verify every seeded data file and upload remains intact
11. verify previous pointer references version A
12. verify the browser-facing status reports success

Failure scenarios:

- corrupt archive
- incorrect digest
- unsafe ZIP path
- missing server entry
- insufficient disk space
- unwritable root updater directory
- snapshot copy failure
- activation write failure
- new server exits immediately
- new server returns the wrong version
- new server never becomes healthy
- new server mutates data and then fails, proving snapshot restoration
- rollback server also fails, proving bounded non-looping recovery
- port is occupied by an unrelated process during restart
- power-loss simulation after each durable transaction phase
- repeated install request while the lock is held
- old application files remain locked while the new immutable directory installs

### 18.5 UI tests

Cover:

- unsupported runtime
- current/no-update state
- update available
- download progress and stage progress
- retryable and non-retryable errors
- skipped version
- install confirmation
- installation disabled with unsaved Settings changes
- success and rolled-back result banners
- release note link safety
- runtime-version change triggers one reload, not a loop

### 18.6 Manual release qualification

Before enabling the feature by default, test on physical or virtual Windows 10 and Windows 11 x64 systems:

- a clean portable extraction
- an existing portable directory upgraded through the bootstrap release
- a large data directory with many uploaded logos
- a directory under a path containing spaces
- a removable drive
- offline startup
- slow or interrupted internet
- antivirus scanning during extraction and activation
- vMix or OBS connected to `/overlay/live` during a deliberately timed update
- automatic rollback with operator-readable logs

## 19. Observability and support

Write updater events to `logs/updater.log` with:

- timestamp
- transaction id
- source and target version
- phase
- duration
- sanitized outcome and error code

Do not log:

- GitHub authorization tokens if future private-release support is added
- full environment variables
- arbitrary response bodies
- operator data contents

Keep update status concise in the normal server log. Detailed file-level snapshot logs belong only in the updater log.

Add a **Copy update diagnostics** action that returns:

- current build info
- public update status
- latest transaction phase history
- updater protocol
- relevant sanitized log tail
- filesystem free-space summary

Diagnostics must exclude settings contents, upstream payloads, credentials, and uploaded asset data.

## 20. Retention and cleanup

Keep:

- active application version
- previous healthy application version
- any version referenced by a nonterminal transaction
- latest three completed pre-update data snapshots
- latest ten transaction journals
- latest failed archive or staged payload only when needed for diagnostics

Cleanup runs only after a successful startup and health check. It never runs during rollback or incomplete recovery.

Use recoverable quarantine before deletion when practical. Log exact paths removed by automatic cleanup.

## 21. Rollout plan

### Milestone A: release contract

- Add embedded build metadata.
- Generate and validate update manifest and SHA-256.
- Publish ZIP plus manifest.
- Add tests without runtime update UI.

Exit criterion: every tagged release has a machine-verifiable, internally consistent update contract.

### Milestone B: portable bootstrap and health

- Add pointer-aware root launcher and updater protocol.
- Bootstrap existing `app/` layout.
- Add runtime build info and `/api/health`.
- Add transaction persistence and recovery primitives.

Exit criterion: the root launcher can start legacy and versioned app paths and recover from an invalid active pointer.

### Milestone C: check, download, and stage

- Implement update service and routes.
- Add GitHub ETag behavior.
- Add streaming verification and safe extraction.
- Add Settings status and download UI.

Exit criterion: a newer release reaches `ready-to-install` without interrupting the running scoreboard.

### Milestone D: install and rollback

- Implement graceful shutdown handoff.
- Add consistent pre-update snapshot.
- Add atomic activation, same-port restart, health verification, and rollback.
- Add overlay/admin version reload.

Exit criterion: Windows CI proves successful update and automatic rollback while preserving data.

### Milestone E: qualification and enablement

- Complete physical/VM Windows qualification.
- Update packaged operator documentation.
- Keep automatic checks behind a temporary feature flag for one release if needed.
- Enable automatic checks by default after bootstrap feedback.

Exit criterion: an existing operator install can perform its last manual bootstrap update and all later compatible releases without file movement.

## 22. Acceptance criteria

Feature 1 is complete only when all of the following are true:

- A tagged release publishes one matching portable ZIP and update manifest.
- The packaged app reports its correct tag-derived version even when only `app/` was manually replaced.
- An existing portable installation can bootstrap the stable root launcher without losing data.
- Settings can check, download, verify, and stage a newer stable release.
- Corrupt, mismatched, unsafe, wrong-platform, and unsupported-protocol packages are rejected before shutdown.
- Install cannot be triggered from another LAN machine in v1.
- Installation requires explicit confirmation and never occurs automatically.
- The updater creates a complete stopped-state data snapshot before activation.
- The active application changes through an atomic pointer, not in-place overwrite.
- The new application starts on the same port and reports the expected version.
- Settings and overlay reload automatically after the version changes.
- A failed new application automatically restores the old pointer and pre-update data.
- Recovery does not loop when both new and previous versions fail.
- Power interruption at every durable phase has a documented and tested recovery outcome.
- Active, previous, and unresolved transaction files are protected from cleanup.
- Operator documentation explains normal update, rollback, logs, and manual recovery.
- `pnpm test`, client TypeScript checking, overlay-scope checking, build, release tests, and Windows updater integration tests pass.

## 23. Implementation risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Windows locks the running Node executable | In-place replacement fails | Install immutable side-by-side versions and switch a root pointer |
| Root build metadata becomes stale | Wrong comparison or rollback target | Embed build info inside every application version and pass its path explicitly |
| Release archive is corrupt or maliciously shaped | Failed or unsafe install | Manifest validation, streaming SHA-256, safe entry-by-entry extraction, containment checks |
| Update triggered over unauthenticated LAN API | Unauthorized restart | Keep all update mutations loopback-only until authentication ships |
| Internet loss during download | Partial archive | Stream to `.part`, retain current app, expose retryable state |
| Power loss during activation | Uncertain active version | Atomic pointer plus durable transaction journal and launcher recovery matrix |
| New app corrupts data before failing | Old version cannot recover | Stopped-state data snapshot and restore during automatic rollback |
| GitHub API rate limit | Checks stop temporarily | Six-hour schedule, ETag, cached result, reset-aware backoff |
| Update changes server but browser retains old client | UI/API incompatibility | Runtime version watcher and controlled page reload |
| Coordinator protocol becomes obsolete | Future package cannot install safely | Manifest minimum protocol and fail-closed manual-bootstrap message |
| Antivirus delays extraction/startup | False health timeout | Stage before shutdown, use bounded but configurable health deadline, preserve rollback diagnostics |
| Low disk space | Snapshot or extraction fails mid-update | Calculate archive, unpacked, snapshot, fixed, and percentage margins before download/install |

## 24. Recommended first implementation slice

Start with Milestone A and the non-mutating half of Milestone B:

1. define Zod schemas for build info and the update manifest
2. move build metadata into `app/BUILD-INFO.json`
3. expose packaged build information through runtime info
4. add a non-mutating `/api/health`
5. generate the release manifest and SHA-256 after packaging
6. make Windows CI recompute and validate the manifest before publishing
7. add unit and workflow contract tests

This slice improves release correctness immediately and establishes the exact trusted inputs needed by every later updater step without yet introducing process replacement or destructive behavior.
