# Overlay Health on Operations

Status: phases 1–3 implemented · 2026-10-02 · phase 4 (vMix machine check) pending
Mockup: `docs/mockups/overlay-health.html`

Operations shows what the **server** knows: the feed, polling, which theme is set on air, and team matches. The "On air" strip is drawn inside the admin tab, so it shows what the server *intends* to put on air. Nothing tells the operator whether the page vMix actually loaded is connected, showing the right theme, and keeping up with the feed.

This feature has every `/overlay/live` page report back. Operations can then answer, at a glance: **is the overlay vMix uses alive, showing what we think, and current?**

---

## 1. Failures this catches

None of these change anything on Operations today, so everything stays green while viewers see a frozen or wrong scoreboard.

| Failure | What the operator would see |
|---|---|
| The network between the vMix machine and the laptop drops, but the server is fine | **Overlay lost**: disconnected 12 s ago |
| The browser source was never added, points at the wrong host or port, or vMix didn't load it | **No overlay connected** |
| The browser source points at `/overlay/preview/<id>` instead of live | **No live overlay**: one preview page connected |
| The overlay is stuck on a theme or theme version that's no longer current | **Overlay out of date**: showing MBPJ Impact v2, on air is v3 |
| The overlay is connected but its live data lags the server | **Overlay behind**: live data 9 s older than the server's |
| The overlay runs an older app version after an update, before its automatic reload | **Overlay on old version** (should clear by itself) |

It does **not** detect whether vMix has the input **in Program**, or what reaches the stream. Those belong to vMix. The page can only report what it renders.

---

## 2. Design

### 2.1 Two signals per overlay

1. **Connection (instant).** The overlay's existing `/api/events` stream is tagged with a client id. When the stream closes, the server knows within a second or two (TCP close, or the existing 15 s keep-alive failing).
2. **Report (every 5 s).** The page posts a small status: what it renders, plus the live data it holds. This works even when the event stream has fallen back to REST polling, so "connected" means "rendering and reporting", not only "socket open".

Combined state per overlay, computed on the server:

| State | Rule |
|---|---|
| `connected` | Stream open, or a report within the last 15 s |
| `stale` | Stream closed **and** last report 15–60 s ago (likely a network blip) |
| `lost` | Neither for more than 60 s; kept in the list for 10 min, then pruned |

**A caveat on throttling.** Chrome slows timers in hidden tabs, so reports can arrive late (in the worst case, once a minute). An open stream therefore counts as `connected` on its own. The report also carries `document.visibilityState`, and a hidden page is shown as "in background" rather than flagged as an error. Whether vMix's embedded browser reports itself as hidden when the input isn't on air needs checking on a real machine (§7).

### 2.2 What a report contains

```ts
type OverlayReport = {
  clientId: string;            // random per page; kept in sessionStorage so a reload replaces its own entry
  path: "/overlay/live" | `/overlay/preview/${string}`;
  themeId: string | null;      // the theme it is rendering
  themeUpdatedAt: string | null;
  liveFetchedAt: string | null;   // fetchedAt of the live state it is rendering
  liveSourceStatus: "idle" | "ok" | "error" | "paused" | null;
  transport: "stream" | "fallback";   // event stream, or REST polling
  appVersion: string;
  visibility: "visible" | "hidden";
  viewport: { width: number; height: number };  // e.g. 1920×1080 in vMix
  reportedAt: string;
};
```

The server adds, from the request: `remoteAddress`, `userAgent`, `firstSeenAt` and `lastReportAt`. It shows the address as "This computer" for loopback.

### 2.3 How health is judged

A pure function shared by server and client, `overlayHealth(report, server, now)`, compares the report against the server's own state:

| Check | Warning when |
|---|---|
| Theme | `themeId` ≠ the published theme (for live pages) |
| Theme version | `themeUpdatedAt` is older than the published theme's `updatedAt` for more than 10 s |
| Live data | the server's `fetchedAt` is ahead of `liveFetchedAt` by more than `max(5 s, 5 × poll interval)`, and the server's own feed is `ok` |
| Version | `appVersion` ≠ the server runtime `appVersion` for more than 30 s |
| Transport | `fallback`: shown as information, not an error |

The page-level summary picks the most important state:

1. **No live overlay**, when no `/overlay/live` client is connected. This is a warning, not critical, because the show may not have started.
2. **Overlay lost**, when the only live overlay went `lost` or `stale`. This is critical.
3. **Overlay out of date / behind / old version**. These are warnings.
4. **Live overlay connected**, the healthy state (e.g. "1 live overlay").

The rule is "at least one healthy live overlay": a second test tab doesn't hide the real vMix overlay's problems, because every overlay is listed.

### 2.4 Data flow

```
/overlay/live ──(SSE /api/events?client=<id>&role=overlay)──► server: OverlayRegistry
      │                                                         ▲   │
      └──(POST /api/overlay/report every 5 s, and on change)────┘   │
                                                                     ▼
Operations / sidebar ◄──(SSE "overlay.state", throttled to 1/s)── registry
                     ◄──(GET /api/overlay/clients, on load and on reconnect)
```

---

## 3. Server

### 3.1 `src/server/overlayRegistry.ts` (new)

An in-memory registry keyed by `clientId`. Nothing is persisted: after a restart, overlays reconnect (the stream retries every 2 s) and report again within about 5 s.

```ts
class OverlayRegistry {
  attachStream(clientId: string, meta): () => void;   // returns detach, called on stream close
  report(report: OverlayReport, meta): void;
  list(now): OverlayClient[];                          // with derived state, newest first
  prune(now): void;                                    // drops lost entries after 10 min; also caps at 50 entries
}
```

Each change (attach, detach or report) triggers a throttled broadcast of the full list. The list is small: a few clients, under 1 KB.

### 3.2 Routes

- **`/api/events`** (in `appEventRoutes.ts`): read the optional `client` and `role=overlay` query values. When `role=overlay`, call `registry.attachStream` and detach on cleanup. Admin tabs pass nothing, so nothing changes for them.
- **`POST /api/overlay/report`**: validate with zod, cap the body at 2 KB, `registry.report`, reply 204. No authentication beyond the existing LAN access rules, the same as every other route.
- **`GET /api/overlay/clients`**: the current list, for page load and after an event-stream reconnect.

### 3.3 Event

Add a data-bearing realtime event `overlay.state` (`{ clients: OverlayClient[] }`) next to `live.state` in `src/shared/appEvents.ts`. The `system.snapshot` event gains an optional `overlayState` so a reconnecting admin tab gets the list straight away.

---

## 4. Overlay page

### 4.1 `useOverlayReporter` (new hook, used only by `OverlayPage`)

- Runs on **live** and **preview** pages, but never in the editor canvas or the Operations strip. Those render `OverlayRenderer` directly, not `OverlayPage`.
- Builds the report from the theme, live state, runtime version and transport the page already holds.
- Posts it every 5 s, and immediately when the theme, `themeUpdatedAt` or the live `fetchedAt` changes. Immediate posts are throttled to at most 1 per second.
- Sends `navigator.sendBeacon('/api/overlay/report', { …, leaving: true })` on `pagehide`, so a page that is closed normally disappears straight away instead of after 60 s.
- Any failure is ignored silently: reporting must never affect rendering. Principle 1, the broadcast never breaks.

### 4.2 Tagging the event stream

`appEvents.tsx` opens `/api/events?client=<id>&role=overlay` when `location.pathname` starts with `/overlay/`. It uses the same `clientId` from `sessionStorage`. Admin pages keep the plain URL.

Neither change adds anything to the rendered overlay, and `pnpm check:overlay-scope` stays clean.

---

## 5. Operations and sidebar

### 5.1 Sidebar status box (every admin page)

Add a third line under Feed and On air:

```
Feed     ● Live · just now
On air   ● MBPJ Impact v3
Overlay  ● Connected            ← green / amber "Behind 9s" / red "Lost 12s ago" / grey "Not connected"
```

`liveSummary` takes the overlay summary into account. "Overlay lost" ranks just below "Live feed unreachable" as the headline state, so an operator on another admin page still sees it.

### 5.2 On air strip header

A chip next to the theme chip: **● vMix overlay connected** or **● No live overlay**. Clicking it opens the details in 5.3.

### 5.3 Checks and details

- **Checks**: add an "Overlay connected" row. It joins `readinessChecks` and `goLiveIssues`, with guidance text such as "Add `/overlay/live` as a Browser input in vMix. Copy the URL from vMix setup."
- **"Overlay details" disclosure** (it already exists, for logo sources and modes): a small list with one row per connected page:

```
● Live    192.168.1.20 · vMix (Chrome 120)   MBPJ Impact v3   live 1 s   1920×1080   connected 2 h
○ Preview This computer · Chrome            APM Invitational  live 2 s   1280×720    in background
```

---

## 6. Phases

| # | Scope | Exit check |
|---|---|---|
| 1 | Registry, routes, the `overlay.state` event, and the shared `overlayHealth` function with unit tests | Server tests: attach/detach/report/prune, state changes over time, and health rules (wrong theme, outdated, behind, old version) |
| 2 | Overlay reporter and stream tagging | Open `/overlay/live` and `GET /api/overlay/clients` lists it. Close the tab and it drops to `lost` almost at once. Kill the network in devtools and it moves to `stale` then `lost` |
| 3 | Operations chip, check, details list, and sidebar line | With no overlay open the sidebar says "Not connected". Opening `/overlay/live` turns it green. Publishing another theme briefly shows "out of date" until the overlay catches up |
| 4 | Real-machine check with vMix on Windows (§7) | Thresholds tuned, and the vMix user-agent label confirmed |

---

## 7. Open questions (need a vMix machine)

1. **What vMix's embedded browser reports for `visibilityState`** when the input is loaded but not on Program or Preview. If it reports hidden, show "Loaded in vMix, not on air" as information.
2. **Timer throttling** in vMix's embedded browser for inputs that aren't visible, which decides whether the 15 s / 60 s thresholds need widening.
3. **vMix's user-agent string**, to label it "vMix" instead of "Chrome". If it can't be recognised, show the address only.

---

## 8. Risks and decisions

- **As built.**
  - The UI says "live overlay", never "vMix", because a page cannot prove it is vMix. A row's browser label says vMix only when the user agent does.
  - The sidebar overlay line sits on every admin page.
  - The Operations section is called **Overlay pages**. It sits next to the existing logo-focused **Overlay details**, and the strip chip opens it.
  - In development, every address shows as "This computer" because Vite proxies requests. The packaged app sees the real address.

- **No persistence.** Overlay status describes the current moment only, so it restarts empty, and the first 5 s after a server restart show "No live overlay" until overlays reconnect. The sidebar waits for 10 s after start-up before saying "Not connected".
- **Not a promise about the stream.** The copy always says "overlay", never "on stream", because Program, recording and streaming are outside what the page can see.
- **Background preview tabs** are listed but never counted as the live overlay, and are never alarmed on.
- **Remote access (planned ngrok).** Reports come from whoever loads `/overlay/live`. A remote viewer would show up as an extra overlay with a non-LAN address. That's acceptable; it can be filtered or labelled when remote access arrives.
