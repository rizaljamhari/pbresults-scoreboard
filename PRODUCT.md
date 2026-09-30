# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: paintball event operators outside the maintainer's own crew.** They receive the app as a Windows portable release and run it on a laptop or second monitor beside the vMix machine during live matches. Their attention is split with switching and production calls, and they may not be technical. Their job during a match is to keep the scoreboard overlay correct: watch feed health, resolve uncertain or truncated team names, and take or reset operator-controlled text.

**Secondary: theme designers** (often the same crews, before an event) who build and publish scoreboard themes, and **trusted remote staff** who configure the app away from the onsite machine (planned ngrok remote access).

## Product Purpose

PBResults Scoreboard sits on top of a PBResults `/live` feed and turns it into a broadcast-grade scoreboard overlay, consumed as a browser source in vMix (or OBS). The stock PBResults scoreboard is too basic for broadcast and offers little control over look and feel.

Success means the on-air scoreboard is correct, on-brand for the event, and never visibly breaks, even when the upstream feed or internet access fails, and that an operator can fix a problem mid-match in seconds.

## Positioning

An independent, onsite-first control layer for PBResults feeds: it normalizes the live data, lets an operator resolve messy team names live against a team registry with aliases and learned match names, and renders event-owned themes. The onsite machine is the source of truth; nothing required for the broadcast depends on the cloud.

## Operating Context

- Onsite LAN; event internet is unreliable or absent. The local overlay and operator controls must keep working offline.
- Operator on a single laptop or second monitor next to vMix, glancing between it and production.
- Overlay runs at `/overlay/live` as a vMix browser source; operators land on `/admin/operations`.
- Pre-event: theme building (`/admin/themes`), team registry and logos (`/admin/teams`), settings, backups, and software updates (`/admin/settings`).
- Remote staff may configure the app from elsewhere; onsite controls stay authoritative.

## Capabilities and Constraints

- Polls PBResults `/live`; keeps last known state on upstream error. Assumes `mainGame[0]` is left team and `mainGame[1]` is right.
- Normalized live state, team matching, and operator overrides feed both overlay and Operations page.
- Theme editor with free text and image layers; operator-controlled text with explicit Take and Reset.
- Team registry, logos (with background removal), aliases, learned live match names.
- Full state, team, and theme export/import; local JSON data under `data/`.
- Windows x64 portable build with verified, confirmed, rollback-capable updates; updates never install silently during an event.
- Single multiplexed SSE stream (`/api/events`) keeps admin tabs and overlay in sync.
- Overlay styling is isolated from admin styling (`pnpm check:overlay-scope`); admin work must not leak into overlay files.
- Roadmap: automatic local and cloud backups, temporary ngrok remote access.

## Brand Commitments

- Name: PBResults Scoreboard. It is an independent tool built on the PBResults feed, not an official PBResults product; do not use PBResults branding as its identity.
- The broadcast overlay's look belongs to each event's theme. The admin UI must not impose a broadcast style on themes.

## Evidence on Hand

- Screenshots: `docs/images/default-scoreboard-example.png` (stock PBResults), `docs/images/live-overlay-example.png`, `docs/images/admin-operations-example.png`, `docs/images/theme-editor-example.png`, and UI baselines in `docs/images/ui-baseline/2026-05-19/`.
- Architecture and roadmap docs in `docs/`.
- No testimonials, user counts, or event case studies exist; do not fabricate them.

## Product Principles

1. **The broadcast never breaks.** Degrade to last known good state; failures are visible to the operator, never to viewers.
2. **Seconds, not searches.** Mid-match fixes (team resolution, operator text) must be reachable and completable in a few seconds by a non-technical operator.
3. **Onsite is the source of truth.** Offline-first; cloud and remote access are conveniences layered on top.
4. **Themes belong to the event.** The tool provides control and fidelity; each event owns its on-air look.
5. **Nothing surprising during a show.** Irreversible or disruptive actions (updates, imports, resets) are explicit and confirmed.
