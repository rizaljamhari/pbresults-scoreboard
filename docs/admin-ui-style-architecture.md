# Admin UI Style Architecture

Date: 2026-05-21
Scope: `/admin/*` surfaces only. Overlay styles remain isolated.

## Token Usage Rules

- Use admin semantic tokens defined in `src/client/styles.css` under `.admin-root`.
- Prefer semantic surface tokens (`--admin-surface-*`) and semantic text tokens (`--admin-text-*`) over hardcoded colors.
- Use `md3` tone tokens for state (`success`, `warning`, `critical`, `info`) via shared component variants.
- Keep focus state consistent through existing ring tokens (`--admin-focus-ring` + `md3-primary`).

## Primitive-First Composition

- Page chrome should use shared primitives from `src/client/components/ui/admin-layout.tsx`:
  - `AdminPageFrame`
  - `AdminPageHeader`
  - `AdminFilterBar`
  - `AdminStatTile`
  - `StatusPanel`
- Standard form/table controls should use primitives from `src/client/components/ui/*`.
- Use local Tailwind utility classes for one-off layout adjustments inside a page.

## Forbidden Patterns

- Do not add new global legacy selectors for admin pages in `styles.css` when a primitive/local utility is sufficient.
- Do not introduce admin styling in overlay files (`OverlayPage`, `OverlayRenderer`).
- Do not use ad-hoc hardcoded tone colors when a semantic variant exists.

## Guardrails

- Any admin visual change must keep overlay scope checks passing.
- Prefer additive refactors through primitives; remove legacy selectors only after usage is fully migrated.
