# Runtime Data

This directory is intentionally not versioned as live app state.

The application creates and manages files here at runtime, including:

- `settings.json`
- `themes.json`
- `teams.json`
- `assets.json`
- `operations.json`
- `uploads/`

For a fresh clone, these files are created automatically on first server start.

Do not commit local operator data, uploads, or database files back into the repo.
