# UI Migration Phase 5 - Shared Admin Shell

Date: 2026-05-19
Status: Completed

## Goal

Migrate the shared admin shell layout/navigation to the new tokenized Tailwind foundation while preserving route behavior and keeping overlay routes unaffected.

## Implemented

Updated `src/client/components/AppShell.tsx`:

- Added token-aware nav class helper for active/inactive pill links.
- Added declarative nav item list for consistent route rendering.
- Migrated sidebar and shell styling to MD3 tokenized Tailwind utility classes.
- Added active indicator decoration for current route in nav.
- Kept route structure and destinations unchanged.

## Scope safety

- Overlay pages are not rendered through AppShell and remain untouched.
- No overlay-specific source files were modified.

## Validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed.
