# Manual Scoring: Run the Scoreboard Without PBResults

Status: planned · 2026-10-16

Today the scoreboard only gets match data by polling PBResults `/live` (`src/server/livePoller.ts`). Some events don't run PBResults at all and score everything by hand, so the scoreboard can't be used there. Pausing the poller doesn't help; it only freezes the last feed state.

**Manual scoring** adds a second score source. In Settings, the operator chooses *Manual* instead of *PBResults*. On Operations, a Manual control panel lets them pick both teams from the registry and run the match: scores, game clock, break clock, timeout, finish, and towel/base events, with keyboard shortcuts for the frequent actions. The overlay, themes, moment cards and rehearsal work unchanged.

Out of scope: the second match on the deck (manual mode sends none), Stream Deck or vMix shortcut endpoints.

**Size: moderate, roughly 3–5 days.** The overlay already renders everything from `NormalizedLiveState`, and `normalizeLiveState(raw, { teamOverrides })` already turns a PBResults-shaped raw object plus chosen teams into that state. Rehearsal does exactly this (`rawGame` in `src/shared/rehearsalCases.ts`). So the server side is a small state machine that emits PBResults-shaped data, with no overlay or theme changes. Most of the effort is the operator panel and its keyboard handling.

---

## 1. How it works

```
PBResults /live ─► livePoller ─┐
                               ├─► score source switch ─► LiveGate ─► /overlay/live (vMix)
Operator panel ─► ManualMatch ─┘   (settings.liveSource)     ▲     └─► Operations, sidebar
                                               Rehearsal ────┘
```

Only one source is active at a time. When `liveSource` is `"manual"`, the poller stops fetching (the same path as `pollEnabled: false`) and the `LiveGate` feed getter returns the manual engine's state. Rehearsal, `feedShowsRunningMatch`, overlay health, remote stream shaping and the SSE stream keep working because they only ever see `NormalizedLiveState`.

## 2. Settings

- `settingsSchema` (`src/shared/theme.ts`): add
  - `liveSource: z.enum(["pbresults", "manual"]).default("pbresults")`
  - `manualGameClockSeconds` (default 600) and `manualBreakClockSeconds` (default 120): the values a reset or a new break starts from.
- `normalizedLiveStateSchema`: add `source: z.enum(["pbresults", "manual", "rehearsal"]).default("pbresults")`, so admin labels can say "Manual scoring" instead of a feed age. The overlay ignores it.
- `PUT /api/settings` (`src/server/index.ts`): when `liveSource` changes, call `livePoller.reconfigure()` and republish the active source's state through `liveGate`.
- Settings page (`src/client/pages/SettingsPage.tsx`): a "Score source" choice above the upstream URL. The URL and poll interval fields are disabled in Manual. Switching while a manual clock is running asks for confirmation.

## 3. Manual match engine

New `src/server/manualMatch.ts`.

### State

Persisted, so a server restart mid-match loses nothing:

```ts
manualMatchSchema = z.object({
  leftTeamId: z.string().nullable(),   // registry team, or null for a typed name
  rightTeamId: z.string().nullable(),
  leftName: z.string(),                // used when no registry team is chosen
  rightName: z.string(),
  leftScore: z.number().int().min(0),
  rightScore: z.number().int().min(0),
  round: z.number().int().min(0),
  phase: z.enum(["idle", "game", "break", "finished"]),
  gameClock: clockSchema,              // { remainingMs, runningSince: string | null }
  breakClock: clockSchema,
  teamEvent: z.enum(["none", "towel-left", "towel-right", "base-left", "base-right"]),
  teamEventUntil: z.string().nullable(),
  history: z.array(manualSnapshotSchema).max(30),  // for Undo
  updatedAt: z.string().nullable()
})
```

Clocks store `remainingMs` and `runningSince` rather than a ticking value. The shown time is `remainingMs - (now - runningSince)`, so it never drifts, survives a restart, and needs no disk write per second.

### Mapping to the PBResults shape

`toRaw(state, now): RawLiveState` produces what the normalizer already understands:

| Manual state | Raw field |
|---|---|
| teams, scores | `mainGame[0]` (left), `mainGame[1]` (right): `{ name, score }` |
| game clock | `gameTimer: { value: secondsLeft, state: running ? 2 : 0 }` |
| break clock | `breakTimer`, same shape |
| phase `game` / `break` | `period: "GAME"` / `"BREAK"` |
| clock running / stopped | `state: "RUNNING"` / `"STOPPED"` |
| phase `finished` | `state: "END"`, `period: "BREAK"` (fires game-finished and winner cards) |
| team event | `state: "TOWEL1" \| "TOWEL2" \| "BASE1" \| "BASE2"` (decoded in `normalizeLiveState`) |
| round | `round` |

`getState()` returns `normalizeLiveState(toRaw(state, now), { sourceStatus: "ok", fetchedAt: now, teams, teamOverrides: { left, right } })` with `source: "manual"`. Passing the chosen registry teams as `teamOverrides` gives them `resolutionSource: "manual"`, so there are no "unresolved team" warnings and no team pick alert.

### Ticking and publishing

A 250 ms ticker computes the state and publishes only when something visible changed: a displayed second, the phase, a score or an event. Clocks stop at zero. The game clock reaching zero does not finish the match on its own; the operator presses Finish.

### Actions

Each action is one function. It saves the previous state to `history` (for Undo), persists, and publishes.

- `setTeam(side, { teamId } | { name })`
- `adjustScore(side, +1 | -1)`, `setScore(side, value)`
- `startGameClock`, `stopGameClock`, `setGameClock(seconds)`, `resetGameClock`
- `startBreak(seconds?)`, `addBreakTime(seconds)`, `stopBreak`. A jump up in the break clock is what the overlay already treats as a timeout (`useTimeoutToken`), so "+1:00 timeout" fires the theme's timeout card with no overlay change.
- `finishMatch`: stops the game clock, phase `finished`.
- `teamEvent(kind, side)`: sets the event and clears it after about 4 seconds, like a feed event passing.
- `nextMatch`: scores to 0, round + 1, clocks reset, phase `idle`; teams kept so the operator only changes the ones that differ.
- `undo`: restores the last snapshot (clocks included).

Reused: `normalizeLiveState` and `formatClock` (`src/shared/normalize.ts`), `listTeamRecords` (`src/server/storage.ts`), and the rehearsal raw-builder pattern.

## 4. Persistence

Add `manualMatch: manualMatchSchema.default({...})` to `operationsStateSchema` (`src/shared/theme.ts`), with get and save helpers in `src/server/storage.ts` next to `getScoreboardState`. That puts manual state in backups and full export/import with no extra work. Writes happen only on operator actions.

## 5. Server wiring

In `src/server/index.ts`:

- One feed getter for `LiveGate` and `RehearsalRunner`:
  `() => getSettings().liveSource === "manual" ? manualMatch.getState() : livePoller.getState().normalized`
- `manualMatch.subscribe(...)` forwards to `liveGate.feedChanged` and `rehearsal.onFeed` only when Manual is active; the poller bridge does the same only when PBResults is active.
- `livePoller.start` and `reconfigure` treat Manual like paused, without emitting a paused state that would override manual.
- `overlayRegistry` uses a fixed 1000 ms behind-threshold in Manual instead of `pollIntervalMs`.
- Routes, validated with zod and refused with 409 during a rehearsal (like team picks):
  - `GET /api/manual`: the manual state with computed clocks.
  - `POST /api/manual/action`: a `{ type, ...payload }` discriminated union, returns the new state.
- SSE: a `manual.changed` event on `appEventHub` (`src/shared/appEvents.ts`) keeps every open Operations tab in sync.

## 6. Operator panel

New `src/client/pages/ManualMatchPanel.tsx`, shown on Operations (`src/client/pages/OperationsPage.tsx`) in place of Team resolution when the source is Manual. Built from the admin kit (`src/client/components/admin/kit.tsx`) per `DESIGN.md`.

- **Teams:** for each side, a registry search picker (extract `searchTeams` and `TeamPicker` from OperationsPage into a shared component) or a typed name, capped at 8 characters like the tablet so themes stay safe.
- **Score:** large number with − and + per side.
- **Game clock:** large readout, Start/Stop, Set (mm:ss), Reset.
- **Break:** Start break, +1:00 timeout, Stop.
- **Match:** Finish, Next match (confirmed), Towel left/right, Base left/right.
- **Undo**, labelled with the last action ("Undo: Left +1").
- **Keyboard shortcuts**, active only when focus is not in a text field, with a legend under the panel:

  | Key | Action |
  |---|---|
  | Space | Start/stop game clock |
  | Q / A | Left score + / − |
  | P / L | Right score + / − |
  | B | Start break |
  | T | +1:00 timeout |
  | F | Finish match |
  | Ctrl+Z | Undo |

- Buttons disable while a request is in flight; no optimistic updates are needed on a local network.
- `OnAirStrip`, `liveSummary` and `describeFeed` show "Manual scoring" instead of feed age or status when `source === "manual"`.

## 7. Edge cases

- Scores never go below 0; Set clock accepts 0:00–99:59.
- Switching source mid-match asks first. Manual state is kept, so switching back to Manual resumes where it left off.
- Rehearsal works unchanged in Manual. A running manual clock counts as a running match, so it blocks or stops a rehearsal just like the feed does.
- Team picks and learned live names don't apply; teams are chosen directly.
- Remote access: manual actions follow the same onsite/remote rules as other Operations actions.

## 8. Tests

Vitest, in the existing `*.test.ts` style.

- `src/server/manualMatch.test.ts`: clock maths with a fake clock; start, stop, set; restore after restart; finish gives `state END` / `period BREAK`; team event clears itself; undo; break time jump.
- `toRaw` → `normalizeLiveState` round trip: chosen teams give `resolutionSource: "manual"` and no unresolved names.
- Storage: an existing `operations.json` without `manualMatch` loads with the default.
- Client: shortcuts ignore keys typed in inputs; `liveSummary` shows the manual label.

## 9. Phases

1. **Server:** engine, persistence, settings switch, wiring, API, tests. Drivable with curl.
2. **Admin:** Manual panel, shortcuts, Settings choice, status labels.
3. **Docs:** `docs/api-reference.md`, a "Running without PBResults" section in `SETUP.md`, README.

## 10. Verification

- `pnpm test`, `pnpm typecheck`, `pnpm check:overlay-scope`.
- `pnpm build`, run on port 3000, set the source to Manual, and open `/overlay/live` beside Operations. Pick teams, score, run the clock, add a timeout, finish (game-finished and winner cards), towel and base, undo. Restart the server with the clock running and confirm it resumes at the right time. Run a rehearsal in Manual.
- Switch back to PBResults and confirm polling resumes.
