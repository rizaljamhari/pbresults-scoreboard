# UI Migration Phase 7 - Legacy Admin CSS Decommission (Batch 1 to Batch 9)

Date: 2026-05-19
Status: Completed (safe batches)

## Goal

Remove legacy admin CSS selectors that are no longer referenced by current TSX markup after the Tailwind + primitive migration, while preserving overlay behavior.

## Method

- Audited selector usage across `src/client/**/*.tsx`.
- Removed only selectors with zero usage in TSX.
- Left shared editor/canvas/overlay selectors untouched.

## Removed selectors (unused)

- Header/grid legacy: `.admin-page-header`, `.admin-grid-2`, `.meta-row`
- Legacy badges: `.status-badge`, `.status-badge--warning`
- Legacy theme/table: `.theme-card`, `.theme-card p`, `.table-shell`, `.table-empty`
- Legacy status pills: `.status-pill`, `.status-pill--ok`, `.status-pill--warning`, `.status-pill--critical`, `.status-pill--info`
- Legacy team list layout: `.team-admin-grid`, `.team-list-panel`, `.team-list`, `.team-list-button`, `.team-list-button strong`, `.team-list-button span`, `.team-list-button.active`
- Unused resolution modifier variants: `.operations-resolution-note--info`, `.operations-resolution-note--warning`, `.operations-resolution-note--critical` and their text-color rules
- Media-query leftovers tied to removed selectors

## Additional cleanup

- Removed `.theme-card h3` from a grouped heading selector.
- Kept `.panel h2`, `.panel h3`, `.hint`, and all editor/overlay selectors in place.

## Scope safety

- No overlay page selectors were removed.
- No overlay route/component files were modified.

## Validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 2 delta

- Removed additional unused editor-era selectors with zero TSX references:
	- `.editor-top-grid` (including its media-query entry)
	- `.preview-preset-row`
	- `.preset-button-row`
	- `.inspector-section`
	- `.inspector-section h3`
- Kept all active editor/canvas classes (`.editor-workspace`, `.canvas-*`, `.inspector`, `.component-*`, `.overlay-*`) unchanged.

### Batch 2 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 3 delta

- Migrated Team Detail admin controls away from legacy utility classes in `src/client/pages/TeamDetailPage.tsx`:
	- Replaced `danger-button` actions with primitive `Button` (`variant="danger"`).
	- Replaced `field-with-action` row with inline layout plus `Input` + `Button` primitives.
	- Replaced `pill-button` removable chips with primitive `Button` (`variant="secondary"`, `size="sm"`).
	- Normalized helper copy blocks to `FieldHint` and secondary action links to `buttonVariants` styles.
- Removed now-unused legacy selector definitions from `src/client/styles.css`:
	- `button.danger-button`, `button.danger-button:hover`
	- `.pill-button`, `.pill-button:hover`
	- `.field-with-action` participation in grouped field layout rules

### Batch 3 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 4 delta

- Migrated remaining `admin-page-header` usage in admin pages to inline utility layout classes:
	- `src/client/pages/ThemesPage.tsx`
	- `src/client/pages/TeamsPage.tsx`
	- `src/client/pages/TeamDetailPage.tsx`
	- `src/client/pages/OperationsPage.tsx`
- Migrated remaining `admin-grid-2` usage to inline responsive grid utility classes:
	- `src/client/pages/TeamsPage.tsx`
	- `src/client/pages/TeamDetailPage.tsx`
- Added a Team Detail null-safety fix while touching the file:
	- guard `handleCopyTeamId` for nullable draft
	- switched `removeLiveMatchName` to functional state update

### Batch 4 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 5 delta

- Executed the planned orphan-selector cleanup pass after Batch 4.
- Verified `admin-page-header` and `admin-grid-2` were already fully absent from both:
	- `src/client/pages/**/*.tsx`
	- `src/client/styles.css`
- Result: no additional CSS deletions were necessary in this pass (no-op cleanup).

### Batch 5 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 6 delta

- Decommissioned the legacy table utility cluster by moving remaining usage in admin pages to inline utility classes:
	- `src/client/pages/ThemesPage.tsx`
	- `src/client/pages/TeamsPage.tsx`
- Removed legacy table utility selectors from `src/client/styles.css`:
	- `.table-toolbar`, `.table-compact-toggle`
	- `.data-table`, `.data-table--compact`
	- `.align-right`, `.table-actions`
	- `.table-bulk-bar`, `.table-bulk-summary`
	- `.table-select-cell`, `.table-select-all`, `.table-row-select`
	- Associated media-query entries for `.table-toolbar`, `.table-compact-toggle`, `.data-table`

### Batch 6 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 7 delta

- Migrated the full `operations-*` utility cluster out of Operations page markup into inline utility classes and local tone helpers in `src/client/pages/OperationsPage.tsx`:
	- Replaced `operations-status-*`, `operations-shell`, `operations-summary-grid`, `operations-meta-list*`, `operations-readiness-*`, `operations-warning-*`, `operations-disclosure*`, `operations-resolution-*`, and `operations-manual-*` class usage.
	- Replaced dynamic utility suffix usage with explicit helper mappers:
		- `resolutionNoteClass(...)`
		- `warningCardClass(...)`
		- `severityIconClass(...)`
- Removed decommissioned `operations-*` selector blocks from `src/client/styles.css`, including associated responsive leftovers.

### Batch 7 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 8 delta

- Decommissioned the shared match-result/team-candidate legacy utility cluster after migrating remaining usages in admin pages to inline utility classes:
	- `src/client/pages/OperationsPage.tsx`
	- `src/client/pages/TeamsPage.tsx`
- Removed legacy selector definitions from `src/client/styles.css`:
	- `.match-result-card`, `.match-result-badges`
	- `.team-candidate-list`, `.team-candidate-card`, `.team-candidate-card--primary`
	- `.team-candidate-copy`, `.team-candidate-copy strong`
	- `.team-candidate-meta`, `.team-candidate-actions`
	- `.team-candidate-list span`, `.match-result-card span`
- Kept `.team-logo-card` active and independent (still used in Team Detail).

### Batch 8 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).

## Batch 9 delta

- Decommissioned a low-risk legacy utility cluster by migrating remaining usages to inline utility classes:
	- `src/client/pages/OperationsPage.tsx`: replaced `.card-grid` usage.
	- `src/client/pages/TeamsPage.tsx`: replaced `.stats-grid` usage.
	- `src/client/pages/ThemeEditorPage.tsx`: replaced `.chip-button`, `.color-field`, `.field-unit`, and `.two-column-grid` usages.
- Removed corresponding selector definitions from `src/client/styles.css`:
	- `.card-grid`
	- `.stats-grid`, `.stats-grid div`, `.stats-grid strong`
	- `.color-field` and related input rules
	- `.field-unit`
	- `.chip-button`, `.chip-button:hover`, `.chip-button.active`
	- `.two-column-grid`
- Kept `.segmented-button` styles intact (split out from grouped selectors).

### Batch 9 validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed (34 tests in 8 files).
