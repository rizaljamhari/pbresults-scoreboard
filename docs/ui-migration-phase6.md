# UI Migration Phase 6 - Themes, Teams, Settings, ThemeEditor Admin Chrome

Date: 2026-05-19
Status: Completed

## Goal

Migrate remaining core admin list/form pages to the shared primitive layer while preserving behavior and keeping overlay routes unchanged.

## Implemented

### Themes page

Updated `src/client/pages/ThemesPage.tsx`:

- Replaced legacy action controls with `Button` and `buttonVariants`-based label links.
- Replaced status pills with semantic `Badge` variants.
- Replaced form controls with `Input`, `Select`, and `Checkbox`.
- Replaced table shell and table internals with `Table*` primitives.

### Settings page

Updated `src/client/pages/SettingsPage.tsx`:

- Replaced legacy panel wrappers with `Card`.
- Replaced status pills with `Badge`.
- Replaced action buttons with `Button` and import label with `buttonVariants` class.
- Replaced form controls with `Input`, `Select`, and `Checkbox`.
- Replaced hint text with `FieldHint`.

### Teams page

Updated `src/client/pages/TeamsPage.tsx`:

- Replaced header and bulk action controls with `Button`/`buttonVariants`.
- Replaced filters with `Input`, `Select`, `Checkbox`.
- Replaced status pills with `Badge`.
- Replaced table shell and structure with `Table*` primitives.
- Replaced panel wrappers with `Card` for Match Tester and Live Feed sections.
- Replaced remaining hint text with `FieldHint`.

### Theme editor page (admin chrome)

Updated `src/client/pages/ThemeEditorPage.tsx`:

- Migrated top-level admin chrome actions to primitives (`Button`, `buttonVariants`) in the header and preview toolbar menus.
- Replaced header status chip with semantic `Badge` warning state for unsaved changes.
- Replaced key hint text with `FieldHint` in section headers and admin header metadata.
- Kept editor internals, canvas manipulation, and overlay preview rendering behavior unchanged.

## Scope safety

- Overlay pages and overlay renderer files were not modified.

## Validation

- `pnpm check:overlay-scope` passed.
- `pnpm build` passed.
- `pnpm test` passed.
