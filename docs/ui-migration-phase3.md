# UI Migration Phase 3 - Reusable Primitive Layer

Date: 2026-05-19
Status: Completed

## Goal

Create a reusable admin UI primitive layer aligned to admin-scoped MD3 tokens without migrating page markup yet.

## Implemented primitives

Added/updated in `src/client/components/ui/`:

- `button.tsx`
  - MD3-aligned variants: default, secondary, outline, ghost, danger
  - Pill shape, focus ring, active press feedback
- `card.tsx`
  - Tokenized surface, border, elevation, title/description treatment
- `input.tsx`
  - Tokenized text input with focus behavior
- `badge.tsx`
  - Status variants (default/success/warning/critical/info)
- `label.tsx`
- `textarea.tsx`
- `checkbox.tsx`
- `select.tsx` (native select wrapper)
- `table.tsx`
  - Table shell, table parts, and empty-state cell wrappers
- `dropdown-menu.tsx`
  - details/summary-based dropdown wrappers matching current app behavior
- `form.tsx`
  - Form layout helpers (`FormGrid`, `FieldGroup`, `FieldHint`, `ActionRow`)
- `index.ts`
  - Barrel export for primitive imports

## Safety and scope

- No Admin page JSX migration in this phase.
- Overlay files were not touched.
- Existing legacy classes remain active while pages are migrated in later phases.

## Validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed.
