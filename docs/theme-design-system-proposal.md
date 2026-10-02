# Theme Design System: Tokens, Styling and Motion

Status: proposal · 2026-10-02 · styling and motion first (§7); steps 1–5 (text fitting, shadows and text effects, motion model, value-change motion, entrances) built
Builds on: `docs/theme-editor-redesign-brief.md` (all five phases built)

The theme editor's mechanics are mature: full-window canvas, moveable snapping, arrange tools, Preview as, and event cards edited in context. What it lacks is a **design layer**. Every style is a raw value set on one piece, with no shared definitions, limited styling and almost no motion. This proposal adds that layer without breaking existing themes or the overlay.

---

## 1. Problems today

1. **No theme palette or type scale.** Colours are hex strings stored on each piece. The swatch row is worked out from colours already in use (`themeSwatches` in `src/client/components/editor/PieceProperties.tsx`), so the palette is whatever happens to be on the canvas. Changing the brand colour means editing about ten pieces, plus the event and moment cards, one by one.
2. **Style settings are copied across the schema.** Font family, size, weight, colour and letter spacing are defined separately in six places: frame pieces, `teamEventOverlay.general`, `momentOverlays.timeout`, `momentOverlays.gameFinished`, `centerSecondary.timerStyle` and `centerSecondary.staticStyle`. Surface settings (fill, background image, tint, border, radius, shadow) are copied between frames, moment cards and event cards.
3. **Shadow is a free-text CSS box.** "Shadow (CSS)" appears in three panels and expects a value like `0 4px 12px #0008`. Text has no shadow or outline at all, which is the main way to keep text legible over busy video.
4. **Motion is three hardcoded systems.**
   - The event overlay has its own presets (`slide-horizontal`, `slide-vertical`, `none`).
   - The centre line has its own transition (`fade`, `slide-*`).
   - The team switch uses a fixed animation (`TEAM_SWITCH_ANIMATION_MS`).

   Pieces can't animate in or out, and score changes aren't animated.
5. **Text doesn't fit.** Text is rendered `nowrap; overflow: hidden`, so a 24-character team name is clipped on air. The redesign brief lists "case toggles, shrink to fit", but neither exists in the schema.
6. **Few kinds of custom layer, fixed fonts.** Custom layers can only be text or image. A plain bar or divider needs an image asset or an empty text box. Fonts are fixed to a list of five (`fontFamilies`).
7. **Workflow gaps.** Styles can't be copied between pieces. Mirroring is copy-once only. You can't see which pieces will change when you click Save to air, and there's no quick way to test edge-case data.

## 2. Principles

- **One renderer.** Every new capability lands in `OverlayRenderer` first; the editor only exposes it. The editor never draws its own approximation of the graphic. This rule is unchanged from the redesign brief.
- **Existing themes render exactly as before.** New fields are optional with neutral defaults. Any reshaping happens in `preprocess` migrations, like the existing `migrateLegacyFrame` and `migrateMomentOverlays`.
- **Stored values stay concrete where possible.** Old app versions, exports and backups should still render a theme that uses new design features (see §3.1).
- **Broadcast-safe by default.** Motion is short and opt-in, and an operator can always calm it down (§5.5). Nothing new can make the overlay fail to render.
- **Themes belong to the event.** Tokens and styles belong to the theme, not to the admin UI.
- **Overlay isolation holds.** `pnpm check:overlay-scope` must keep passing.

---

## 3. Design system

### 3.1 Storage model: bind and bake

There are two ways for a piece to use a token:

- **Resolve when rendering:** fields hold a reference like `token:primary`, and the renderer looks it up.
- **Bind and bake:** fields keep a concrete value, and the piece also records which token or style it's bound to. When the token changes, the editor writes the new value into every bound piece.

**Recommendation: bind and bake** for theme tokens and styles.

| | Resolve when rendering | Bind and bake |
|---|---|---|
| Renderer changes | Every colour, font and shadow read goes through a resolver | None for theme tokens |
| Older app versions and imports | Show invalid CSS (`token:primary`) | Render the last baked values correctly |
| Exported theme | Depends on the token table | Self-contained |
| Editor complexity | Low | Has to propagate changes to bound pieces (one shared helper, unit-tested) |

Bind and bake can't express values that change at runtime, so **team colours** (§3.5) are the one exception and are resolved by the renderer.

Binding shape, added to every styled object (piece, moment card, event card, centre-line style):

```ts
bindings: z.object({
  textStyle: z.string().nullable().default(null),      // text style id
  surfaceStyle: z.string().nullable().default(null),   // surface style id
  colors: z.record(z.string(), z.string()).default({}) // field name -> colour token id, e.g. { color: "ink", backgroundColor: "primary" }
}).default({})
```

**Override rule:** while a piece is bound to a style, editing one of the style's fields on that piece **detaches that field only**. It's recorded in `overrides: string[]`, shown with a "reset to style" dot, and skipped by later propagation. "Detach style" clears the binding but keeps the values.

### 3.2 Colour tokens

```ts
tokens: z.object({
  colors: z.array(z.object({
    id: z.string(),            // stable, e.g. "c-1a2b"
    name: z.string().max(40),  // "Primary", "Accent", "Ink"
    value: z.string()          // #rrggbb or #rrggbbaa
  })).default([])
}).default({})
```

- **New theme:** starts with a small default set: Primary, Accent, Ink, Surface, Muted.
- **Existing themes:** a "Create palette from this theme" action builds tokens from the current `themeSwatches` output. Nothing is created automatically, so existing themes don't change.
- **Colour picker:** a **Theme colours** row (named, bound) sits above the existing swatches. Picking one binds the field; typing a hex value unbinds it.
- **Theme panel (no selection):** a **Palette** section to add, rename, reorder and edit tokens. Editing a token updates every bound field in one undo step.

### 3.3 Text styles

A named bundle of text settings: `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `color` (optionally token-bound) and text effects (§4.1).

- Suggested starter set for a new theme: **Team name**, **Score**, **Clock**, **Caption**, **Card**.
- Any text-bearing object can use a text style: pieces, event cards (shared section), moment cards, and the centre line's timer and static styles. This collapses the six copies in §1.2 into one concept in the UI, even though the stored fields stay where they are.
- Properties shows a style picker at the top of the Text group, plus the familiar fields underneath (overrides show a dot).
- **"Create style from selection"** captures the current piece's text settings as a new style and binds the piece to it.

### 3.4 Surface styles

A named bundle of the box's appearance: fill (colour or gradient, §4.2), border colour and width, corner radius, box shadow and backdrop blur. Examples: **Plate**, **Card**, **Glass**, **Badge**.

This uses the same picker, override and "create from selection" behaviour as text styles. It applies to frame pieces, shapes (§4.4), moment cards and event cards.

### 3.5 Team colours (resolved when rendering)

- **Team record:** add `primaryColor` and `secondaryColor` (nullable).
- **Theme:** colour fields can bind to `team:left.primary`, `team:left.secondary`, `team:right.primary` or `team:right.secondary`. It's left and right, not home and away, to match the display sides after switching.
- **Rendering:** these colours change per match. The renderer resolves them and falls back to the field's baked value when the team has no colour or isn't resolved. The baked value is what older versions render.
- **Effect:** panels, accent bars and score plates recolour themselves for each match, like the background-image modes `homeTeamLogo` and `awayTeamLogo` already do for logos.
- **Teams page:** two colour inputs. A "Suggest from logo" button samples the dominant colours of the logo's visible pixels; the visible-content analysis already exists.

### 3.6 Custom fonts

- **Upload:** accept `woff2`, `woff`, `ttf` and `otf` files in the asset library as a new font asset kind, stored locally so they work offline.
- **Schema:** `fontFamily` becomes `z.string()`. Built-in names stay valid. A custom font is referenced by a family name registered from the asset.
- **Loading:** the renderer injects `@font-face` rules for the fonts the theme uses and waits for `document.fonts` before the first paint, so vMix never shows a fallback flash. It keeps the last good state if a font fails to load.
- **Export:** theme export bundles the font files, the same way it bundles images. Asset usage tracking gains a `font` location.

### 3.7 Theme kits

Export and import **only tokens, text styles and surface styles**, with no layout. Use case: start next season's theme from this season's brand, or apply one brand to two layouts. Importing a kit merges by name and asks before overwriting.

---

## 4. Styling

### 4.1 Shadow and text effects editor (built, step 2)

- **Box shadow:** a visual editor (`ShadowInput` in `src/client/components/editor/ShadowInput.tsx`) with a preset, a live sample, and one card per layer: across, down, blur, spread, colour and "inside the box". Layers can be stacked, added and removed.
  - Presets: **None**, **Soft**, **Lifted**, **Hard drop**, **Glow**. A shadow that matches no preset shows as "Custom".
  - Storage stays the existing CSS string, so the schema is unchanged. `src/shared/shadow.ts` reads and writes it: px lengths, hex, `rgb()`/`rgba()`, black, white and transparent. Anything else (other units, variables, named colours) is kept as is and shown as an editable "Custom CSS" field.
  - Replaces the "Shadow (CSS)" text field on pieces (its own Shadow section), event cards and moment cards.
- **Text effects** (shared `textEffectFields`, on the same objects as text fitting):
  - `textShadow` (CSS string, default `none`), using the same editor with text presets: **None**, **Soft**, **Halo** (for legibility over video), **Hard drop**, **Glow**.
  - `textStrokeWidth` (px, default 0) and `textStrokeColor`. Rendered as `-webkit-text-stroke` at twice the width with `paint-order: stroke fill`, so the outline sits outside the letters and they keep their weight.
  - **vMix check:** `paint-order` on HTML text needs a recent Chromium. On an older vMix browser source the outline is drawn over the letters instead, so they look bolder. Check it in Rehearsal before relying on thick outlines.

### 4.2 Gradient fills

```ts
fill: z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid") }),                                  // uses backgroundColor (current behaviour)
  z.object({ type: z.literal("linear"), angle: z.number(), stops: Stop[] }),
  z.object({ type: z.literal("radial"), stops: Stop[] })
]).default({ type: "solid" })
// Stop = { color: string, position: 0..1 }, colour token-bindable
```

- `backgroundColor` stays as the solid value and as the fallback.
- The tint over a background image can also be a gradient. That gives the common "logo art fading to transparent" edge.
- The editor uses a stop bar on top of the existing `react-colorful` picker.

### 4.3 Text fitting (built, step 1)

Shared fields (`textFitFields` in `src/shared/theme.ts`) on every text-bearing object: text pieces, custom text, event cards (shared section) and moment cards. The centre line uses its piece's settings, like alignment.

| Field | Values | Default |
|---|---|---|
| `textTransform` | `none`, `uppercase`, `capitalize` | `none` |
| `textFit` | `clip`, `ellipsis`, `shrink` | `clip` (today's behaviour, rendered exactly as before) |
| `textFitMinScale` | 0.3–1, a share of the font size | 0.6 |

- **Why a share, not pixels:** a minimum stored as a share of the font size stays right when the font size or a centre-line style changes.
- **How shrink works:** `FitText` (`src/client/components/FitText.tsx`) measures the text before paint and scales it down to fit, a pixel short of the edge, never below the minimum; past that, the text ends in "…". Wrapped custom text is fitted to the box height with a short search. It re-measures when a web font finishes loading and when the box is resized.
- **Editor:** a Case control (Aa / AA / Ab) and a Long text control (Cut off / Ellipsis / Shrink, plus Smallest size) in the Text group, the centre line's panel, and the event and moment card panels.
- **Preview data:** Stress tests (W3): Long names, No logos, Unmatched teams, Big scores, Wide clocks, Everything.
- **Rehearsal:** the long-name cases' expected result now follows each name's setting.

### 4.4 Shape layer

A third custom layer kind next to text and image, `kind: "shape"`:

- Shapes: rectangle (with the existing per-corner radius), pill, line or divider.
- **Skew** (−30° to 30°) for the slanted plates common in sports graphics.
- It uses surface styles, gradients and shadows like any frame.

### 4.5 Blend and blur

- `blendMode` (normal, multiply, screen, overlay, soft light) on frames and shapes.
- `backdropBlur` (px) on surfaces, for frosted plates.

vMix's browser source is Chromium-based, so both render. Before release, check both on the real vMix browser source in Rehearsal, because blur costs GPU time on a production machine.

### 4.6 Image effects

On image pieces (team logos, event logo, custom images):

- **Alpha drop shadow** (`filter: drop-shadow`), which follows the visible pixels instead of the box. Background-removed logos need this.
- **Grayscale and dim**, with an optional condition such as "when this team lost" for the winner state.

---

## 5. Motion

### 5.1 One motion model (built, step 3)

```ts
motion = { preset, durationMs, easing, delayMs }   // src/shared/motion.ts, schema in theme.ts (motionField)
```

- **Presets:** None, Fade, Slide up / down / left / right (an 8px nudge), Drop in (full height, from above), Glide in (from the left), Scale.
- **Easings:** Ease, Linear, Ease in, Ease out, Ease in-out, Snappy (`cubic-bezier(0, 0, 0.2, 1)`), Strong ease out (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **How it plays belongs to the thing, not the setting:** `motionEnter` (once, as content arrives), `motionLeave` (reversed, never delayed), `motionLoop` (enter, hold, leave, repeating) and `motionSwap` (old content out while new comes in). Keyframes are `motion-<preset>` and `motion-<preset>-loop` in the overlay stylesheet.
- **Migrated in `preprocess`, with identical timing:**

| Was | Now | Default |
|---|---|---|
| `teamEventOverlay.general.animationPreset` + `durationMs` | `teamEventOverlay.general.motion` (loop) | Drop in, 2000 ms, Ease in-out (`slide-vertical` → Drop in, `slide-horizontal` → Glide in) |
| `centerSecondary.transition` | `centerSecondary.motion` (enter, reversed to leave) | Fade, 250 ms, Ease |
| the fixed team-switch animation | `theme.motion.teamSwitch` (swap) | Scale, 600 ms, Snappy |

- **Editor:** one `MotionFields` control (animation, duration, easing, delay) in the centre line's Change animation group and the event cards' shared section, plus a team-switch motion under "Animate team switches".
- **Rollback note:** a theme saved by this version and opened by an older one loses its event-card and centre-line motion choices, which fall back to the old defaults. Nothing breaks.

### 5.2 Entrance and exit for each piece (built, step 5)

- **Every piece** (fixed and custom, text and image) has `enterMotion` and `exitMotion`, both off by default.
  - **Entrance** plays when the overlay loads, when the piece is shown, and on the operator's **Play entrance**.
  - **Exit** plays when the piece is hidden; it stays on screen until the exit ends. Exits are named by the direction the piece leaves (Fade, Slide up / down / left / right, Scale) and play an entrance backwards.
  - While a piece animates, its own opacity moves to `filter: opacity()`, so the keyframes' opacity never overrides it.
- **Build-in** (`theme.motion.enterStaggerMs`, `enterOrder`): when the whole scoreboard enters, each piece waits its place × the gap. Orders: Left to right, Centre out (mirrored pieces arrive together), Back to front (layers). Showing a single piece doesn't stagger.
- **Play entrance** (named "Bring on" earlier in this proposal): a button on the Operations toolbar, shown when the published theme has an entrance. It sends an `overlay.cue` real-time event (`POST /api/overlay/entrance`). Every live overlay and the on-air strip replay their entrance; it isn't replayed when an overlay reconnects. It's disabled while motion is reduced.
- **Editor:** an "Entrance and exit" section on every piece, and a "Build-in" section (gap, order, Play entrance) on the theme panel. Hiding and showing a piece on the canvas plays its exit and entrance.
- **Not built:** taking the whole scoreboard off air with exits ("Take off"). That would need a persisted on/off state for the overlay, so it's left for later.

### 5.3 Animation when a value changes (built, step 4)

Shared `liveTextFields` on text pieces (fixed and custom), off by default:

- **`changeMotion`** `{ preset, durationMs, easing, delayMs }` with presets **Pop**, **Flash** and **Roll** (the old value leaves upwards as the new one rises in). Offered on the two scores and on custom text, where it plays when the operator takes new text.
  - Detection runs before paint (`changedValues` in `OverlayRenderer.tsx`), so a new value never shows for a frame without its motion. A team change or side switch moves every value at once, so it is left to the team switch.
  - **Names** don't get their own change motion: any name change already plays the team switch.
- **`clockWarning`** `{ belowSeconds, pulse, color }` on the game clock and the centre line (while it shows the break clock): from that many seconds left, the clock pulses and, optionally, changes colour.

### 5.4 Playing motion in the editor (partly built, step 4)

- **Built:** a **Play** button under "When it changes" replays the piece's change motion on the canvas (a number rolls from one less). A **Preview** button under "Last seconds" sets the preview clock just inside the warning. Changing a score in Preview data plays the real change motion.
- **Built in step 5:** Play entrance on the theme panel and on each piece.
- **Still to do:** Rehearsal cases for score changes, the clock warning and the entrance.

### 5.5 Operator safety (built, step 4)

- **Reduce motion** on the Operations toolbar (`settings.reduceMotion`, applied to `/overlay/live` and the on-air strip, never the editor): change motion, pulses, the team switch and the centre-line change all become instant cuts. Event cards drop their loop for one 200 ms fade. A clock's warning colour stays, because it carries information.
- Motion uses only `transform` and `opacity`, to stay smooth on the production machine.

---

## 6. Designer workflow

| # | Proposal | Detail |
|---|---|---|
| W1 | **Copy and paste style** | Cmd+Alt+C / Cmd+Alt+V, and in the right-click menu. It copies the text, surface, effects and motion settings (and their bindings), not position or content. It also works across object kinds where the fields match, for example from a piece to a moment card. |
| W2 | **Linked mirror (symmetry)** | An optional link between a left-team piece and its right-team counterpart. While linked, size and style edits apply to both, and position is mirrored across the frame centre. This needs a persisted `mirrorOf` field; the brief kept mirroring copy-once to avoid a schema change. The copy-once action stays. |
| W3 | **Stress-test preview presets** | One-click data sets in the preview bar: **Long names** (24+ characters), **No logos**, **Double-digit scores**, **Overtime clock**, **Unresolved team**. Pairs with text fitting (§4.3). |
| W4 | **Diff against on air** | Before Save to air, list what changes compared with the published version ("Left team name: font size 56 → 60; new layer: Sponsor bar"), with each item clickable on the canvas. |
| W5 | **Named versions** | Save a named version, then preview, restore or duplicate it. Stored with the theme, so it's included in backups. |
| W6 | **Groups for custom layers** | Move, hide, lock and animate a set of custom layers together. Groups appear in Layers. Fixed slots stay ungrouped. |
| W7 | **Show where a token or style is used** | In the Palette and Styles sections, hovering a token or style highlights its bound pieces on the canvas, and clicking selects them. |
| W8 | **Starter templates** | "New theme" offers the built-in themes plus a blank theme with default tokens and styles, rather than only duplicating. |

---

## 7. Phasing

Decided 2026-10-02: **styling and motion come first**, ahead of tokens and styles. Bind and bake (§3.1) makes the order safe: pieces keep concrete values, so anything added now is bundled into styles later without rework. Two rules keep it that way:

- **Shared sub-schemas from the start.** Text fitting, text effects, fill and motion are each defined once in `src/shared/theme.ts` and reused by pieces, event cards, moment cards and the centre line. Text and surface styles (§3.3, §3.4) later bundle these same definitions.
- **Unified motion before new motion.** The motion model (§5.1) and the migration of the three existing systems land before any new animation, so no fourth motion system appears.

Each step ships on its own and keeps existing themes rendering exactly as before.

| Step | Scope | Schema impact |
|---|---|---|
| **1. Text fitting** — built | Case, fit (clip / ellipsis / shrink) and minimum size (4.3); stress-test preview presets (W3) | Additive shared `textFit` fields on every text-bearing object |
| **2. Shadows and text effects** — built | Visual box-shadow editor with presets (4.1); text shadow and outline | Box shadow unchanged (CSS string); additive `textShadow`, `textStroke` |
| **3. Motion model** — built | Unified motion schema; migrate the event overlay, centre-line transition and team switch onto it (5.1) | Migration of three existing motion fields, identical timing |
| **4. Value-change motion** — built | Score pop, flash and roll; name crossfade; clock pulse (5.3); editor playback and simulate (5.4); Reduce motion (5.5) | Additive `onChange` |
| **5. Entrance and exit** — built | Per-piece enter and exit, theme stagger, "Bring on" (5.2) | Additive `enter`, `exit`, `enterStaggerMs` |
| **6. Gradients and shapes** | Gradient fills and tint (4.2); shape layer with skew (4.4) | Additive `fill`; new custom layer kind |
| **7. Image effects, blend and blur** | Alpha drop shadow, grayscale and dim (4.6); blend modes and backdrop blur (4.5), after a vMix performance check | Additive |
| **8. Tokens and styles** | Bind-and-bake storage (3.1), colour tokens (3.2), text styles (3.3), surface styles (3.4), where-used (W7), copy and paste style (W1) | Additive (`tokens`, `styles`, `bindings`, `overrides`) |
| **9. Brand and team** | Team colours (3.5), custom fonts (3.6), theme kits (3.7) | Team record fields; `fontFamily` widened to a string |
| **10. Workflow** | Diff against on air (W4), named versions (W5), groups (W6), linked mirror (W2), starter templates (W8) | Additive (`versions`, `groups`, `mirrorOf`) |

Every styling and motion step adds a Rehearsal case, so the result is checked in real vMix on Windows, not only on the admin canvas.

## 8. Testing and qualification

- **Schema:** round-trip tests showing every built-in theme and a set of stored legacy themes parse and render identically before and after each phase. Extend `storage.themes.test.ts` and `OverlayRenderer.test.tsx`.
- **Propagation:** unit tests for the bind-and-bake helper covering token edits, style edits, overrides, detach, and undo as one step.
- **Fitting:** renderer tests for shrink and ellipsis with the W3 stress data.
- **Motion:** each preset tested with Reduce motion on and off. The migrated presets must match today's timing.
- **Real output:** Rehearsal cases for build-in, score change, long names and blur, checked in vMix on Windows (the deployment target).
- `pnpm check:overlay-scope` passes after every phase.

## 9. Out of scope

- A keyframe timeline editor. Presets plus duration, easing and delay cover broadcast scorebugs; a timeline is a separate product.
- Canvas sizes other than 1920×1080.
- New live-data pieces (players alive, round info). They belong in a separate data-binding proposal.
- Embedding third-party design tools or a second renderer, as the redesign brief already rules out.

## 10. Open decisions

1. **Storage model:** confirm bind and bake (recommended) over resolving tokens when rendering (§3.1).
2. **Override granularity:** detach per field (recommended) or detach the whole style on any edit (simpler, and coarser for designers).
3. **Linked mirror (W2):** accept the persisted `mirrorOf` field that the redesign brief avoided?
4. **Custom font licensing:** fonts are bundled into theme exports. Do we warn on export, or leave licensing to the event?
5. **Reduce motion scope:** on the Operations page per session, or saved in settings?
