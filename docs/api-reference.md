# API Reference

This document describes the current HTTP API used by the browser client.

Important:
- response shapes are based on the shared schemas in [src/shared/theme.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/shared/theme.ts)
- application-event shapes are defined in [src/shared/appEvents.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/shared/appEvents.ts)
- routes are defined in [src/server/index.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/server/index.ts)
- client usage is in [src/client/api.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/client/api.ts)

## Error model

Most JSON endpoints return:

```json
{
  "message": "Human-readable error"
}
```

Some conflict responses, especially live-name remembering, may also include:

```json
{
  "message": "PROJECT is already remembered for another team.",
  "code": "LIVE_MATCH_NAME_REASSIGNABLE",
  "conflictTeamId": "team-...",
  "conflictTeamName": "Project Syndicate",
  "conflictType": "reassignable"
}
```

Conflict types:

- `reassignable`
- `blocked`

## Shared response models

### AppSettings

```ts
type AppSettings = {
  upstreamBaseUrl: string;
  publishedThemeId: string | null;
  pollEnabled: boolean;
  pollIntervalMs: number;
  autoRemoveBackgroundUploads: boolean;
  /** Operator switch: the live overlay cuts instead of animating. */
  reduceMotion: boolean;
  updateCheckEnabled: boolean;
  updateCheckIntervalHours: number;
  updateAutoDownload: boolean;
}
```

### TeamRecord

```ts
type TeamRecord = {
  id: string;
  canonicalName: string;
  scoreboardDisplayName: string;
  shortName: string;
  aliases: string[];
  liveMatchNames: string[];
  logoAssetId: string | null;
  alternateLogoAssetId: string | null;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### TeamMatchCandidate

```ts
type TeamMatchCandidate = {
  teamId: string;
  teamName: string;
  confidence: number; // 0..1
  matchedAlias: string | null;
}
```

### TeamMatchResult

```ts
type TeamMatchResult = {
  inputName: string;
  normalizedInput: string;
  status: "matched" | "uncertain" | "unmatched";
  resolutionSource: "automatic" | "manual";
  confidence: number; // 0..1
  matchedAlias: string | null;
  teamId: string | null;
  team: TeamRecord | null;
  candidates: TeamMatchCandidate[];
}
```

### TeamResolutionOverride

```ts
type TeamResolutionOverride = {
  normalizedInputName: string;
  rawInputName: string;
  teamId: string;
  createdAt: string;
  updatedAt: string;
}
```

### OperationsState

```ts
type OperationsState = {
  overrides: TeamResolutionOverride[];
}
```

### StoredAsset

```ts
type StoredAsset = {
  id: string;
  originalName: string;
  mimeType: string;
  url: string;
  createdAt: string;
  role: "original" | "processed";
  sourceAssetId: string | null;
  hiddenFromPicker: boolean;
  contentHash: string | null;
  visibleContent: VisibleContentAnalysis | null;
  displayName: string | null; // set by rename; UI shows displayName ?? originalName
  updatedAt: string | null;   // set by rename, replace, revert and reprocess
  byteSize: number | null;
}
```

### AssetLibraryEntry

Returned by `GET /api/assets/library`.

```ts
type AssetLibraryEntry = StoredAsset & {
  usages: AssetUsage[];
  original: { id: string; url: string; byteSize: number | null } | null; // hidden source kept by background removal
  backgroundRemoved: boolean;
  fileMissing: boolean;
}

type AssetUsage =
  | {
      kind: "theme";
      themeId: string;
      themeName: string;
      builtin: boolean;
      published: boolean;
      location:
        | { type: "component"; key: ComponentId }
        | { type: "free"; id: string; label: string }
        | { type: "surface"; key: string; label: string } // a layer's background image
        | { type: "eventOverlay"; which: "concede" | "base" | "winner" }
        | { type: "momentOverlay"; which: "timeout" | "gameFinished" }
        | { type: "font"; family: string }; // a custom font listed in the theme's fonts
    }
  | { kind: "team"; teamId: string; teamName: string; slot: "primary" | "alternate" };
```

### NormalizedLiveState

This is the most important runtime response in the whole app.

```ts
type NormalizedLiveState = {
  sourceStatus: "idle" | "ok" | "error" | "paused";
  fetchedAt: string | null;
  errorMessage: string | null;
  state: string;
  period: string;
  round: number;
  sidesSwitched: number;
  secondGame: false | TeamState[];
  homeTeam: TeamState;
  awayTeam: TeamState;
  displayLeftTeam: TeamState;
  displayRightTeam: TeamState;
  homeTeamMatch: TeamMatchResult;
  awayTeamMatch: TeamMatchResult;
  displayLeftTeamMatch: TeamMatchResult;
  displayRightTeamMatch: TeamMatchResult;
  unresolvedTeamNames: string[];
  breakTimer: TimerState;
  gameTimer: TimerState;
  teamEvent: "towel-home" | "towel-away" | "base-home" | "base-away" | "none";
}
```

Where:

```ts
type TimerState = {
  value: number;
  state: number;
}

type TeamState = {
  name: string;
  score: number;
  playersAlive?: number;
  timer?: TimerState | null;
  midName?: string;
  image?: string;
}
```

Important behavior notes:

- `displayLeftTeam` and `displayRightTeam` are what the overlay and Operations page actually use.
- `displayLeftTeamMatch` and `displayRightTeamMatch` are the key operator-facing match objects.
- `unresolvedTeamNames` contains the raw live names that still need confirmation.
- `sourceStatus` tells you whether the polling layer is healthy, not just whether the last payload exists.

## Runtime and update endpoints

### `GET /api/health`

Returns local readiness independently of the upstream PBResults feed:

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

### `GET /api/runtime-info`

Returns the preferred LAN origin plus the active application version and release tag. Clients use this route for initial LAN-link discovery and as a serialized 60-second runtime fallback while the event stream is disconnected.

### `GET /api/events`

Opens the single multiplexed SSE transport used by admin and overlay clients. It carries configuration invalidations, normalized live-scoreboard state, and operator-text state. The response uses `text/event-stream`, disables transformation/buffering, sends a 15-second heartbeat, and supplies a two-second reconnect hint.

Every connection immediately receives `system.snapshot`:

```text
retry: 2000
id: <instance-id>:<sequence>
event: system.snapshot
data: {"protocol":1,"type":"system.snapshot","instanceId":"...","sequence":12,"occurredAt":"...","revisions":{"settings":2,"themes":4,"assets":3,"teams":5},"runtime":{"appVersion":"1.8.0","releaseTag":"v1.8.0"},"liveState":{"sourceStatus":"ok","...":"NormalizedLiveState"},"operatorTextState":{"themeId":"theme-...","fields":[]}}
```

Mutation notifications use these event names:

- `settings.changed`
- `themes.changed`
- `theme.published`
- `assets.changed`
- `teams.changed`
- `backups.changed`

Data-bearing real-time messages use:

- `live.state`, containing a validated `NormalizedLiveState`
- `operator-text.state`, containing a validated `OperatorTextState`

One-off cues, not replayed when a client reconnects:

- `overlay.cue` with `cue: "entrance"` and a numeric `token`: every live overlay replays its theme's entrance

Example:

```text
id: <instance-id>:13
event: themes.changed
data: {"protocol":1,"type":"themes.changed","instanceId":"...","sequence":13,"occurredAt":"...","revision":5,"resourceIds":["theme-..."]}
```

Important:

- configuration events contain invalidation metadata only; clients refetch the existing REST resource
- live and operator-text events contain their complete validated state so they do not trigger per-update REST requests
- revisions are process-local; every reconnect snapshot reconciles active resources, and a new process instance is treated as a restart
- v1 does not replay `Last-Event-ID`; snapshot reconciliation and a disconnected 60-second fallback provide correctness
- `resourceIds` may be omitted when the entire domain changed
- the process accepts at most 100 concurrent application-event streams and returns `503 EVENT_STREAM_CAPACITY` before opening an additional stream
- `/api/live/stream` and `/api/operations/text/stream` have been removed; their REST equivalents remain available for disconnected fallback

### `GET /api/update/status`

Returns the public managed-update state. This read-only route does not start network work and may be read over the LAN.

Important phases include `unsupported`, `idle`, `checking`, `update-available`, `downloading`, `verifying`, `staging`, `ready-to-install`, `install-requested`, `succeeded`, `rolled-back`, and `failed`.

### `POST /api/update/check`

Performs a fresh GitHub Release and manifest check using ETag validation. Loopback-only.

### `POST /api/update/download`

Loopback-only request:

```json
{ "version": "1.8.0" }
```

Returns `202` and downloads asynchronously. The server streams to a partial file, enforces declared size and disk capacity, verifies SHA-256, and invokes the safe Windows staging helper.

### `POST /api/update/install`

Loopback-only request:

```json
{
  "version": "1.8.0",
  "confirmation": "INSTALL_AND_RESTART"
}
```

Requires the exact prepared version. The durable updater transaction takes over after the `202` response and graceful server shutdown.

### `POST /api/update/skip`

Toggles automatic-notice suppression for the specified available version:

```json
{ "version": "1.8.0" }
```

### `POST /api/update/rollback`

Loopback-only manual rollback request:

```json
{ "confirmation": "ROLL_BACK_AND_RESTART" }
```

The coordinator snapshots current data before selecting and health-checking the previous application version.

All update mutation errors include a stable `UPDATE_*` code. Remote LAN mutation attempts return `403 UPDATE_LOCAL_REQUEST_REQUIRED`.

## Live endpoints

## Upstream `/live` contract

The app does not control the upstream PBResults `/live` API. It consumes it and normalizes it.

### Request behavior

The server poller requests:

```http
GET {upstreamBaseUrl}/live
Accept: application/json
```

### Expected upstream JSON shape

The app currently expects a payload compatible with:

```ts
type RawTimer = {
  value?: number;
  state?: number;
} | null;

type RawTeam = {
  name?: string;
  score?: number;
  playersAlive?: number;
  timer?: RawTimer;
  midName?: string;
  image?: string;
};

type RawLiveState = {
  state?: string;
  period?: string;
  round?: number;
  sidesSwitched?: number;
  secondGame?: false | RawTeam[];
  breakTimer?: RawTimer;
  gameTimer?: RawTimer;
  mainGame?: RawTeam[];
};
```

### Important app assumptions about upstream `/live`

1. `mainGame[0]` is treated as the displayed left team.
2. `mainGame[1]` is treated as the displayed right team.
3. `secondGame` is preserved, but current main overlay logic still resolves the active scoreboard from `mainGame`.
4. Missing fields are tolerated and sanitized to safe defaults.

### How upstream raw data becomes `NormalizedLiveState`

The app transforms raw `/live` into `NormalizedLiveState` with these rules:

- `state`: default `"STOPPED"`
- `period`: default `"BREAK"`
- `round`: numeric fallback `0`
- `sidesSwitched`: numeric fallback `0`
- `breakTimer`: numeric fallback `{ value: 0, state: 0 }`
- `gameTimer`: numeric fallback `{ value: 0, state: 0 }`
- `mainGame[0]`: becomes the current left/home team
- `mainGame[1]`: becomes the current right/away team

### Upstream state mapping

Raw `state` drives `teamEvent` as follows:

- `TOWEL1` -> `towel-home`
- `TOWEL2` -> `towel-away`
- `BASE1` -> `base-away`
- `BASE2` -> `base-home`
- everything else -> `none`

This is important because:

- `BASE1` does **not** mean “home gets the point”
- it means the away side scored from the home-side base

### Upstream failure behavior

If upstream `/live` fails:

- the app keeps the last raw payload
- `/api/live` remains available
- `sourceStatus` becomes `"error"`
- `errorMessage` is populated

If polling is paused:

- `/api/live` still returns normalized state from the last raw payload
- `sourceStatus` becomes `"paused"`

This is why the operator UI can still show the last known scoreboard even when upstream is currently failing.

### `GET /api/live`

Returns:
- `NormalizedLiveState`

Used by:
- Operations page
- overlay pages
- most live operator workflows

### `GET /api/live/raw`

Returns:
- raw upstream `/live` JSON

Type:
- `unknown`

Used mainly for:
- diagnostics
- troubleshooting feed issues

### `POST /api/live/poll/start`

Returns:
- updated `AppSettings`

Effect:
- sets `pollEnabled = true`
- reconfigures the live poller

### `POST /api/live/poll/stop`

Returns:
- updated `AppSettings`

Effect:
- sets `pollEnabled = false`
- reconfigures the live poller

### `POST /api/live/poll/refresh`

Returns:

```json
{ "ok": true }
```

Effect:
- asks the poller to fetch immediately
- works even if polling is paused

### `POST /api/overlay/entrance`

Returns:

```json
{ "token": 1790938724850 }
```

Effect:
- publishes an `overlay.cue` event; every live overlay and the Operations on-air strip replay the published theme's entrance, built in with its stagger
- does nothing visible when the theme has no entrances or motion is reduced

## Operator text endpoints

### `GET /api/operations/text-fields`

Returns the operator-controlled free-text fields in the currently published theme, including each field's label, default value, current on-air value, limits, and override status.

### `PUT /api/operations/text/:themeId/:componentId`

Request body:

```json
{ "value": "DAY 2 | CHAMPIONS DIV | FINALS" }
```

Validates that the theme is currently published and the component is operator-controlled text before taking the value live.

### `DELETE /api/operations/text/:themeId/:componentId`

Removes the live override so the component returns to its theme default.

### `POST /api/operations/text/:themeId/reset`

Clears every operator-text override for the currently published theme.

## Settings endpoints

### `GET /api/settings`

Returns:
- `AppSettings`

### `PUT /api/settings`

Request body:
- `AppSettings`

Returns:
- saved `AppSettings`

Effect:
- updates local settings JSON
- reconfigures live polling

## Operations endpoints

### `GET /api/operations`

Returns:
- `OperationsState`

Current shape:

```json
{
  "overrides": [
    {
      "normalizedInputName": "PROJECT",
      "rawInputName": "PROJECT",
      "teamId": "team-...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### `POST /api/operations/resolve`

Request body:

```json
{
  "teamId": "team-...",
  "rawInputName": "PROJECT",
  "remember": true,
  "forceReassign": false
}
```

Fields:

- `teamId`: required
- `rawInputName`: required
- `remember`: optional, if true also stores the live name in `team.liveMatchNames`
- `forceReassign`: optional, only used after a reassignable conflict confirmation

Returns:

```json
{
  "override": {
    "normalizedInputName": "PROJECT",
    "rawInputName": "PROJECT",
    "teamId": "team-...",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "rememberedTeam": { "...TeamRecord..." },
  "reassignedFromTeam": { "...TeamRecord..." }
}
```

Notes:

- `rememberedTeam` can be `null`
- `reassignedFromTeam` can be `null`
- inactive teams are rejected

### `DELETE /api/operations/resolve/:side?rawInputName=...`

Example:

```http
DELETE /api/operations/resolve/left?rawInputName=PROJECT
```

Returns:
- `204 No Content`

Important:
- override clearing works by normalized `rawInputName`
- `:side` is kept in the route shape, but the server does not use it as the override identity

## App backup endpoints

### `GET /api/app/export`

Returns:
- `AppExportV2Package` with `reason: "export"`

Shape:

```ts
type AppExportV2Package = {
  version: 2;
  exportedAt: string;
  appVersion: string;
  reason: "manual" | "startup" | "shutdown" | "pre-restore" | "pre-import" | "export";
  settings: AppSettings;
  themes: ThemeDefinition[];
  teams: TeamRecord[];
  operations: OperationsState;
  assets: Array<{
    asset: StoredAsset;
    data: string; // data:<mime>;base64,...
    sha256: string; // of the decoded bytes
    size: number;
  }>;
  checksums: {
    // sha256 of JSON.stringify(section), compared against the section exactly as it appears in the file
    settings: string;
    themes: string;
    teams: string;
    operations: string;
  };
};
```

Version 1 packages (`version: 1`, no `appVersion`, `reason`, `operations`, per-asset checksums or `checksums`) are still accepted by every restore and inspect endpoint.

### `POST /api/app/import`

Request body:
- a version 1 or version 2 package

Returns:

```json
{
  "settings": { "...AppSettings..." },
  "themes": [ "...ThemeDefinition..." ]
}
```

Effect:
- validates the whole package first: schema, section checksums, every logo's checksum and size, and safe file names; a failure returns `400` and changes nothing
- saves a `pre-restore` backup; if that fails, returns `500` and changes nothing
- stages logos, then replaces settings, themes, assets, teams and operations state as one transaction; a failure while committing puts back the previous documents and removes only files this restore added
- deletes logos that are no longer referenced only after the commit
- a version 1 package keeps the current team-resolution overrides and clears operator text
- reconfigures the poller and publishes `settings.changed`, `themes.changed`, `assets.changed` and `teams.changed`

## Backup endpoints

Backups are version 2 packages written to `backups/scheduled/` next to the application as `<timestamp>-<reason>.pbbackup.json`. Each file is written as `.partial`, flushed, read back and validated before it is renamed, so a final-named file is always restorable.

Automatic backups run when the server starts and when it stops, and are skipped when the stored data has not changed since the last successful backup. A `pre-restore` or `pre-import` backup runs before every restore and team import. Backups and restores run one at a time.

Configuration and status live in `backups/backup-state.json`, which is machine-local and never part of a backup.

```ts
type BackupStatus = {
  backupsDir: string;
  extraFolder: string | null;
  retainAutomatic: number; // newest automatic backups kept per folder; manual backups are never pruned
  lastSuccess: BackupRunResult | null;
  lastFailure: BackupRunResult | null;
  busy: boolean;
  backups: Array<{ file: string; reason: string; createdAt: string; sizeBytes: number; automatic: boolean }>;
};

type BackupRunResult = {
  at: string;
  reason: string;
  durationMs: number;
  sizeBytes: number | null;
  file: string | null;
  extraCopy: "ok" | "failed" | "skipped";
  extraCopyError: string | null;
  error: string | null;
};

type BackupPreview = {
  version: 1 | 2;
  appVersion: string | null;
  createdAt: string;
  reason: string | null;
  counts: {
    themes: number;
    teams: number;
    assets: number;
    teamResolutionOverrides: number | null; // null for version 1
    operatorTextOverrides: number | null;
  };
  totalAssetBytes: number;
  warnings: string[];
};
```

### `GET /api/backups`

Returns:
- `BackupStatus`

### `POST /api/backups`

Saves a `manual` backup. Returns `201` with `BackupStatus`. A failed copy to the extra folder is reported in `lastSuccess.extraCopy` and does not fail the request.

### `POST /api/backups/inspect`

Request body:
- a version 1 or version 2 package

Runs the full restore validation without changing anything. Returns `BackupPreview`, or `400` with a message naming the damaged part.

### `POST /api/backups/:file/inspect`

Same as above for a stored backup. Unknown or unsafe file names return `404`.

### `POST /api/backups/:file/restore`

Restores a stored backup with the same safety backup and transaction as `POST /api/app/import`. Returns `201` with `{ settings, themes }`.

### `PUT /api/backups/config`

Loopback requests only; other addresses receive `403`.

Request body:

```json
{ "extraFolder": "E:\\Scoreboard backups", "retainAutomatic": 30 }
```

`extraFolder` is an absolute path or `null`. The folder must already exist and be writable (checked with a probe file). `retainAutomatic` is between 5 and 500. Returns `BackupStatus`.

## Team registry endpoints

### `GET /api/teams/export`

Returns:
- `TeamRegistryExportPackage`

Shape:

```ts
type TeamRegistryExportPackage = {
  version: 1;
  exportedAt: string;
  teams: TeamRecord[];
  assets: Array<{
    asset: StoredAsset;
    data: string;
  }>;
}
```

### `POST /api/teams/import`

Request body:
- `TeamRegistryExportPackage`

Returns:
- `TeamRecord[]`

Effect:
- saves a `pre-import` backup first; if that fails, returns `500` and changes nothing
- merges imported teams by `id`
- remaps imported logo asset ids
- reconfigures the poller

### `GET /api/teams`

Returns:
- `TeamRecord[]`

### `POST /api/teams`

Request body:

```json
{
  "canonicalName": "Skuad Budak Jahat",
  "scoreboardDisplayName": "SKUAD BUDAK JAHAT",
  "shortName": "SBJ",
  "aliases": ["Budak Jahat"],
  "notes": "",
  "active": true
}
```

All fields are optional.

Returns:
- created `TeamRecord`

### `POST /api/teams/match-test`

Request body:

```json
{ "inputName": "SBJ" }
```

Returns:
- `TeamMatchResult`

Used by:
- team admin match tester

### `GET /api/teams/:id`

Returns:
- `TeamRecord`

### `PUT /api/teams/:id`

Request body:
- full `TeamRecord`

Returns:
- saved `TeamRecord`

### `DELETE /api/teams/:id`

Returns:
- `204 No Content`

### `POST /api/teams/:id/logo?slot=primary|alternate`

Multipart form-data:
- `file` (PNG, JPG, WebP or GIF; anything else returns `415`)

Errors:
- `404` when the team does not exist

Returns:

```json
{
  "team": { "...TeamRecord..." },
  "asset": { "...StoredAsset..." },
  "processing": {
    "status": "processed" | "skipped" | "failed",
    "reason": "..." | null
  }
}
```

Notes:

- background removal may run depending on settings
- `slot` defaults to `primary`

## Theme endpoints

### `GET /api/themes`

Returns:
- `ThemeDefinition[]`

### `POST /api/themes`

Request body:

```json
{
  "cloneFromId": "theme-...",
  "name": "Broadcast Logos Copy"
}
```

Returns:
- created `ThemeDefinition`

### `GET /api/themes/:id`

Returns:
- `ThemeDefinition`

### `PUT /api/themes/:id`

Request body:
- full `ThemeDefinition`

Returns:
- saved `ThemeDefinition`

### `DELETE /api/themes/:id`

Returns:
- `204 No Content`

Notes:

- built-in themes cannot be deleted

### `POST /api/themes/:id/publish`

Returns:
- published `ThemeDefinition`

Effect:
- updates `settings.publishedThemeId`

### `GET /api/themes/:id/export`

Returns:
- `ThemeExportPackage`

Shape:

```ts
type ThemeExportPackage = {
  version: 1;
  exportedAt: string;
  theme: ThemeDefinition;
  assets: Array<{
    asset: StoredAsset;
    data: string;
  }>;
}
```

### `POST /api/themes/import`

Request body:
- `ThemeExportPackage`

Returns:
- imported `ThemeDefinition`

Effect:
- creates a new theme id
- imports referenced assets
- remaps theme asset ids

## Asset endpoints

### `GET /api/assets`

Returns:
- `StoredAsset[]`

Important:
- hidden assets are filtered out

### `POST /api/assets`

Multipart form-data:
- `file`: a PNG, JPG, WebP or GIF image, or a WOFF2, WOFF, TTF or OTF font (recognised by extension), up to 25 MB; anything else returns `415 unsupported_media_type`. Fonts are stored as they are: no background removal, and `visibleContent` is `unsupported`.

Returns:

```json
{
  "asset": { "...StoredAsset..." },
  "processing": {
    "status": "processed" | "skipped" | "failed",
    "reason": "..." | null
  }
}
```

### `GET /api/assets/library`

Returns:
- `AssetLibraryEntry[]` (visible assets only, newest first)

### `PATCH /api/assets/:id`

Body:

```json
{ "displayName": "Main sponsor" }
```

`null` or an empty string clears the display name. Returns the updated `StoredAsset`.

### `PUT /api/assets/:id/file?removeBackground=true|false`

Multipart form-data:
- `file`

Replaces the file behind an asset and keeps its id, so every theme and team using it switches over. The url keeps the id; only the extension follows the new type. `removeBackground` defaults to the `autoRemoveBackgroundUploads` setting. Returns `{ asset, processing }`.

### `POST /api/assets/:id/revert`

Copies the hidden original (kept by background removal) back into the asset. `400` when there is no original. Returns the updated `StoredAsset`.

### `POST /api/assets/:id/reprocess`

Runs background removal again, from the original when one exists, otherwise from the current file (which then becomes the stored original). Returns `{ asset, processing }`; the asset is unchanged unless `processing.status` is `processed`.

### `DELETE /api/assets/:id?force=true`

Without `force`, an asset that is still used returns:

```json
{ "code": "asset_in_use", "message": "...", "usages": [ "...AssetUsage..." ] }
```

with status `409`. With `force=true`, every reference to it is cleared first. The hidden original goes too when nothing else derives from it.

Returns:

```json
{ "deletedIds": ["..."], "clearedThemeIds": ["..."], "clearedTeamIds": ["..."], "freedBytes": 1234 }
```

### `GET /api/assets/cleanup`

Returns a scan of what can be removed:

```ts
type AssetCleanupReport = {
  unusedAssets: CleanupItem[];    // visible, not referenced; `recent` = added in the last 24 h
  orphanOriginals: CleanupItem[]; // hidden originals nothing derives from any more
  strayFiles: Array<{ fileName: string; byteSize: number }>; // files in uploads with no record
  brokenRecords: CleanupItem[];   // unused records whose file is missing
  reclaimableBytes: number;
}
```

### `POST /api/assets/cleanup`

Body (every list optional):

```json
{ "assetIds": [], "originalIds": [], "strayFiles": [], "brokenRecordIds": [] }
```

Deletes only what is listed, after checking each item again against a fresh scan; anything that changed is returned in `skipped`.

Returns:

```json
{ "deleted": 3, "skipped": [{ "id": "...", "reason": "No longer unused" }], "freedBytes": 1234 }
```

### `PUT /api/teams/:id/logo/asset`

Body:

```json
{ "assetId": "asset-..." | null, "slot": "primary" | "alternate" }
```

Points a team logo slot at an existing library asset (or clears it). Returns the saved `TeamRecord`.

## Non-API behavior

### Static uploads

Uploaded files are served from:

- `/uploads/...`

### SPA fallback

When the built client exists:

- non-API, non-upload paths fall back to `dist/client/index.html`

When the client build does not exist:

- `GET /` returns a plain JSON message telling the developer to build the client
