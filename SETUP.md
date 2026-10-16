# One-Click Setup

## macOS
- Double-click [setup.command](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/setup.command).
- After setup completes, double-click [run.command](/Users/rizaljamhari/Projects/personal/pbresults-scoreboard/run.command).

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

## Running without PBResults

Some events score everything by hand and don't run PBResults. The scoreboard still works there: the operator scores the match on the Operations page and the overlay shows it as it would a feed. Themes, the timeout, game finished, winner, towel and base cards, and rehearsals all work the same.

To switch it on:

1. Open **Settings** and set **Score source** to **Manual**.
2. Check the lengths below it: **Game clock length** (what Reset and Next match set the clock to), **Break length** and **Timeout adds**. All are in seconds.
3. Save and confirm. The overlay switches straight away and PBResults is no longer polled.

During the event, Operations shows a **Manual scoring** panel in place of Team names on air:

- **Teams:** Choose team on each side, then search the team registry, or type a name that isn't in it. A registry team brings its scoreboard name and logo; a typed name shows as typed, with no logo. Team name slots in most themes are sized for 8 characters.
- **Score:** − and + on each side. A point (+) stops the game clock; − is a correction and leaves it running.
- **Game clock:** Start/Stop, Set (type `7:30`, or `10` for 10 minutes) and Reset, plus one-click 3, 5, 8 and 10 min presets that set the clock.
- **Break:** Start break, Pause/Resume, and Timeout, which adds time to the break clock and shows the theme's timeout card. A timeout during play stops the clock and starts a break of that length. During a break, Set and Reset correct the break clock like the game clock's; setting it higher also shows the timeout card. The 10s, 15s and 30s presets start a break of that length straight away, during play or a break.
- **Finish match** shows the game finished and winner cards. **Next match** puts both scores to 0, moves the round on and resets the clock; the teams stay until you change them.
- **Towel** and **Base** show the theme's event card on that side for about 4 seconds and stop the game clock. They don't change the score: add the point with + (or Q / P) as well.
- When a break between points counts down to 0:00, the game clock starts by itself. Turn this off in Settings (**Start the clock when a break ends**) if points often start late. It never happens after Finish match.
- **Undo** reverses the last action, clocks included.

Keyboard shortcuts work anywhere on Operations except while typing in a field:

| Key | Action |
| --- | --- |
| Space | Start / stop the game clock |
| Q / A | Left score + / − |
| P / L | Right score + / − |
| B | Start or resume the break |
| T | Timeout |
| F | Finish match |
| Ctrl+Z (Cmd+Z on Mac) | Undo |
| H | Show / hide the scoreboard (as before) |

Things to know:

- The match is saved on every action. If the app is closed or restarts mid-match, it comes back with the same scores, and a running clock carries on as if it never stopped.
- Manual scoring is paused while a rehearsal runs, and a running manual clock stops a rehearsal, just as a live PBResults match does.
- To go back to PBResults, set Score source to **PBResults feed** in Settings. The manual match is kept for next time.
