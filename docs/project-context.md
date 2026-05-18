# PBResults Scoreboard Context

## What this app is

`PBResults Scoreboard` is a browser-based control and overlay system that sits on top of a PBResults `/live` feed.

It is not just a theme editor anymore. The current scope includes:

- live polling from PBResults `/live`
- live overlay rendering for browser-source use in vMix
- theme editing and publishing
- team registry and logo management
- live team-name resolution and operator overrides
- full app backup/import and team-only import/export
- Windows portable packaging

The operator-first landing page is `/admin/operations`.

## Main runtime model

The app has three major runtime layers:

1. Upstream feed
- The server polls a configured PBResults `/live` base URL.
- Polling can be started, stopped, and manually refreshed.

2. Normalized live state
- Raw PBResults data is converted into a stable internal `NormalizedLiveState`.
- Team matching and operator overrides are applied here.
- The overlay and Operations page both depend on this normalized state.

3. Persistent local admin state
- Settings, themes, teams, assets, and operations overrides are stored locally in JSON files under `data/`.

## How the upstream `/live` API works

This app assumes there is an upstream PBResults server reachable at:

```text
{upstreamBaseUrl}/live
```

The server poller builds that URL with:

- `new URL("/live", upstreamBaseUrl).toString()`

So if `upstreamBaseUrl` is:

```text
http://192.168.100.67:5000
```

the app polls:

```text
http://192.168.100.67:5000/live
```

### Expected raw shape

The app currently expects `/live` to behave roughly like this:

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

### Fields the app actually uses

The current app only depends on these `/live` fields:

- `state`
- `period`
- `round`
- `sidesSwitched`
- `secondGame`
- `breakTimer`
- `gameTimer`
- `mainGame`

From each team inside `mainGame` or `secondGame`, it uses:

- `name`
- `score`
- `playersAlive`
- `timer`
- `midName`
- `image`

Any other fields from upstream are currently ignored.

### Required team ordering assumption

This is a very important implementation detail:

- the app currently assumes `mainGame[0]` is the displayed left team
- the app currently assumes `mainGame[1]` is the displayed right team

This is not just a UI choice. Team overrides are also looked up from:

- `raw.mainGame[0].name`
- `raw.mainGame[1].name`

So if the upstream `/live` ordering changes, the overlay and team resolution behavior will also change.

### How polling works

The poller:

- starts automatically when the server starts
- respects `settings.pollEnabled`
- polls at `settings.pollIntervalMs`
- can be manually refreshed even while paused

Polling states exposed to the app:

- `idle`
- `ok`
- `error`
- `paused`

Behavior:

- `ok`: last fetch succeeded
- `error`: last fetch failed, but the app keeps the previous raw payload if it had one
- `paused`: polling disabled by operator, normalized state is still derived from the last raw payload
- `idle`: no successful fetch yet

### Error behavior

If `/live` fetch fails:

- the app does not discard the previous raw state
- it re-normalizes the previous raw payload with:
  - `sourceStatus = "error"`
  - `errorMessage = <fetch error>`

This is why the overlay and operations page can still show the last known scoreboard state while upstream is down.

### Timer normalization

Timers are sanitized to:

- `value`: coerced to number and clamped to `>= 0`
- `state`: coerced to number

If a timer is missing, the app falls back to:

```json
{ "value": 0, "state": 0 }
```

### Team normalization

Each raw team is sanitized into a stable internal object with defaults:

- missing `name` -> `""`
- missing `score` -> `0`
- missing `playersAlive` -> `0`
- missing `timer` -> `null`
- missing `midName` -> `""`
- missing `image` -> `""`

### Team-name override behavior

Before matching teams, the poller extracts the live names from:

- `mainGame[0].name`
- `mainGame[1].name`

It then applies any stored runtime overrides by normalized live input name.

Important:

- overrides are not side-bound anymore
- if the same normalized short name appears again later, the same override applies
- inactive teams are ignored even if an old override points to them

### `secondGame`

`secondGame` is preserved in normalized state as either:

- `false`
- an array of sanitized team objects

Current important limitation:

- the app keeps `secondGame` available for operators and future logic
- but the main overlay and main team resolution still operate from `mainGame`

### State-to-event mapping

The upstream `state` string is also interpreted semantically:

- `TOWEL1` -> `towel-home`
- `TOWEL2` -> `towel-away`
- `BASE1` -> `base-away`
- `BASE2` -> `base-home`
- anything else -> `none`

This is used by:

- team event overlays
- Operations page event summaries
- live on-air state decisions

## Important project concepts

### 1. Display order vs home/away naming

In the current normalization logic, upstream `mainGame[0]` and `mainGame[1]` are treated as the displayed left and right teams.

Current comment in [src/shared/normalize.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/shared/normalize.ts:78):
- upstream emits `mainGame` in display order `(left, right)`

So the overlay effectively uses:
- left side = `mainGame[0]`
- right side = `mainGame[1]`

The app still exposes `homeTeam` and `awayTeam` in the normalized model, but today they are effectively the left/right display teams.

### 2. Team event mapping

The normalized `teamEvent` is derived from upstream `state`:

- `TOWEL1` -> `towel-home`
- `TOWEL2` -> `towel-away`
- `BASE1` -> `base-away`
- `BASE2` -> `base-home`
- anything else -> `none`

Important:
- `BASE1` means the away team scored from the home-side base
- `BASE2` means the home team scored from the away-side base

### 3. Team resolution model

Automatic team matching only considers active teams.

Manual operator overrides also only allow active teams.

Current resolution priority:

1. runtime override by normalized live name
2. automatic matching from the team registry
3. unresolved/uncertain fallback

Runtime overrides are no longer side-bound. They are keyed by normalized live input name, so the same short/truncated live name can resolve again later regardless of which side it appears on.

### 4. Learned live match names

Teams can store `liveMatchNames`.

These are:
- operator-confirmed live names
- usually short or truncated feed labels
- used as strong exact names during matching

They are distinct from generic `aliases`.

This exists because live names are often truncated to about 7 characters and would otherwise be too fragile for repeated automatic matching.

### 5. Asset storage

Assets are stored as local uploaded files plus JSON metadata:

- files: `data/uploads/`
- metadata: `data/assets.json`

Important:
- stored asset records include internal `filePath`
- export/import packages do not rely on the source machine’s `filePath`
- export/import serializes file data as `data:<mime>;base64,...`
- import reconstructs local files on the target machine

That is why full app backup/import is cross-platform friendly.

## Persistent local files

Main local state files:

- `data/settings.json`
- `data/themes.json`
- `data/teams.json`
- `data/assets.json`
- `data/operations.json`
- `data/uploads/*`

Meaning:

- `settings.json`: upstream URL, published theme, polling config, upload processing config
- `themes.json`: all built-in and custom themes
- `teams.json`: team registry, aliases, learned live names, logo references
- `assets.json`: uploaded asset metadata
- `operations.json`: runtime team resolution overrides

## Operations page purpose

`/admin/operations` is the live control page.

It is intended for on-site use during production and focuses on:

- live feed health
- current scoreboard snapshot
- team resolution
- warnings
- readiness
- overlay quick access

It is intentionally separate from:

- `Settings`
- `Themes`
- `Teams`

## Theme system summary

The current scoreboard model is built around:

- left team slot
- center slot
- right team slot

Important components:

- `homeName`
- `homeTeamLogo`
- `homeScore`
- `awayName`
- `awayTeamLogo`
- `awayScore`
- `gameTime`
- `breakTime`
- `eventLogo`

Important runtime additions:

- `teamEventOverlay`
- `centerSecondary`

`teamEventOverlay` is split into:

- `general`
- `concede`
- `base`

`centerSecondary` supports:

- timer mode
- static text mode
- hidden mode
- separate styles for timer/static text
- transition animation between modes

## Team logo behavior

Team logo slots can resolve their image source in this order:

1. matched team registry logo
2. configured fallback behavior

Fallback modes:

- `none`
- `eventLogo`
- `slotFallback`
- `slotFallbackThenEventLogo`

Team logo slots render as panel-filling background artwork, not centered foreground logos.

The `eventLogo` component still behaves like a normal image component.

## Import/export behavior

### Full app backup

Full app export/import moves:

- settings
- themes
- teams
- assets metadata
- uploaded asset contents

This is the official cross-machine and cross-OS migration path.

### Team-only export/import

Team-only export/import moves:

- team records
- only the logo assets referenced by those teams

### Theme export/import

Theme export/import moves:

- one theme
- all assets referenced by that theme

## Windows portable packaging

The app now supports a Windows portable release flow.

Portable folder structure:

- `app/`
- `data/`
- `logs/`
- `Run Scoreboard.cmd`
- `README-OPERATOR.txt`

Rules:

- `app/` is replaceable on update
- `data/` is persistent
- `logs/` is persistent but disposable

Windows packaging command:

```sh
pnpm package:windows:portable
```

Important:
- this must run on Windows or Windows CI because of the bundled Windows runtime and native dependencies

## Known implementation details worth remembering

### 1. `/api/operations/resolve/:side`

The path still contains `:side`, but clearing an override now works by normalized live input name.

So the side parameter is effectively legacy URL shape, not the primary identity key.

### 2. Inactive teams

Inactive teams:

- do not participate in automatic matching
- cannot be manually assigned from Operations
- are ignored if an old override points at them

### 3. Live feed refresh

`Refresh now` works even when polling is paused.

### 4. Portable runtime path resolution

Server path resolution is packaged-mode aware via `src/server/runtimePaths.ts`, so data, uploads, logs, and client build paths can be rooted correctly in the portable bundle.

## Good entry points for future work

If someone is new to the repo, these are the fastest files to read first:

- [src/server/index.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/server/index.ts)
- [src/server/storage.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/server/storage.ts)
- [src/shared/theme.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/shared/theme.ts)
- [src/shared/normalize.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/shared/normalize.ts)
- [src/shared/teamMatching.ts](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/shared/teamMatching.ts)
- [src/client/pages/OperationsPage.tsx](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/client/pages/OperationsPage.tsx)
- [src/client/pages/ThemeEditorPage.tsx](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/client/pages/ThemeEditorPage.tsx)
- [src/client/pages/TeamsPage.tsx](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/src/client/pages/TeamsPage.tsx)
