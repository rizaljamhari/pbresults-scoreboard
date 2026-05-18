# API Reference

This document describes the current HTTP API used by the browser client.

Important:
- response shapes are based on the shared schemas in [src/shared/theme.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/shared/theme.ts)
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
}
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

### `GET /api/live/stream`

Server-Sent Events endpoint.

Behavior:
- sends normalized live state as `data: ...`
- keep-alive comments every 15 seconds

Payload per event:

```text
data: {NormalizedLiveState JSON}
```

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
- `AppExportPackage`

Shape:

```ts
type AppExportPackage = {
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  themes: ThemeDefinition[];
  teams: TeamRecord[];
  assets: Array<{
    asset: StoredAsset;
    data: string; // data:<mime>;base64,...
  }>;
}
```

### `POST /api/app/import`

Request body:
- `AppExportPackage`

Returns:

```json
{
  "settings": { "...AppSettings..." },
  "themes": [ "...ThemeDefinition..." ]
}
```

Effect:
- replaces settings, themes, assets, and teams
- rewrites uploaded files locally
- reconfigures the poller

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
- `file`

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
- `file`

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

## Non-API behavior

### Static uploads

Uploaded files are served from:

- `/uploads/...`

### SPA fallback

When the built client exists:

- non-API, non-upload paths fall back to `dist/client/index.html`

When the client build does not exist:

- `GET /` returns a plain JSON message telling the developer to build the client
