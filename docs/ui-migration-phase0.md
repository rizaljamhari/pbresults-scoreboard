# UI Migration Phase 0 - Baseline and Guardrails

Date: 2026-05-19
Scope: Admin UI migration to Tailwind + shadcn. Overlay UI excluded.

## Baseline Capture Checklist

Capture and store screenshots before any visual migration changes.

Required routes:
- /admin/operations
- /admin/themes
- /admin/teams
- /admin/settings
- /overlay/live
- /overlay/preview/:id (use one valid theme id)

Store captures under:
- docs/images/ui-baseline/2026-05-19/

Suggested filenames:
- admin-operations.png
- admin-themes.png
- admin-teams.png
- admin-settings.png
- overlay-live.png
- overlay-preview.png

## Baseline Behavior Checklist

Record pass/fail and notes for:
- Keyboard tab order and focus visibility on all admin pages.
- Operations refresh and poll toggle behavior.
- Row action menu open/close behavior in table-driven pages.
- Compact table mode toggle behavior where available.
- Settings save/discard workflow and unload guard behavior.
- Overlay live page rendering and preview page rendering.

## Migration Guardrails

1. Tailwind and shadcn are allowed only for Admin UI.
2. Overlay files are excluded from Tailwind class adoption:
   - src/client/pages/OverlayPage.tsx
   - src/client/components/OverlayRenderer.tsx
3. No new legacy CSS selectors should be added for migrated admin surfaces.
4. If overlay visual/behavior regression is detected, stop rollout and revert phase branch.

## Rollback Rules

- Execute one phase per branch/PR.
- If a phase breaks overlay behavior or visuals, revert that phase branch only.
- Do not continue to next phase until verification gate passes.

## Acceptance Gate (Phase 0)

- [ ] Baseline screenshot set captured and stored.
- [ ] Baseline behavior checklist recorded.
- [ ] Guardrails documented and agreed.
- [ ] Rollback process documented.
