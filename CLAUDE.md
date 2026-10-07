# PBResults Scoreboard

See `PRODUCT.md` for who uses this and why, and `DESIGN.md` for the admin UI.

## Editing themes

When asked to change a theme's look (not the theme editor's code):

- Never edit the published theme. Check `publishedThemeId` in `GET /api/settings`; if the target is published, clone it first with `POST /api/themes` (`{ "cloneFromId", "name" }`) and edit the clone.
- Before each edit, keep a version: `POST /api/themes/:id/versions` with `{ "name": "Before AI: <what you're changing>", "theme": <current theme> }`.
- Save through `PUT /api/themes/:id` so the change is validated against `themeSchema` and open editor tabs refresh. Never write `data/themes.json` directly.
- Never call `POST /api/themes/:id/publish`. Going on air is the user's decision.
- The theme fields are defined in `src/shared/theme.ts`. Team names arrive truncated to 8 characters, so size name slots for that.
- Check the result visually at `/overlay/preview/:id`, then summarise what changed in plain terms (colours, fonts, sizes), not as JSON.

The server runs on port 3000 (`PORT`). In dev, `pnpm dev` may pick the next free port; check its `[dev]` output.
