# One-Click Setup

## macOS
- Double-click [setup.command](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard-theming/setup.command).
- After setup completes, double-click [run.command](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard-theming/run.command).

What setup does:
- installs or activates Node 22 through `fnm` when available
- falls back to installing `fnm` via Homebrew if needed
- activates `pnpm`
- installs dependencies
- builds the app
- prepares local data folders

## Windows
- Run `setup.bat`.
- Then run `run.bat`.

Windows assumption:
- Node 22 is already installed and available in `PATH`

## Dynamic ports
- The dev launcher now picks free client and server ports automatically.
- It prints the selected admin URL before starting the app.
- `run.command` and `run.bat` will open the correct admin URL automatically.

## Manual fallback

```sh
eval "$(fnm env --use-on-cd)"
fnm use 22
pnpm install
pnpm build
pnpm dev
```
