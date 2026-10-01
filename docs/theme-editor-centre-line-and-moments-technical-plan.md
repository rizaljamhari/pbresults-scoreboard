# Theme Editor: Centre Line Panel and Independent Moment Cards

Status: phases 1–3 implemented · 2026-10-01
Mockup: `docs/mockups/centre-line-and-moments.html`

Two changes to the theme editor and overlay renderer:

1. **Centre line panel** should describe the piece the way it actually behaves: it is the **break clock first**, and **text or hidden during play second**. Today the panel says the opposite.
2. **Timeout** and **Game finished** become **independent cards**, like the towel, base and winner cards. You can place and style them anywhere. What triggers them and how they animate stays exactly the same.

---

## 1. What the code does today

### 1.1 Centre line (`components.breakTime` + `theme.centerSecondary`)

| Concern | Where | Behaviour |
|---|---|---|
| Content | `resolveCenterSecondaryPresentation` (`OverlayRenderer.tsx:171`) | `period === "BREAK"` → `breakMode` (default `timer`), otherwise `gameMode` (default `staticText` with `gameText: ""`, so effectively hidden). |
| Style | `OverlayRenderer.tsx:864-976` | The variant style (`timerStyle` / `staticStyle`) **overrides** the piece's own `fontFamily`, `fontSize`, `fontWeight` and `color`. The piece's `textAlign`, `letterSpacing`, `lineHeight`, padding and surface are still used. |
| Visibility | `OverlayRenderer.tsx:842` | An empty content string sets `display: none`, so in the editor the line **disappears from the canvas** during play and cannot be clicked. |

The editor panel (`PieceProperties` + `CentreLineProperties`) currently shows, in order:

1. The generic **Text** group (font, size, weight, colour). These values are dead for this piece, because `timerStyle` and `staticStyle` override them at render time.
2. A **collapsed** "Centre line" section (`defaultOpen={false}`), which contains:
   - "What it shows", with **During play** first and **During breaks** second.
   - Timer style, then Text style.
   - Game finished (on/off only; the text is hard-coded `"GAME FINISHED"`).
   - Timeout (full style).

So the panel leads with play-time text and with controls that do nothing, and it hides the break clock styling, which is what this piece is mostly for.

### 1.2 Timeout and Game finished

Both live **inside the `breakTime` button** in the renderer, so neither has its own position, size, radius or surface.

**Timeout** (`OverlayRenderer.tsx:448-496`, rendered at `:982-1009`)
- Trigger: the feed is `ok`; the previous and the current tick are both `BREAK` and not `END`; the previous `breakTimer > 10`; the increase is at least `minIncreaseSeconds` (default 45) **and** the current value is at least that threshold; no major animation is active.
- Shows for `durationMs` (default 1200) with keyframe `center-secondary-timeout-flash`, then clears through a token and a `setTimeout`.
- Also requires `live.period === "BREAK"` and no game-finished overlay at render time.
- It is drawn **over** the centre line content, with its own background colour (`zIndex: 5`).

**Game finished** (`OverlayRenderer.tsx:412-420`, `:839-841`)
- Trigger: `completedMatch`, meaning `sourceStatus ok && state END && period BREAK`, keyed by round, names and scores.
- It **replaces** the centre line content with the literal `"GAME FINISHED"`, using the line's current variant style. The animation is `center-secondary-slide-up 220ms ease`. It stays for as long as the match is ended.
- `gameFinishToken` feeds `majorAnimationActive`, which suppresses timeout flashes, team-switch animations and towel/base cards.

**Event cards (towel/base/winner), for comparison:** they render as their own `.concede-label` layer after the free components. Their geometry comes from `resolveEventLabelRect`, and the editor selects and drags them through `EVENT_CARD_ID` in `MoveableLayer`. "Preview as" switches the canvas into each event state.

---

## 2. Target behaviour

### 2.1 Centre line panel

Order and meaning, top to bottom:

1. **Header**: "Centre line", with the binding text changed to *"Live: break clock, or text during play"*.
2. **Break clock** (open by default). This merges the old *Timer style* group with the alignment and letter spacing that the piece really uses: font, size, weight (already in the schema but never exposed), colour, alignment, letter spacing.
3. **During play**: a segmented control **Hidden · Text · Break clock**, default *Hidden* for new themes. *Text* reveals the text input and a **Text style** group (font, size, weight, colour).
4. **Change animation**: animation and duration, as today.
5. **More** (collapsed): **During breaks**, as a select with *Break clock* (default) · *Text* · *Hidden*, plus *Text during breaks* when Text is chosen. This is the uncommon case, so it no longer gets top billing.
6. **Cards that cover this line**: two link rows, *Timeout card · follows this line* and *Game finished card · follows this line*. Each one jumps to that card's preview state and selects it (see 2.2). This replaces the old Game finished and Timeout groups.

The generic **Text** group in `PieceProperties` is **not rendered for `breakTime`**, because its font, size, weight and colour never reach the screen. Alignment and letter spacing move into *Break clock*, as described above.

**Canvas affordance.** When the line has no content in the current preview state (for example *During play: Hidden*), the editor renders it as a **ghost slot** instead of `display: none`. The ghost is a dashed outline with the faint label "Centre line · hidden during play". You can still select it, drag it and see it in Layers. If the line is selected in that state, the panel shows a one-line hint, *"Hidden in this state. Preview Break to see the clock."*, with a button that calls `applyPreviewMode("break")`. Ghosts render only when `editable` is true, so the overlay is unchanged.

### 2.2 Timeout card and Game finished card

Each becomes its own layer with its own geometry and surface, and follows the event-card pattern:

| Setting | Timeout card | Game finished card |
|---|---|---|
| Show | switch | switch |
| Text | `TIMEOUT` | `GAME FINISHED` (now editable) |
| Sits | **On centre line** · **Free** | **On centre line** · **Free** |
| Free placement | X, Y, W, H (drag and resize on the canvas) | same |
| While shown | *Hide centre line text* (default **off**: it covers the line, as today) | *Hide centre line text* (default **on**: it replaces the line, as today) |
| Type | font, size, weight, letter spacing, align, colour | same |
| Card | fill, image, tint and strength, border, radius, padding, shadow | same |
| Trigger | *Shows for* (ms), *When break time jumps by* (s) | read-only note: "When the feed reports the game ended. Stays until the next game." |
| Motion | read-only note: "Flashes in and out over {durationMs}" | read-only note: "Slides up as the game ends" |

**On centre line** works the same way as *On logo / On name* for event cards. The card fills the centre line's padding box (inside its border), with the line's offsets, padding, line height, opacity and z-order, but uses its own type and surface. **Unlike event cards, it does not fall back to Free when the centre line is hidden: it hides with the line**, because that is what both moments did before and phase 1 must not change what is on air. The panel should say so ("Hidden with the centre line"). Switching to **Free** seeds X/Y/W/H from the resolved rect, so the card does not jump.

**Animation and triggers do not change.** The same predicates, tokens, timers, keyframes (`center-secondary-timeout-flash`, `center-secondary-slide-up 220ms`) and suppression rules (`majorAnimationActive`) apply. Only *where* and *how it looks* become configurable.

**Preview as.** The bar becomes:

```
Preview as  ● Live feed | Game  Break  Timeout  Finished | Towel  Base  Winner   [team] [▶] [⚙]
```

- **Timeout**: `period = BREAK`, break clock 1:00, and the timeout card **held** on screen. ▶ replays the full flash once. Selects the timeout card.
- **Finished**: `state = END`, `period = BREAK`, scores 3–1. Selects the game finished card. The winner card also shows if enabled, which is what really happens on air.
- **Winner** keeps its current behaviour, so the game finished card shows there too.

---

## 3. Data model

### 3.1 New schema (`src/shared/theme.ts`)

```ts
export const momentPlacementValues = ["centreLine", "free"] as const;

const momentCardSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().default(""),
  placement: z.enum(momentPlacementValues).default("centreLine"),
  hideCentreLineContent: z.boolean().default(false),
  // Free placement; ignored while following the centre line.
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().default(240),
  height: z.number().positive().default(44),
  // Type
  fontFamily: z.enum(fontFamilies).default("Barlow Condensed"),
  fontSize: z.number().positive().default(28),
  fontWeight: z.number().min(100).max(900).default(700),
  letterSpacing: z.number().default(1),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  color: z.string().default("#ffffff"),
  // Card
  backgroundColor: z.string().default("#00000000"),
  backgroundImageAssetId: z.string().nullable().default(null),
  backgroundImageFit: z.enum(backgroundImageFitValues).default("cover"),
  backgroundImagePosition: z.enum(backgroundImagePositionValues).default("center"),
  backgroundOverlayColor: z.string().default("#000000"),
  backgroundOverlayOpacity: z.number().min(0).max(1).default(0),
  borderColor: z.string().default("#00000000"),
  borderWidth: z.number().min(0).default(0),
  borderRadius: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]).default([0, 0, 0, 0]),
  paddingX: z.number().min(0).default(0),
  paddingY: z.number().min(0).default(0),
  shadow: z.string().default("none")
});

export const momentOverlaysSchema = z.object({
  timeout: momentCardSchema
    .extend({
      durationMs: z.number().positive().default(1200),
      minIncreaseSeconds: z.number().min(1).default(45)
    })
    .default({ text: "TIMEOUT", backgroundColor: "#b3261ecc" }),
  gameFinished: momentCardSchema.default({ text: "GAME FINISHED", hideCentreLineContent: true })
});
```

In `themeSchema`, add `momentOverlays: momentOverlaysSchema.default({})`. Remove `timeout` and `gameFinished` from `centerSecondarySchema`. Zod strips unknown keys, so old saved files still parse once they have been migrated (3.2).

Change the `centerSecondary.gameMode` default from `"staticText"` to `"hidden"`. The visible behaviour is the same, because an empty `gameText` already hides the line. The new default makes the panel's *Hidden* choice honest. Existing themes keep their stored value.

### 3.2 Migration (legacy → `momentOverlays`)

The migration needs `centerSecondary` **and** `components.breakTime`, so it runs on the whole theme: `themeSchema = z.preprocess(migrateMomentOverlays, themeObjectSchema)`.

> **Check first:** `grep -rn "themeSchema\.\(shape\|extend\|pick\|omit\)" src`. If anything uses the object API, keep exporting `themeObjectSchema` for those call sites and only wrap the parse entry points.

`migrateMomentOverlays(input)` returns `input` untouched if it is not an object or already has `momentOverlays`. Otherwise it builds the following from the raw legacy data:

| New field | Timeout source | Game finished source |
|---|---|---|
| `enabled` | `centerSecondary.timeout.enabled ?? true` | `centerSecondary.gameFinished.enabled ?? true` |
| `text` | `timeout.text ?? "TIMEOUT"` | `"GAME FINISHED"` |
| `placement` | `"centreLine"` | `"centreLine"` |
| `hideCentreLineContent` | `false` (it covered the line) | `true` (it replaced the line) |
| `x,y,width,height` | `components.breakTime` rect | `components.breakTime` rect |
| font / size / weight | `timeout.*` | the style for `breakMode`: `timerStyle` if `timer`, `staticStyle` if `staticText`, otherwise the `breakTime` piece's own |
| `letterSpacing` | `timeout.letterSpacing` | `breakTime.letterSpacing` |
| `textAlign` | `breakTime.textAlign` | `breakTime.textAlign` |
| `color` | `timeout.color` | from the same style as font |
| `backgroundColor` | `timeout.backgroundColor` | `"#00000000"` (the line's own surface shows through) |
| `durationMs`, `minIncreaseSeconds` | `timeout.*` | — |

When following the centre line, radius and padding come from `breakTime` at render time, so they are not copied.

This keeps the pixels identical. The test in 7.1 asserts that rendered markup matches before and after migration for every preview state.

Also update the two built-in themes in `src/shared/builtinThemes.ts` (`centerSecondary.timeout`/`gameFinished` at around lines 497/516 and 865/884) to the new shape, so they don't depend on migration.

### 3.3 Asset usage

- `assetThemeUsageLocationSchema`: add `z.object({ type: z.literal("momentOverlay"), which: z.enum(["timeout", "gameFinished"]) })`.
- `src/server/storage.ts` (`themeAssetRefs`, around `:191`): push refs for `theme.momentOverlays.timeout/gameFinished.backgroundImageAssetId`.
- Asset admin labels (`assetAdminUtils.ts`): "Timeout card" and "Game finished card".
- `ThemeEditorPage.uploadAssetIntoTarget`: add `"timeout" | "gameFinished"` targets.

---

## 4. Renderer (`OverlayRenderer.tsx`)

### 4.1 Extract the triggers, unchanged

Move the existing logic into `useMomentTriggers(theme, live, { forced })`, which returns:

```ts
{ timeoutToken: number | null; gameFinishedToken: string | null; winnerReveal; majorAnimationActive }
```

- The logic is moved **verbatim** from `:412-496`. It reads `theme.momentOverlays.timeout.{enabled,durationMs,minIncreaseSeconds}` instead of `centerSecondary.timeout`. `gameFinishedToken` now gates on `momentOverlays.gameFinished.enabled`.
- `forced` (editor only) is `"timeout" | "gameFinished" | null`. With `"timeout"`, it returns a stable token and **holds** the card (see 4.3). It never runs on `/overlay/live`.

### 4.2 Centre line slot

In the `breakTime` branch of the component map:
- Delete the `isGameFinishSecondaryOverlay` content swap, the `"GAME FINISHED"` literal and the `showBreakTimeoutOverlay` span.
- Add `const hideLineContent = (gameFinishedToken && gameFinished.hideCentreLineContent) || (timeoutVisible && timeout.hideCentreLineContent)`. When this is true, render the surface but not the content span. This matches today's game finished visual, where the surface stays and the text is replaced.
- Ghost slot: `if (editable && !visible && component.visible)`, render with `display:flex` and class `component-slot ghost`, with a placeholder label. The CSS goes in the editor-scoped stylesheet, **not** overlay CSS, so it keeps `pnpm check:overlay-scope` happy.

### 4.3 New `MomentCard` layer

Render it after `freeComponents` and before the event label (same stacking as today relative to free pieces: above them):

```tsx
<MomentCard kind="timeout" active={timeoutVisible} token={timeoutToken} rect={resolveMomentRect("timeout", theme)} … />
<MomentCard kind="gameFinished" active={Boolean(gameFinishedToken)} token={gameFinishedToken} … />
```

- `resolveMomentFrame(kind, theme, centreLineShown)` is exported (the editor uses it, like `resolveEventLabelRect`). On the centre line it returns the line's padding box (rect inset by `borderWidth`, radii reduced by it) or `null` while the line is not shown. Free returns the card's own box. Following cards render in a fragment directly after the `breakTime` slot, so they share its stacking. Free cards render after the free pieces at `max(zIndex) + 1`.
- Surface uses the existing `surfaceStyles(...)`. Border, radius and shadow work like `.concede-label`.
- Motion is unchanged:
  - timeout: `center-secondary-timeout-flash ${durationMs}ms ease-out both`, keyed by token.
  - held in the editor: `center-secondary-timeout-hold` (a new keyframe that is the first 18% of the flash, then `forwards`). ▶ replays by bumping `overlayKey`, which runs the full flash once.
  - game finished: `center-secondary-slide-up 220ms ease`, keyed by token.
- `timeoutVisible` keeps today's render guard: `timeoutToken && live.period === "BREAK" && !gameFinishedToken`.
- Carries `data-piece-id="__moment:timeout"` / `"__moment:gameFinished"` so `MoveableLayer` can target it.

---

## 5. Editor

### 5.1 Canvas targets (`MoveableLayer.tsx`)

Generalise the single `eventCard` into `overlayTargets: OverlayTarget[]`:

```ts
type OverlayTarget = {
  id: string;                       // "__event-card" | "__moment:timeout" | "__moment:gameFinished"
  rect: Box;
  movable: boolean;                 // false while following a piece
  resizable: boolean;               // moments in Free placement: true; event cards: false
  label: string;
  badge?: string | null;            // "Follows centre line"
  onBadgeClick?: () => void;
  commit: (draft: ThemeDefinition, start: Box, end: Box) => void;
};
```

- The event card's `commit` keeps writing `teamEventOverlay.general.offsetX/Y` (moved out of the current hard-coded branch at `:210`).
- A moment's `commit` writes `momentOverlays[kind].x/y/width/height` (rounded).
- Replace the selection filter at `:90` and the start-box map at `:166` with a lookup over `overlayTargets`.

### 5.2 State (`ThemeEditorPage.tsx`)

- `previewMode` gains `"timeout" | "finished"`.
- Replace `eventCardSelected: boolean` with `overlaySelected: string | null` (one of the target ids). `eventKind` is still derived from `previewMode`, and a new `momentKind` is derived the same way.
- `applyPreviewMode`:
  - `"timeout"`: `applyPreviewPreset("break")`, `setPreviewBreakTimerValue(60)`, `forcedMoment = "timeout"`, select `__moment:timeout`.
  - `"finished"`: `applyPreviewPreset("break")`, `setPreviewFinished(true)`, scores 3–1, select `__moment:gameFinished`.
  - `"winner"`: unchanged. The game finished card shows because the state is real.
- Pass `forcedMoment` down `ThemeCanvasEditor → OverlayRenderer` (prop is editor-only; `OverlayPage` never sets it).
- ▶ (Play the entrance again) now shows for event **and** moment modes.

### 5.3 Properties

- New `src/client/components/editor/MomentCardProperties.tsx`, with the same structure and field components as `EventOverlayProperties`. Sections: *This card* (show, text, trigger fields), *Placement* (Segmented **On centre line · Free**, follow link or callout, X/Y/W/H), *While shown* (hide centre line text), *Type*, *Card*, then a read-only *Motion* note.
- `CentreLineProperties.tsx`: rewrite to the 2.1 order. Delete the Game finished and Timeout groups and add the two *Cards that cover this line* link rows (`onOpenMoment(kind)` → `applyPreviewMode`).
- `PieceProperties.tsx`: when `entry.id === "breakTime"`, skip the generic Text group and render `centreLine` in its place (open, not collapsed). Update `FIXED_BINDINGS.breakTime`.
- Inspector switch (around `:2131`): `overlaySelected?.startsWith("__moment:")` → `MomentCardProperties`. `__event-card` → `EventOverlayProperties` as today.

### 5.4 Layers (optional, phase 4)

Add a **Moments** group under Center listing *Timeout card* and *Game finished card*. Clicking one runs `applyPreviewMode(kind)`. The eye toggles `enabled`. No lock: following cards are not draggable anyway, and free ones use the normal lock set keyed by id. This makes both cards discoverable without knowing about "Preview as".

---

## 6. Phases

| # | Scope | Visible change | Exit check |
|---|---|---|---|
| 1 | Schema, migration, built-ins, asset refs, renderer split (`useMomentTriggers`, `MomentCard`, `resolveMomentRect`) | **None** on air | Parity test (7.1) passes for every built-in theme and for `data/themes` exports. `pnpm test`, `pnpm check:overlay-scope`. |
| 2 | Editor: `overlayTargets`, Timeout and Finished preview modes, `MomentCardProperties`, drag/resize for Free | New cards are editable | Manual pass: switch each card to Free, drag it, save, reload, check `/overlay/preview/:id`. |
| 3 | Centre line panel reorder, dead Text group removed, ghost slot, preview hint | Panel matches behaviour | The line stays selectable while hidden. Only editor CSS changed. |
| 4 | Layers *Moments* group | Discoverability | — |

Phases 1 and 2 can ship together. Phase 1 must not ship without its parity test.

---

## 7. Tests

### 7.1 Parity (`OverlayRenderer.test.tsx`)

For each built-in theme, parsed once from the **legacy** JSON (pre-migration fixture) and once from the migrated JSON, render with `renderToStaticMarkup` in these states: game, break, break + timeout token, END + BREAK. Assert that the visible text and the `left/top/width/height` of the centre line and the moment card match. Keep the existing *game-finished and winner stay independent* table, re-pointed at `momentOverlays.gameFinished.enabled`.

### 7.2 Triggers (extract into `useMomentTriggers.test.ts`)

- A jump of 45 s or more during BREAK → token. A jump of 44 s → none. Previous value ≤ 10 → none. A jump across GAME → BREAK → none.
- Clears after `durationMs` (fake timers).
- Suppressed while game finished is active. Timeout disabled → no token.
- Game finished token only on `ok + END + BREAK`. A disabled card has no effect on winner.

### 7.3 Schema (`theme.test.ts` / `exportTheme.test.ts`)

- Legacy `centerSecondary.timeout/gameFinished` → `momentOverlays` with the field mapping in 3.2.
- Already-migrated input is untouched (idempotent). Export, then import, round-trips.
- `storage.assets.test.ts`: moment background images appear in usage and are cleared on asset delete.

### 7.4 Editor

- Ghost slot renders only when `editable`.
- Commit for a free moment writes x/y/w/h. Commit for a following moment is impossible (`movable: false`).

---

## 8. Risks and decisions

- **Phase 1 as built.** The parity checks passed in the editor against the pre-change baseline on *Broadcast Logos*. Game finished and timeout render at the same box (789, 346, 342 × 31), with the same font, colour, padding, line height and flash, and the timeout clears after 1.2 s. One known difference: a following timeout's fill now stays in place while its text moves with the line's X/Y offset, where before the fill moved too. This is only visible on themes that set a centre-line offset.
- **Interim editor.** Until phases 2–3, the existing Game finished and Timeout controls in the centre line panel edit `momentOverlays`.

- **Interpretation of "break clock first".** This plan reads it as *the panel should lead with the break clock and treat text/hidden during play as the secondary state*. It does not change content priority at render time, which already shows the clock in breaks.
- **"Game finished" or "Game ended".** The UI keeps *Game finished* to match the existing default text and setting name. Renaming is a copy-only change if preferred.
- **Stacking.** Moment cards render above free pieces, the same as the timeout does today. A per-card z-order is out of scope.
- **`themeSchema` becoming `ZodEffects`.** See the check in 3.2.
- **Live operators.** Phase 1 changes nothing on air. Themes migrate on read, and the published theme renders identically.
