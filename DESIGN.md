---
name: PBResults Scoreboard
description: Onsite control layer and theme editor for PBResults broadcast scoreboards; one quiet workbench world across the editor and every admin page.
colors:
  accent: "#2f66d6"
  accent-soft: "#e7eefc"
  accent-ink: "#1d4fb3"
  tally: "#c0281e"
  tally-soft: "#fde9e7"
  draft: "#7a4b00"
  draft-soft: "#fff3cf"
  ok: "#1f7a45"
  ok-soft: "#e3f4ea"
  crit: "#b3261e"
  crit-soft: "#fdecea"
  guide-pink: "#e0457b"
  live-green: "#1f9d55"
  ground: "#f5f5f2"
  dot: "#d6d6cf"
  island: "#ffffff"
  side: "#fbfbf9"
  line: "#e4e4de"
  line-strong: "#d6d6cf"
  field: "#f7f7f4"
  hover: "#efefea"
  switch-off: "#cfcfc8"
  text: "#1d1d1b"
  muted: "#5f5f59"
  faint: "#66665f"
  checker-a: "#e9e9e4"
  frame-line: "#bdbdb5"
  accent-dark: "#6f9bff"
  accent-soft-dark: "#1d2945"
  accent-ink-dark: "#a9c3ff"
  on-accent-dark: "#0b1d36"
  tally-dark: "#ff5c50"
  tally-soft-dark: "#3a1c1a"
  draft-dark: "#f0cf7a"
  draft-soft-dark: "#3d3216"
  ok-dark: "#7fd6a2"
  ok-soft-dark: "#173325"
  crit-dark: "#ff8a80"
  crit-soft-dark: "#3a1a18"
  live-green-dark: "#3ccf7f"
  ground-dark: "#131315"
  dot-dark: "#2b2b30"
  island-dark: "#1e1e22"
  side-dark: "#19191c"
  line-dark: "#2f2f35"
  field-dark: "#17171a"
  hover-dark: "#28282d"
  switch-off-dark: "#45454c"
  text-dark: "#ececea"
  muted-dark: "#b1b1b8"
  faint-dark: "#8f8f97"
typography:
  team-name:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.35
  heading:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "tnum"
  control:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.35
  meta:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.2
    fontFeature: "tnum"
rounded:
  swatch: "4px"
  tip: "6px"
  control: "7px"
  well: "8px"
  button: "9px"
  island: "10px"
  pill: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  inset: "14px"
  section: "16px"
  page: "20px"
  grid: "22px"
components:
  island:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
    rounded: "{rounded.island}"
    padding: "4px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    size: "34px"
  icon-button-hover:
    backgroundColor: "{colors.hover}"
  icon-button-pressed:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
  button:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
    typography: "{typography.heading}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "36px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.island}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-ink}"
  button-primary-dark:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.on-accent-dark}"
  mini-button:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "28px"
  admin-button:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "30px"
  admin-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.island}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "30px"
  admin-button-small:
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "26px"
  admin-icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    size: "30px"
  sidebar:
    backgroundColor: "{colors.side}"
    textColor: "{colors.text}"
    width: "232px"
  sidebar-rail:
    backgroundColor: "{colors.side}"
    width: "56px"
  nav-item:
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "32px"
  nav-item-current:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
  page-toolbar:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
    typography: "{typography.title}"
    padding: "0 16px 0 20px"
    height: "52px"
  surface:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
    rounded: "{rounded.island}"
    padding: "14px 16px"
  table-header:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.faint}"
    typography: "{typography.meta}"
    padding: "0 10px"
    height: "34px"
  table-row:
    textColor: "{colors.text}"
    padding: "0 10px"
    height: "40px"
  table-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
  inspector:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
    width: "388px"
  chip:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  chip-admin:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
  chip-on-air:
    backgroundColor: "{colors.tally-soft}"
    textColor: "{colors.tally}"
    rounded: "{rounded.pill}"
  chip-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.pill}"
  chip-draft:
    backgroundColor: "{colors.draft-soft}"
    textColor: "{colors.draft}"
    rounded: "{rounded.pill}"
  chip-critical:
    backgroundColor: "{colors.crit-soft}"
    textColor: "{colors.crit}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
    height: "30px"
  segmented-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.tip}"
    height: "26px"
  segmented-item-on:
    backgroundColor: "{colors.island}"
    textColor: "{colors.text}"
  layer-row:
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 6px"
    height: "30px"
  layer-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
  switch:
    backgroundColor: "{colors.switch-off}"
    rounded: "{rounded.pill}"
    width: "34px"
    height: "20px"
  switch-on:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    width: "34px"
    height: "20px"
  tooltip:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ground}"
    rounded: "{rounded.tip}"
    padding: "5px 8px"
---

# Design System: PBResults Scoreboard

## Overview

**Creative North Star: "The Frame on the Workbench"**

The admin is a precise, quiet instrument beside vMix, not a brand surface. One world covers every screen: a warm neutral ground, white hairline surfaces, the operating system's own UI face at small dense sizes with tabular numerals, one selection blue, and a tally red that only ever means "this is on air". Light first, with a full dark remap through the same tokens; it follows the OS until the operator picks Light or Dark in the sidebar footer.

The world has two compositions. **The editor** (`/admin/themes/:id`) lets the broadcast frame own the screen: the frame sits on a transparency checkerboard over a dot-grid ground, and every tool is a small white island floating around it. The sidebar is hidden there. **The admin pages** (Operations, Themes, Teams, Settings) use the rail and page toolbar: a 232px sidebar that collapses to a 56px rail, a 52px toolbar per page holding that page's title, search, filters and single primary action, then flat hairline surfaces or a dense table, with an inspector side panel beside list pages. The sidebar footer carries a live status block on every page, so the operator sees the broadcast is healthy wherever they are.

**Key Characteristics:**
- Two compositions, one token set: islands on a dot grid for the editor; sidebar, page toolbar and flat surfaces for the admin pages.
- One interactive hue: selection blue for selection, current nav item, pressed tools, focus and the primary action.
- Tally red reserved for the On air state.
- System UI face, 11.5 to 14px (18px for the on-air team names), weights 500/550/600/650, tabular numerals everywhere.
- Shadows only on things that float (editor islands, menus, popovers); admin pages are flat.
- Desktop only, designed for 1280 to 1600px windows.

### Scope and code

1. **Admin pages:** `--ad-*` tokens on `:root[data-admin-theme]` with a dark remap under `:root[data-admin-theme="dark"]`, in `src/client/admin.css`. A page opts in with `.ad-scope`; portalled menus carry `.ad-scope ad-pop` themselves. Shared controls live in `src/client/components/admin/kit.tsx` (Button, IconButton, Chip, Dot, Toolbar, SearchField with `useSlashFocus`, Segmented, Switch, Field, SettingRow, Menu, `downloadJson`, `SAVE_SHORTCUT`). Shell: `AppShell.tsx` with `liveSummary.ts`. Pages: `OperationsPage.tsx`, `ThemesPage.tsx`, `TeamsPage.tsx` + `TeamPanel.tsx`, `SettingsPage.tsx`, `SoftwareUpdateRows.tsx`.
2. **Editor:** `--te-*` tokens on `.te-shell` in `src/client/styles.css`, components in `src/client/components/editor/`, `ThemeCanvasEditor.tsx`, `ThemeEditorPage.tsx`. Every colour the two share is defined once: `--te-*` reads `var(--ad-*)` (including in the portalled popovers, menus and tooltips), so only canvas values (dot grid, island shadow, 32px checkerboard) are the editor's own. Add new shared colours to `admin.css`, never as a third set.
3. **Overlay isolation (hard boundary):** admin theming never reaches `/overlay*` or `OverlayRenderer` output. `<html data-admin-theme>` is set by the pre-paint script in `index.html` (skipped on `/overlay*`) and by `useAdminAppearance` in `src/client/appearance.ts`, which removes it on unmount; it is never set on overlay routes. `pnpm check:overlay-scope` rejects Tailwind utilities in `OverlayPage.tsx` and `OverlayRenderer.tsx` and must keep passing. The Operations "On air" strip renders `OverlayRenderer` directly (transparent, over a backdrop the operator picks); nothing in the admin changes `/overlay/live`. The broadcast look belongs to each event's theme.
4. **Base layer:** Tailwind and the old md3 component kit are gone. `styles.css` keeps the editor (`.te-*`), the overlay styles and a small base layer of global element rules (`button`, `input`, `label` with the `--md-*` values on `:root`). Those global rules still reach the overlay, whose pieces render as buttons, so change them only with a pixel comparison of `/overlay/live` and every theme preview. Admin and editor surfaces opt out of them through `.ad-scope`, `.ad-pop` and `.te-*`.
5. **Desktop only:** 1280 to 1600px beside vMix. No phone or tablet layouts; the few width rules below only keep narrow desktop windows usable.

## Colors

Warm, near-colourless neutrals carry the structure; colour appears only as a signal.

### Primary
- **Selection Blue** (accent): the single interactive colour. Soft tint with the deeper ink for selected rows, the current nav item, pressed tools and selected layers; full blue for the one primary action per page, switches when on, progress, checkboxes and every focus ring. On the canvas, selection handles and the size HUD use it too, so blue always means "what you are acting on".
- **Selection Ink** (accent-ink): text and icons on the soft tint, text buttons, and the primary button's hover.

### Secondary
- **Tally Red** (tally, tally-soft): the On air chip, its dot, the on-air theme card's tinted border, the "On air" row in the sidebar live block, and the tally dot in the editor's air action. Nothing else.
- **Status Green** (ok, ok-soft): healthy and done states: matched team chips, "Ready", "Installed", "All checks clear", passed checks, success toasts.
- **Draft Amber** (draft, draft-soft): unsaved, draft, needs-a-pick and warning callouts.
- **Critical Red** (crit, crit-soft): errors, missing teams, destructive menu items and buttons. A separate token from tally so an error never reads as on air.

### Tertiary
- **Guide Pink** (guide-pink): editor canvas helpers only: snap guides, gap readouts, the mirror ghost and on-canvas event cards. Never a control.
- **Live Green** (live-green): the small haloed dot for a connected feed ("Feed live", Preview as Live feed) and the Active dot in team tables.

### Neutral
- **Workbench Ground** (ground) with **Dot** (dot): the page ground, the editor's 1px dot grid, and the table header band.
- **Surface White** (island): editor islands, admin surfaces, the page toolbar, the inspector, menus and the non-primary button face.
- **Sidebar Wash** (side): the sidebar and rail, one step off white.
- **Hairline** (line) and **Strong Hairline** (line-strong): every border, divider and table rule; the strong hairline for hovered borders and scrollbars.
- **Field Wash** (field): input, select, textarea and token backgrounds, and logo wells.
- **Hover Wash** (hover): hover on rows, buttons and nav; the neutral chip; the segmented track.
- **Ink / Muted / Faint** (text, muted, faint): primary text; secondary text and labels; hints, counts, units and table headers.
- **Switch Off** (switch-off): the off track of switches.
- **Checker and Frame Line** (checker-a, frame-line): the transparency checkerboard behind the broadcast frame and logo wells, and the frame's outline. The On air strip has its own fixed light and dark checkerboards (not theme-mapped), because the backdrop is about the graphics, not the UI.

### Dark theme
Dark is a remap of the same properties; the `-dark` tokens above are those values. The primary button keeps light blue with dark ink (on-accent-dark), and the editor tooltip inverts to a light face.

### Named Rules
**The Tally Rule.** Red means on air. Tally red appears only on On air states; errors use critical red, never tally.

**The One Blue Rule.** Selection blue is the only interactive hue: selection, current location, pressed state, focus, primary action. Type and category chips (Built-in, Custom) are neutral, never blue. A second accent needs a system change, not a component decision.

**The Dark Ink Rule.** In dark, the primary button stays light blue with dark ink on it. White text on the dark-theme blue fails contrast.

## Typography

**UI Font:** system-ui (with -apple-system, Segoe UI, Roboto, sans-serif)

**Character:** the operator's own OS face, set small and firm. Weight does the hierarchy work (500 to 650), size barely moves, and every number uses tabular figures so values do not jitter while they update.

### Hierarchy
- **Team name** (650, 18px, 1.15, -0.01em): the resolved left and right team names on Operations. The one size above 14px, because it is the fact the operator must confirm at a glance mid-match.
- **Title** (650, 14px): page toolbar titles, the inspector's selected item, the editor's selected piece, empty-state headings.
- **Heading** (650, 13px): surface and settings group headings, theme card names, editor island headings; 12px/650 for inspector group headings.
- **Body** (400, 13px, 1.35): the scope default; table cells, inputs, menu items. Row names at 600.
- **Control** (600, 12 to 12.5px): buttons, segmented items, chips (11.5px), tokens.
- **Label** (550, 12px): field labels in muted ink; hints at 400 in faint ink.
- **Meta** (500 to 600, 11.5px, tabular): table headers, nav counts, live-block keys, shortcut hints, editor layer tags and HUD.

### Named Rules
**The Tabular Rule.** `.ad-scope` sets `font-variant-numeric: tabular-nums` on everything; the editor sets it on every numeric readout.

**The Sentence Case Rule.** Labels, headings and table headers are sentence case at normal tracking. No eyebrows, kickers or uppercase labels above titles.

**The Borrowed Face Rule.** The admin never loads a webfont for its own chrome. Theme fonts belong to the overlay content, not the UI around it.

## Layout

### Admin pages: rail and page toolbar
- **Shell:** a two-column grid, sidebar 232px (collapsed rail 56px, persisted, toggled with Ctrl/Cmd+\) and the main column. The editor route runs in focus mode with the sidebar hidden.
- **Sidebar:** 52px head (app mark, name), nav of 32px items with icon, label and count, a separator, "Open live overlay", then the footer: the live block (feed state, theme on air, score line, check state) and the System/Light/Dark segmented control with the collapse button. In the rail the live block shrinks to its dots.
- **Page toolbar:** 52px, sticky, white with a bottom hairline, 20px left and 16px right padding, 8px gaps. Order: title (with count), search (280px, "/" focuses it), segmented filters, a grow spacer, secondary actions, then the one primary action at the right.
- **Operations:** a full-width On air strip first, then two columns: main (Team names on air, Operator text) and a 380px right column (Checks, setup disclosures), 320px below 1360px; 16px gaps, 16px/20px page padding.
- **Themes:** a gallery of 16:9 thumbnail cards, `repeat(auto-fill, minmax(300px, 1fr))`, 16px gap.
- **Teams:** a full-height split: dense table, and a 388px inspector when a team is open. The list stays visible while editing.
- **Settings:** a 180px sticky table of contents beside a column up to 720px, groups of setting rows (text left, control right in up to 300px).

### Tables
40px rows, 34px sticky headers on the ground band, 10px cell padding, hairline rules, 26px row logos. Selected rows take the soft blue. The table wrapper is a container: below 760px of table width, secondary columns (`.ad-col-2nd`) drop first.

### Editor: frame owns the screen
Full-window fixed shell with the canvas filling it and islands at a 14px inset: identity and status top-left, tools top-centre, Preview and the air action top-right, Properties (260px) left, Layers (232px) right, zoom and history bottom-left, Preview as bottom-centre, help bottom-right. Narrow desktop windows only: below 1280px the "Preview as" label hides; below 1180px that bar lifts above the bottom clusters; below 1100px Layers collapses to a pill.

**The One Toolbar Rule.** Each admin page has exactly one toolbar strip holding its search, filters and single primary action. No page headers with big titles above it.

**The Frame Owns the Screen Rule.** In the editor, no docked columns, headers or cards around the canvas. New tools become islands or live inside an existing one.

## Elevation & Depth

Admin pages are flat: surfaces, toolbar, sidebar, tables and the inspector separate by hairlines and the ground/white/side washes, never by shadow. Only floating things lift: editor islands, menus, popovers and toasts. Inside anything, content is flat.

### Shadow Vocabulary
- **Island** (`0 1px 2px rgb(20 20 16 / 0.06), 0 6px 20px -6px rgb(20 20 16 / 0.14)`; dark `0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px -8px rgb(0 0 0 / 0.6)`): editor islands and the top-right buttons.
- **Popover** (`0 1px 2px rgb(20 20 16 / 0.06), 0 12px 32px -8px rgb(20 20 16 / 0.22)`; admin dark `0 1px 2px rgb(0 0 0 / 0.4), 0 12px 32px -8px rgb(0 0 0 / 0.7)`): menus, popovers, pickers, toasts.
- **Contact** (`0 1px 2px rgb(20 20 16 / 0.12)`; dark `rgb(0 0 0 / 0.5)`): the chosen segment of a segmented control and the strip's Live pill.
- **Switch thumb** (`0 1px 2px rgb(0 0 0 / 0.25)`): the white thumb, so it reads as raised on both tracks.
- **Focus ring** (`0 0 0 2px surface, 0 0 0 4px accent`): buttons, switches, links; inputs use an accent border with a 3px 18% accent halo instead.

**The Flat Inside Rule.** Shadows belong to things that float. Nothing nested inside a surface or island gets its own shadow or card.

## Shapes

Gently rounded and consistent by size: 10px surfaces, islands, menus and toasts; 9px editor standalone buttons and the live block; 7px admin buttons, controls, fields, nav items, rows, tokens and menu items; 8px wells (segmented tracks, logo boxes); 6px segments, tooltips, `kbd` and backdrop swatches; full pills for chips, switches and progress; circles for dots. Borders are 1px hairlines; dashed hairlines mark "new" and "empty" slots (new theme card, empty logo well, learned-name tokens). The broadcast frame is square-cornered: it is output, not UI.

## Components

### Buttons (admin)
- **Shape:** 30px high, 7px radius, 1px hairline, white face, 12.5px/600, 15px icon; 26px small variant.
- **Primary:** selection blue fill and border, white label (dark ink in dark), accent-ink on hover. One per page, at the toolbar's right end.
- **Ghost:** transparent, muted ink turning ink on hover. **Text:** 28px, blue ink, soft-blue hover. **Danger:** critical ink, critical-soft hover.
- **Icon button:** 30px square, 7px radius, muted icon; hover wash; pressed soft blue. Disabled controls drop to 40% opacity.
- Editor buttons stay 36px/9px with the island shadow; mini buttons 28px.

### Chips
- **Style:** 22px pill (24px in the editor), 11.5px/600, optional 13px icon or dot.
- **Tones:** neutral (hover wash, muted) for types and categories; On air (tally, with a tally dot); ok; warning (draft); critical; blue only for selection counts ("3 selected"); quiet (no fill, faint, 500) for save status.

### Surfaces and sections
- **Surface:** white, 1px hairline, 10px radius, no shadow. Sections inside split by hairlines at 14px/16px padding, a heading row with a right-aligned hint, disclosures with a rotating chevron. Never a card inside a surface.
- **Callouts:** full-bleed bands inside a surface in draft, critical or soft-blue tint, 12.5px, icon left.

### Inputs / Fields
- **Style:** 30px, field wash, hairline, 7px radius, 13px; faint placeholder; selects with a drawn chevron; unit fields carry the unit inside the right edge.
- **Focus:** accent border with a soft 3px halo.
- **Label** above at 12px/550 muted, hint below in faint.
- **Search:** 280px with a 14px search icon and a `/` key hint; "/" focuses it unless you are typing.
- **Segmented:** hover-wash track, 2px inset, 26px items at 12px/600 with optional counts; the chosen item turns white with the contact shadow.
- **Switch:** 34 × 20 pill, switch-off grey or blue, 16px white thumb with the thumb shadow, 140ms ease-out.
- **Tokens:** 26px field-wash tags with a 7px radius and an 18px remove button; learned names are dashed and transparent.

### Navigation (sidebar)
- **Items:** 32px, 7px radius, 16px muted icon, label at 500, faint count right. Hover wash; current page soft blue with blue ink at 600.
- **Live block:** a 9px-radius hairline tile in the footer, 11.5px keys, 550 values, tally dot for On air, live dot for the feed, status line in ok/draft/crit. It links to Operations.

### Tables
Header: ground band, 11.5px/600 faint, sortable headers with a 12px arrow. Rows: 40px, hover at a 60% hover wash, selected soft blue with blue-ink name. Numbers right-aligned. Status as a dot plus muted label.

### Inspector
388px, white, left hairline. Head with a 40px logo box, 14px/650 title and a muted subtitle, menu and close; scrolling body of hairline-split groups (12px/650 headings, hint right); a footer with save status, Discard and the primary Save.

### Operations: On air strip, team resolution, operator text
- **On air strip:** full width. The header carries the theme chip, score and clock, a Scoreboard / Full frame switch, three backdrop swatches (light, dark, the theme's own background colour) and Open / Copy URL. "Scoreboard" crops to the band the theme occupies (every visible piece plus both sides' event-card positions, 24px padding, capped at 240px tall) so it never jumps when an event fires. Light backdrop is the default in both admin themes: most scoreboards use dark, semi-transparent panels that vanish on dark. View and backdrop are remembered per computer.
- **Unresolved names on air:** a dashed box over that side's name and logo, amber for "Not sure", critical for "No team", with a pill saying what shows on air.
- **Team sides:** left and right halves split by a hairline: side label with state chip, 44px logo well (dashed and empty when there is no team), the 18px team name ("No team yet" in critical when missing), "Feed sends" with the feed name in a code tag and "on air as typed" when unresolved, then either the inline picker (suggestions, search, "Create team" only when nothing matches, Remember) or Change team, and a "Why this team?" disclosure.
- **Operator text:** hidden when the theme on air has none (Overlay details says so, with a link to the editor). Otherwise rows of label, draft input, on-air line with count, a Draft / On air / Default chip, Reset and Take; "Take all (n)" appears when more than one draft is pending.

### Settings rows
Text left (550 title, faint hint), control right; rows split by hairlines inside a surface; dimmed text when the setting is inactive.

### Menus, popovers, tooltips
10px radius, popover shadow, 6px padding, 32px items with 16px icons; highlighted items take the hover wash (soft blue in the editor). Editor tooltips: ink face, light text, 6px radius, 12px/500.

### Editor
Tool islands (4px padding, 34px icon buttons with key letters), Properties and Layers panels (30px rows, eye/lock on hover), Preview as switcher (Live feed carries the live dot) and canvas helpers in selection blue and guide pink, as shipped in `components/editor/`.

## Do's and Don'ts

### Do:
- **Do** build new admin pages inside `.ad-scope` with the kit in `components/admin/kit.tsx` and `--ad-*` tokens; add any new token with a matching dark value.
- **Do** give every admin page one 52px toolbar with its title, search, filters and one primary action at the right.
- **Do** edit list items in an inspector side panel (388px) beside the list, not on a separate page.
- **Do** keep tables at 40px rows with 34px sticky headers and mark droppable columns as secondary.
- **Do** keep numbers tabular and all labels in sentence case.
- **Do** truncate long names with an ellipsis rather than letting rows or cards grow.
- **Do** run `pnpm check:overlay-scope` after touching anything near the overlay.

### Don't:
- **Don't** use tally red for anything but On air.
- **Don't** colour type or category chips blue; blue is for selection and the primary action.
- **Don't** put eyebrows, kickers or uppercase labels above titles.
- **Don't** nest cards inside cards, or give anything inside a surface its own shadow.
- **Don't** put white text on the dark-theme primary blue; use the dark ink.
- **Don't** let admin theming, Tailwind utilities or `data-admin-theme` reach `/overlay*`, `OverlayPage.tsx` or `OverlayRenderer` output, and don't embed the live overlay in an iframe to preview it; render `OverlayRenderer` instead.
- **Don't** add Tailwind or a second component kit; build from `components/admin/kit.tsx` and `components/editor/fields.tsx`.
- **Don't** dock panels or wrap the editor canvas in cards; editor tools float as islands.
- **Don't** design phone or tablet layouts; the product is desktop-only, 1280 to 1600px.
