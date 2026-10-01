# Rehearsal Mode: Test the Real Overlay Before Doors Open

Status: phases 1–3 implemented · 2026-10-02
Mockup: `docs/mockups/rehearsal-mode.html`

Before an event, the crew checks the theme in vMix by hand: long and short names, teams with and without logos, every event card, timeout, game finished and winner. It takes a long time, and it's easy to miss a case. The editor's preview modes only show the admin canvas, not what vMix renders.

**Rehearsal** plays a scripted set of test cases through the real `/overlay/live`, the page vMix shows. Each case comes with an **expected result** worked out from the theme's own settings. The operator watches vMix, marks each case *pass* or *issue*, and ends with a report.

It's a pre-show tool. It never runs during a match, and nothing it does is saved to themes, teams or overrides.

---

## 1. How it works

```
                 ┌───────────── real feed ─────────────┐
PBResults /live ─► livePoller ──► LiveGate ──► live.state ──► /overlay/live (vMix)
                                     ▲                    └─► Operations, sidebar
            Rehearsal runner ────────┘  (while rehearsing, the gate publishes rehearsal frames instead)
```

- A new **LiveGate** on the server decides which live state is published. Normally that's the poller's output, the same as today. During a rehearsal it's the rehearsal frames. `/api/live`, the `live.state` event and the snapshot all read from the gate, so every page sees one consistent state.
- The **poller keeps polling** during a rehearsal. It just isn't published. That lets the runner watch the real feed and stop the rehearsal the moment a match starts (§4).
- A **case** is one or more **frames**: a complete live state and how long to hold it. Most cases are one frame. Some need a sequence to exercise the real trigger logic:
  - **Timeout:** break clock at 0:30, then a jump to 2:00 on the next frame. That's the real "break time jumped up" rule, not a shortcut.
  - **Team switch:** one match's teams, then the next match's.
  - **Feed lost:** the feed status set to "error", keeping the last data, so you can confirm the overlay holds the last frame.
- Frames are built as complete `NormalizedLiveState` objects, with team matches attached, the same way the editor's preview data does it. Nothing touches the team registry, overrides or settings.
- **Rehearsal always uses the theme that's on air**, because that's what vMix shows. To rehearse another theme, put it on air first. The panel says so.

---

## 2. The test cases

Cases are data in one shared file, `src/shared/rehearsalCases.ts`. Each case has an id, a group, a title, one or more frames built from a context (theme, team registry, assets), and an **expectation** text built from the same context.

Sample teams come from **your registry**, so real names and logos are tested:

| Sample | How it is picked |
|---|---|
| Typical | Two active teams with logos and mid-length display names |
| Shortest / longest | Active teams with the shortest and longest scoreboard name |
| No logo | An active team without a primary or alternate logo. If none exists, a temporary sample team that is never saved |
| Unmatched | A feed name that matches nothing, e.g. `XYZ PAINTBALL` |
| Stress | A synthetic 32-character name, e.g. `EDMONTON IMPACT CHAMPIONSHIP TEAM` |

### Catalog

| # | Group | Case | Frames | Expectation, from the theme |
|---|---|---|---|---|
| 1 | Baseline | Normal game | Typical teams, 2–1, game clock 05:00 running | Names, scores, logos and clock as designed. Centre line during play: *Hidden / Text "…" / Break clock* |
| 2 | Names | Short names | Shortest registry names | Names fit and stay aligned |
| 3 | Names | Long names | Longest registry names | Names fit their box without overlapping the score, or are clipped neatly |
| 4 | Names | Stress name | 32-character name on both sides | Same. This is a worst case |
| 5 | Names | Unknown team | Unmatched feed names | The name shows as the feed sent it. Logo per fallback, see 7 |
| 5b | Names | Possible team | Near-miss feed names built from real teams (e.g. `KUDA PB`), confirmed "uncertain" by the real matcher | The name shows as the feed sent it, **not** the suggested team. Logo per fallback. Operations' *Team names on air* suggests the likely team |
| 6 | Logos | Both teams have logos | Teams with registry logos | Registry logos on both sides |
| 7 | Logos | Team without logo | No-logo team on both sides | **For each side, from the slot setting:** *none* → empty. *slot fallback* → the slot's fallback image (or empty if none is set). *event logo* → the event logo. *slot then event* → slot image, else the event logo |
| 8 | Logos | Mixed | Left has a logo, right has none | Left shows its registry logo. Right follows the rule in 7 |
| 9 | Scores & clocks | Start | 0–0, clock at the full length | — |
| 10 | Scores & clocks | Double digits | 12–10 | Two-digit scores fit their box |
| 11 | Scores & clocks | Clock at zero | Game clock 00:00 | — |
| 12 | Centre line | Break | Break, break clock 1:30 counting down | Centre line during breaks: *Break clock / Text / Hidden* |
| 13 | Events | Towel, left | `TOWEL1` | *If towel cards are on:* "Conceded" card over the left team, placement *on logo / on name / free*, motion *slide up*. *If off:* no card |
| 14 | Events | Towel, right | `TOWEL2` | Same, on the right |
| 15 | Events | Base, left | `BASE2` (home base) | Base card over the left team, or none if switched off |
| 16 | Events | Base, right | `BASE1` | Same, on the right |
| 17 | Events | Sides switched | Towel for the home team with sides switched | Card over the **right** team: the side swap is honoured |
| 18 | Moments | Timeout | Break 0:30, then 2:00 | Timeout card *on the centre line / free at x,y*, flashing for *1200 ms*, or none if off |
| 19 | Moments | Game finished, left wins | `END`, break, 3–1 | Game finished card (*text*, *placement*), plus a winner card over the left team if winner cards are on |
| 20 | Moments | Game finished, right wins | `END`, break, 1–3 | Winner card over the right team |
| 21 | Moments | Game finished, tie | `END`, break, 2–2 | Game finished card, **no** winner card |
| 22 | Transitions | Team switch | Typical teams, then two different teams | Team-switch animation if it's on, otherwise an instant change |
| 23 | Resilience | Feed lost | Feed status "error", data unchanged | The overlay keeps the last frame and never goes blank |
| 24 | Names | Accents and symbols | `SÃO PAULO ÇA`, `ÅRHUS ØRNE & CO.` | Every character in the theme font: no empty boxes, no stray fallback font |
| 25 | Logos | Alternate logo only | A team with an alternate logo but no primary (a sample borrowing an existing image if none exists) | The alternate logo from Teams |
| 26 | Logos | Logo file missing | A team pointing at a deleted logo file | Never a broken image: the slot's fallback, as if the team had no logo |
| 27 | Transitions | Game → break → game | Game 3 s, break 4 s, game | The centre line changes with the theme's change animation each way |
| 28 | Transitions | Towel clears | Towel 3 s, then normal play | The card appears, then goes away cleanly |
| 29 | Transitions | Finished → next match | END 4 s, then a new match with other teams | Game finished and winner cards clear, and the new teams come in (team-switch animation if on) |
| 30 | Clashes | Towel, then base | Towel left 3 s, then base right | The towel card is replaced by the base card on the other side |
| 31 | Clashes | Timeout jump after the game ended | END with the break clock jumping 0:30 → 2:00 | Game finished stays, and **no** timeout flashes |
| 32 | Resilience | Feed back with new data | Error 3 s, then ok with a new score | The overlay holds, then shows the new score as soon as the feed is back |

Note: the overlay picks a team's primary logo when one is set, and only otherwise the alternate. The expectations follow the same rule, so a team whose primary file is missing is expected to fall back, not to show its alternate.

Expectations are generated, never typed by hand. Change a theme setting, and the next rehearsal expects the new behaviour.

A case the theme can't show (for example base cards switched off) still runs. Its expectation says "no card should appear", which is a useful check in itself.

---

## 3. Running a rehearsal

**From Operations:** a **Rehearse** button in the toolbar opens the rehearsal panel in place of Checks.

```
Rehearsal · MBPJ Impact v3                                   ● Rehearsing   [Stop]
───────────────────────────────────────────────────────────────────────────────
 ▸ Baseline        1 Normal game                      ✓
 ▸ Names           2 Short names                      ✓
                   3 Long names                       ⚠ "right name clips the score"
                 ▶ 4 Stress name                      ← now on vMix
                   5 Unknown team
 ...
───────────────────────────────────────────────────────────────────────────────
 Expect: Names fit their box without overlapping the score, or are clipped neatly.

 [◀ Back]  [Pass ✓]  [Issue ⚠]  [Next ▶]          Auto-play  ○ off  ● every 6 s
```

- **Step by step** (the default): the operator watches vMix and clicks **Pass** or **Issue**, which moves to the next case. Issue asks for an optional one-line note.
- **Auto-play:** moves on every 6 s. Moment cases hold longer, for their animation. Use it to sit back and watch everything once.
- Any case can be jumped to from the list.
- The **On air strip** on Operations shows the same frame, so the admin view and the vMix output can be compared side by side.
- **At the end:** a summary like "21 passed · 2 issues", with **Copy report** (plain text with theme, time, and each issue with its note) and **Run again**.

**Visible everywhere while running:** the sidebar status box reads *Rehearsing · case 4 of 23* in amber, and every admin page shows a slim banner with **Stop**. The overlay itself shows **no** banner, because it has to look exactly as it will on air.

---

## 4. Safety rules (principle 5: nothing surprising during a show)

| Rule | Detail |
|---|---|
| **Refuse to start during a match** | Start is refused while the real feed is `ok` and in `RUNNING` (or `TOWEL*` / `BASE*`). It's allowed when the feed is down, polling is paused, or the feed shows a stopped game or a break. |
| **Stop automatically when a match starts** | During a rehearsal the runner still watches the real feed. If it switches to `RUNNING`, the rehearsal stops at once, real data is published, and Operations shows "Rehearsal stopped: a match started". |
| **Stop automatically when idle** | After 10 minutes without a step or a click, and when the last case ends in auto-play. |
| **Confirm on start** | "Start rehearsal? vMix will show test data until you stop it." |
| **Restore on stop** | Stopping publishes the real live state straight away, so the overlay returns to the true scoreboard within one update. |
| **Nothing persisted** | Frames live in memory. No team, override, theme or operator text is written. A server restart ends a rehearsal. |
| **One at a time** | A second Start, from another tab, joins the running rehearsal instead of starting a new one. |

---

## 5. Server

- **`src/server/liveGate.ts`**: holds the published live state and source (`feed` or `rehearsal`). The poller bridge in `index.ts` publishes through it, and `/api/live`, the snapshot and overlay health's `getServerLiveFetchedAt` all read from it.
- **`src/server/rehearsalRunner.ts`**: a state machine:
  - `idle` → `running(caseIndex, frameIndex)` → `finished | stopped(reason)`.
  - It holds marks (`pass | issue + note`), runs a frame timer, and publishes frames through the gate with `sourceStatus: "ok"` and `fetchedAt` set to now on each frame.
  - It ticks at the poll interval, so clocks count and timers behave as they would on air.
  - It subscribes to the poller to apply the auto-stop rule.
- **API** (local and LAN rules as today):
  - `GET /api/rehearsal`: current state, the case list with expectations, and marks.
  - `POST /api/rehearsal/start` `{ autoPlay?: boolean }`: 409 with a reason when refused.
  - `POST /api/rehearsal/go` `{ to: "next" | "prev" | caseId }`.
  - `POST /api/rehearsal/mark` `{ caseId, result: "pass" | "issue", note? }`.
  - `POST /api/rehearsal/autoplay` `{ on: boolean }`.
  - `POST /api/rehearsal/stop`.
- **Event:** a realtime `rehearsal.state` event, plus an optional `rehearsal` field in the snapshot, so every admin tab shows the banner and the panel stays in step across tabs.

## 6. Shared

- **`src/shared/rehearsalCases.ts`**: the catalog, sample-team selection and expectation builders. It's pure, so it's fully unit tested.
- **`src/shared/previewLive.ts`**: moves `buildMatchedPreviewMatch`, `buildUnmatchedPreviewMatch` and the base preview state out of `ThemeEditorPage` so the editor and rehearsal share one builder.

## 7. Client

- **Operations:** the **Rehearse** button, the rehearsal panel (case list, expectation, controls, marks, summary, copy report) and the refusal and auto-stop messages.
- **AppShell:** the sidebar status shows *Rehearsing* in amber, and a slim banner with **Stop** appears on every admin page.
- **Overlay:** no change. It renders whatever `live.state` says, which is exactly why rehearsal tests the real thing.

---

## 8. Phases

| # | Scope | Exit check |
|---|---|---|
| 1 | `previewLive` extraction, and the `rehearsalCases` catalog with expectations from theme settings | Unit tests: sample picking (shortest/longest/no-logo/fallbacks), every expectation variant (fallback modes, cards on/off, placements), timeout frames trip the real timeout rule |
| 2 | `LiveGate`, `rehearsalRunner`, API and event | Server tests: refuse during `RUNNING`, auto-stop when the feed starts a match, idle stop, restore on stop, frame timing and auto-play |
| 3 | Operations panel, banner, sidebar state, report | Browser: run all 33 cases on `/overlay/live` with the strip side by side. Marks, notes, copy report, stop restores the real feed |
| 4 | Later, optional: an operator text case (longest allowed text), saved reports (last 5, in backups), and rehearsing a non-published theme on `/overlay/preview/:id` | — |

---

## 9. As built

- **Frames are raw feed messages** run through the real normalizer, with teams pinned by in-memory overrides. They aren't prebuilt states, and the editor's preview builders weren't moved (§6 is superseded). Team-name matching, display names, event mapping and side switching therefore all run through the on-air code.
- **Decisions taken:**
  - Rehearsal is allowed any time except during a running match (§4).
  - The operator text case and saved reports are left for phase 4.
  - Copy report falls back to a manual-copy box on plain-http pages.
- **Keys while running:** P pass, I issue, ← → move.
- **Colour:** rehearsal has its own violet (`--ad-rh*`), so test data never reads as live, on air or a warning.

## 10. Decisions to confirm (original)

1. **When rehearsal is allowed.** The proposal is any time except during a running match, with an automatic stop if one starts. The stricter alternative is only when polling is paused or the feed is down.
2. **Operator text.** Should rehearsal also show a long operator text? It runs on a separate channel and would need the same "temporary, restore on stop" treatment, so it's proposed for phase 4.
3. **Saved reports.** Copying the report is phase 3. Keeping the last few in the app (and in backups) as a pre-event sign-off is phase 4. Do you want that sooner?
