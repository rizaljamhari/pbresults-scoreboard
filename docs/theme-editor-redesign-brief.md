# Theme Editor Redesign Brief

Status: decisions confirmed 2026-09-30 (light/dark admin-wide, mirror copies once); event-overlay placement and snapping plan proposed. All five phases are built.
Mock-up: `.impeccable/mocks/theme-editor/mockup.html` (open in a browser; light/dark toggle and preview states work).

## 1. Job and audience

- **Who:** theme designers before an event, often the same crews who operate on the day. They build or adjust a scoreboard theme that will run as a vMix browser source.
- **Mode:** Operate. Success is a correct, good-looking broadcast graphic produced quickly, not an impressive editor.
- **Need:** judge the graphic at a useful size, change one property without hunting through forms, and see every broadcast state (game, break, towel, base, winner) before it goes on air.

## 2. Outcome and proof

- **Primary task:** select a piece, change it, and see the exact on-air result.
- **Success:** the canvas takes up most of the screen; any property is reachable within one click of the selection; every overlay state is previewable without a live match; nothing reaches air without the existing On-air / Publish confirmations.
- **Product truth to keep:** the canvas renders through `OverlayRenderer`, the same component vMix shows. The editor must never draw its own approximation of the graphic.

## 3. Selected direction

**Hybrid of Excalidraw and draw.io (user-pinned), light first with a dark theme.**

- **Structure (from Excalidraw):** full-window canvas on a dot grid with floating islands and no page chrome. The top-center toolbar has numbered tools and a hint line underneath. The bottom-left cluster holds zoom and history.
- **Layers (from draw.io):** a docked-style Layers island on the right, because themes have fixed slots (Left team, Center, Right team, Custom) with visibility and live-data tags.
- **Product-specific moment:** a bottom-center **Preview as** switcher (Live feed, Game, Break, Towel, Base, Winner) that drives the canvas through real overlay states. Neither reference has this. It replaces today's separate Event Overlay tab.
- **Broadcast truth on the canvas:** the 1920×1080 frame is labelled, shows the safe area, and sits on a transparency checkerboard by default, with chroma-green and dark backdrops as alternatives.
- **Colour:** neutrals with one selection blue. Tally red is reserved for the "On air" state only, so red always means broadcast.
- **Type:** system UI stack for chrome and tabular numerals for all measurements. Theme fonts (Bebas Neue, Barlow Condensed, Oswald) appear only inside the frame.
- **Implementation consequence:** rebuild the page shell and panels; keep the theme data model, patch functions, undo history, canvas engine (pan, zoom, snap, box selection, measurements) and `OverlayRenderer`.

## 4. Scope and boundaries

- **In scope:** `/admin/themes/:id`, covering `ThemeEditorPage.tsx`, `ThemeCanvasEditor.tsx` and `ThemeComponentInspector.tsx`. Also admin-wide light and dark tokens (phase 5).
- **Untouched:**
  - the theme schema (no data migration)
  - overlay files and styles (`pnpm check:overlay-scope` must pass)
  - publish and save safety from the harden pass
  - the other admin pages' layouts (they only gain the light and dark tokens)
- **Anti-goals:**
  - Excalidraw's hand-drawn rendering on the graphic itself.
  - Embedding `@excalidraw/excalidraw`, draw.io, or tldraw.
  - A second renderer.
  - Hiding properties behind modals.

## 5. States and ranges

- **Selection:**
  - **None:** Properties shows the theme and canvas settings (name, background, safe area, snap options).
  - **Single piece:** Properties shows that piece.
  - **Multiple pieces:** Properties shows shared fields plus align and distribute.
  - **Select all:** Properties shows the global layout scope.
- **Piece kinds:** fixed slot text (live-bound), fixed slot image, score, clock, custom text (optionally operator-controlled), custom image. Each kind shows its data binding ("Live data: left team name", "Operator text").
- **Save status:**
  - Saved or unsaved, with "Unsaved changes, not on air yet" when the theme is live.
  - Saving, publishing, and failures with recovery text.
  - Changed elsewhere, shown as a floating banner with Reload or Keep editing.
- **Feed:** with the feed offline, "Live feed" preview falls back to sample data and says so.
- **Content ranges:** long team names (up to about 24 characters), missing logos, hidden pieces, up to about 30 custom layers.

## 6. Snapping and arranging

The goal: placing a piece exactly where it belongs should take one drag, with no typing.

**Snap targets, all on by default:**
- Frame edges and centre lines, and safe-area edges.
- Every other piece's edges and centres.
- **Equal gaps:** when a piece is the same distance from its neighbour as two other pieces are from each other, it snaps and shows the gap on both.
- **Matching sizes:** while resizing, it snaps to the width or height of another piece.
- **Mirror line (specific to this product):** when moving a left-team piece, a ghost shows where its right-team counterpart sits reflected across the frame centre, and the piece snaps to the exact mirror position.

**Feedback while dragging:**
- Pink guide lines.
- Distance labels to the nearest neighbours and frame edges, in frame pixels.
- The live w × h · x y badge.

**Modifiers:**
- Hold Cmd/Ctrl to drag without snapping.
- Shift keeps the aspect ratio on resize, or locks the move to one axis.
- Alt duplicates while dragging.

**Selection:**
- Click, Shift-click, or drag a box on empty canvas (the marquee).
- Esc clears the selection. Cmd/Ctrl+A selects all.
- A group moves and resizes as one, with the same snapping.

**Arrange tools**, shown in Properties when two or more pieces are selected, and also in a right-click menu:
- Align left, centre, right, top, middle or bottom.
- Align to the selection or to the frame, via a toggle that defaults to the selection.
- Distribute horizontally or vertically, and tidy spacing to an exact gap.
- Match width and height.
- **Mirror to other team:** copies once, as confirmed. It creates or overwrites the counterpart's position and style one time, with no link afterwards.

**Other actions:**
- **Lock a piece** (in Layers or the right-click menu) so it can't be dragged. Locked pieces still act as snap targets. The theme schema has no lock field, so locks are editor-only and remembered per theme in this browser. Persisting them would be a schema change and is out of scope.
- **Keyboard:** arrows move 1px and Shift+arrows 10px (existing). Cmd/Ctrl+D duplicates a custom piece. Cmd/Ctrl+] and [ move forward and back. Alt+Shift+H or V distributes.
- **Snap settings:** one magnet toggle on the toolbar. Its dropdown lists the targets above plus a threshold (default 6 screen px). This replaces today's separate "Snap 14px" button and "Snap options" popover.

**Engine choice:**
- **Candidate:** `react-moveable` + `react-selecto` (MIT). They cover all of the above out of the box: element and gap guidelines, distance labels, group transforms, snapping in scaled containers, and the marquee. `react-moveable` has not been published since December 2023 and declares no React peer range.
- **Gate:** a one-day spike before adoption, on the real canvas. It passes if all of these hold:
  - Works under React 19.
  - Handles the zoomed and panned 1920×1080 stage.
  - Commits one undo step per drag through our existing history.
  - Stays smooth with about 30 pieces.
  - Behaves correctly with `OverlayRenderer` pieces as targets.
- **Fallback if the spike fails:** extend our own engine (`ThemeCanvasEditor.tsx`). It already snaps to frame, safe area, other pieces' edges and centres, and a grid, and has a marquee. We would add equal-gap and size matching, distance labels, the mirror ghost, group resize and the arrange commands. That is more work, but it removes the dependency risk.
- Either way, snapping maths lives behind one module with unit tests, so the choice can change later.
- **Spike result (2026-09-30): passed. Building on `react-moveable`.**
  - **React 19:** no console errors.
  - **Zoomed stage:** drags map correctly (60 screen px at 26% zoom = 231 frame px).
  - **Undo:** one undo step per drag, including group drags.
  - **Performance:** 30 pieces at 0.7ms median and 1.8ms worst per drag move.
  - **OverlayRenderer pieces:** handled through a transparent hit layer over the render.
  - **Adaptation 1:** Moveable must render outside the CSS-scaled stage (a portal into the pan layer). Inside it, snap corrections are scaled down and never land.
  - **Adaptation 2:** numeric `verticalGuidelines`/`horizontalGuidelines` do not snap in this setup. Frame, safe-area and mirror guides are rendered as invisible guide elements, which Moveable snaps to reliably.
  - `react-selecto` was not needed; the existing marquee is kept.

## 7. Event overlay editing (proposed)

- **Where it lives:** in context, not in a dialog. Choosing Towel, Base or Winner in **Preview as** puts that event's card on the canvas as a selectable piece, and Layers gains an **Event overlay** group while the preview is active.
- **Properties for the selected card:**
  - This event's own settings: enabled, text, text colour, background colour or image, overlay tint.
  - A **Shared by all events** section: placement, offset, height, padding, font, border, corner radius, shadow, animation, duration, follow target.
  - That section is labelled "applies to towel, base and winner", so a change there is never a surprise.
- **Follow (kept as is):** a "Position" control at the top of the shared section offers **Follow logo**, **Follow team name**, or **Own placement** (the schema's `followTarget`: `logo`, `name`, `none`).
  - **Follow logo or name:** the card takes exactly that piece's box, as `OverlayRenderer` does today. On the canvas it shows a link badge ("Follows left logo") and has no drag handles, because its position comes from the followed piece. Clicking the badge selects that piece, so you move the logo or name and the card follows. The placement, anchor and offset fields hide, since they don't apply.
  - **Follow a hidden piece:** if the followed logo or name is hidden, the renderer falls back to own placement. The badge then reads "Logo hidden — using own placement" rather than failing silently.
  - **Own placement:** placement (full panel, center stamp, top ribbon), anchor (above or overlapping the top) and offset apply. Dragging the card edits the shared offset, with the same snapping as other pieces.
- **Play:** a replay button next to Preview as runs the entrance animation, so duration and preset can be judged in context.
- **Labels:** raw enum values (`slide-horizontal`, `overlapping-top`, `center-stamp`) are shown as readable labels.

## 8. Interaction and layout

- **Top-left:** a menu (Back to themes, Save as copy, Export, Reload server version), the theme name, and an air status chip plus save status.
- **Top-center tools:**
  - Lock, Hand (H), Select (V or 1), Text (T or 2), Image (I or 3).
  - Snap (S) and Safe area toggles.
  - A contextual hint line underneath.
- **Top-right:** Preview (new tab) and the primary action: **Save to air** when on air, **Publish** otherwise.
- **Left island, Properties (about 244px, scrolls on its own):**
  - Text: font, size stepper, alignment and case toggles, shrink to fit.
  - Colours: text colour and fill as swatches plus hex, via react-colorful.
  - Position and size: a 2×2 grid for X, Y, W and H.
  - Opacity slider.
  - Arrange: lucide icons, including "Mirror to other team" (copies once).
  - An Advanced disclosure.
- **Right island, Layers (about 224px, collapsible):** grouped pieces with a type icon, a live/operator tag, and a visibility eye. Clicking selects on the canvas, and the canvas selection is reflected back.
- **Bottom:**
  - Left: zoom −, %, +, Fit, then Undo and Redo.
  - Center: Preview as.
  - Right: backdrop (transparent, chroma green, dark), light/dark toggle, keyboard shortcuts help.
- **Canvas:**
  - Selection is a blue box with handles and a live dimension badge (w × h · x y); snap guides are drawn while dragging.
  - Fit sizes the frame to the free space between the islands.
- **Keyboard:**
  - Existing shortcuts stay: undo/redo, arrow-key nudges, +/- zoom, Esc.
  - Tool number keys are added.
  - Tab cycles pieces only while focus is on the canvas.
- **Responsive:**
  - 1025px and wider: full layout.
  - Below 1180px: Layers collapses to a toggle.
  - Below 1025px: stacked fallback, with the canvas first.

## 9. Constraints and open decisions

- **Dependencies:**
  - `lucide-react` (already installed).
  - Add Radix UI primitives: popover, dropdown menu, context menu, toggle group, tooltip, slider.
  - Add `react-colorful`.
  - Add `react-moveable` + `react-selecto`, subject to the spike in section 6.
- **Accessibility:**
  - Every icon button has a visible tooltip and an accessible name.
  - Toggles expose `aria-pressed`, and Layers is a keyboard-navigable list.
  - Focus rings are visible in both themes, with AA contrast in both.
- **Light/dark scope:** the whole admin (confirmed). This means semantic light and dark token sets on `.admin-root`, following the OS by default with a manual toggle remembered per browser. The overlay stays untouched.
- **Phasing:**
  1. **Done (2026-09-30).** The shell: full-window canvas, islands, toolbar, zoom and history, menu, and the top-right actions wired to existing save and publish.
  2. **Done (2026-09-30).** Direct manipulation: the engine spike, then snapping, selection and the arrange tools from section 6.
  3. **Done (2026-09-30).** Properties and Layers islands on Radix components, replacing `ThemeComponentInspector` forms.
  4. **Done (2026-09-30).** The Preview as switcher and event overlay editing from section 7.
  5. **Done (2026-09-30).** Light and dark for the whole admin, a pass over copy for raw labels such as `full-panel` and `name container`, then polish.
- **Phase 2 notes:** lock toggles live in the Arrange panel and the right-click menu; Layers only shows a lock icon until phase 3 rebuilds it. Size matching while resizing works from the right and bottom handles only.
- **Phase 3 notes:** the centre-line, event overlay and preview data settings keep their older controls, restyled, inside Properties (centre line as a section; the other two as sub-views from the Theme panel). Phase 4 replaces the event overlay and preview data views.
- **Phase 4 notes:** the event-overlay sub-view is gone; event cards are edited by previewing Towel, Base or Winner. Preview data (scores, clocks, names, logos) keeps its older controls, opened from the preview bar. The position labels read On logo / On name / Free.
- **Fidelity pass (2026-09-30):** measured against the mock-up at 1440×900. Global admin element styles now skip the editor; panels are 260/232px and content-height; piece name and text lead, Arrange follows; colours use inline theme swatches; background image, border and advanced start collapsed. "Transparent preview" is wired to the editor canvas and the preview page (never the live overlay).
- **Phase 5 notes:** the sidebar has a System / Light / Dark switch (stored per browser; a pre-paint script avoids a flash, and overlay routes never get it). Admin status colours come from shared `--tone-*` tokens. Operations issue titles and fixes are rewritten in plain language. The finish review's fixes are in: the dark switch ON state, dark Save to air contrast, full layer names, the font select width, no placeholder label over background art, and a saved camera that no longer resets to the corner on reload. The admin is desktop-only, so there is no phone layout. DESIGN.md records the editor system; the rest of the admin is marked transitional until the planned revamp.
- **Open decisions:** none blocking. The engine choice is settled by the spike's pass/fail criteria, not by taste.
