# Event-driven UI Refresh Technical Plan

Status: implemented; Windows qualification pending

Roadmap feature: Feature 2 — Event-driven UI refresh

Last reviewed: 2026-08-19

## 1. Summary

Use one multiplexed Server-Sent Events (SSE) connection per top-level browser tab at:

```text
GET /api/events
```

The stream carries small configuration invalidations plus complete normalized live-scoreboard and operator-text state. Existing REST endpoints remain authoritative for configuration and disconnected fallback. On a configuration event, the client coalesces duplicate invalidations and refetches only the affected resource. A connection snapshot includes the current live/operator state, and serialized fallbacks make the UI correct after missed events, browser sleep, network interruption, and application restart.

This supersedes the former `/api/live/stream` and `/api/operations/text/stream` routes. Operator Overview's same-origin overlay iframe receives validated events from its parent through a `MessageChannel`, preventing that iframe from consuming another HTTP/1.1 connection.

The implementation removes the overlay's three-second asset poll, five-second published-theme poll, and connected-state runtime poll. Runtime REST checks run every 60 seconds only while SSE is disconnected.

## 2. Goals

- Reflect successful configuration mutations in other open admin tabs and in the browser overlay within one second under normal LAN conditions.
- Use one shared event connection per top-level tab rather than separate configuration, live, and operator streams.
- Keep REST snapshots as the source of truth. An event means “this resource may be stale,” never “apply this payload as state.”
- Recover automatically from missed messages, browser suspension, offline periods, proxies, and server restarts.
- Coalesce event bursts and prevent overlapping refetches from creating request storms or stale-response races.
- Preserve unsaved editor drafts when another browser changes the same resource.
- Avoid placing URLs, settings values, filenames, theme contents, or other configuration data on the stream; only the already-public live and operator state payloads are data-bearing.
- Keep a slow fallback refresh while SSE is unavailable.
- Ensure slow or abandoned clients cannot block mutations or grow server memory without a bound.

## 3. Non-goals

- Sending full settings, theme, asset, or team resources through `/api/events`.
- Guaranteed event delivery, durable queues, or cross-process message brokers.
- Multi-user edit locking, merge resolution, or optimistic concurrency control. Existing writes remain last-write-wins.
- Adding authentication or changing the current local/LAN trust model.
- Moving update-progress polling to SSE. Update progress is active job telemetry and remains on its existing adaptive poll.
- Watching the JSON files for out-of-process edits. Supported mutations continue to go through application APIs.

## 4. Original behavior and corrected gap

The first implementation added `/api/events` alongside two existing SSE routes:

- `/api/live/stream` publishes normalized PBResults state.
- `/api/operations/text/stream` publishes operator-controlled text state.

Configuration data behaves differently:

| Resource | Current client behavior | Gap |
| --- | --- | --- |
| Settings | Loaded once by `useSettings()` | Other tabs do not see saves or polling start/stop changes. |
| Theme lists and editor themes | Loaded once, then updated only by the initiating page | Other tabs and preview windows can remain stale. |
| Published overlay theme | `OverlayPage` fetches settings and the theme every five seconds | Repeated requests and up to five seconds of delay. |
| Assets | Admin hooks load once; overlay refetches every three seconds | Repeated requests; admin pickers remain stale. |
| Teams | Loaded once; the live poller is reconfigured after mutations | Admin lists remain stale, and team-logo uploads also change assets. |
| Runtime version | Admin shell and overlay poll every five seconds | Reliable but produces continuous requests in every browser. |

Operator Overview also embeds `/overlay/live`, so its parent and iframe each opened all three streams. That reached Chrome's six-connection HTTP/1.1 per-origin limit in one tab and queued ordinary API requests. The corrected design uses one top-level EventSource and a parent-to-iframe relay, allows native EventSource reconnection, and uses serialized REST polling only as a temporary correctness fallback.

## 5. Architecture decisions

### 5.1 One event hub, one connection per tab

Create a small in-process hub owned by the Fastify process. `AppEventProvider`, mounted above all routes, owns the browser's single `/api/events` connection and distributes typed invalidations to resource hooks.

```text
successful API mutation
        |
        v
  persist through storage
        |
        v
 AppEventHub.publish(...)
        |
        +--------------------+--------------------+
        v                    v                    v
   admin tab SSE        overlay SSE        another admin SSE
        |                    |                    |
        v                    v                    v
 coalesced REST GET     coalesced REST GET   coalesced REST GET
```

The hub is intentionally process-local. The application currently runs as one Node process, and a managed update restarts that process. A per-process instance identifier lets clients recognize that restart and resynchronize.

### 5.2 Configuration notifications plus real-time state

Configuration events contain only a type, process instance ID, sequence, resource revision, timestamp, and optional opaque resource IDs. Clients call the existing GET endpoint to obtain current validated configuration. `live.state` and `operator-text.state` carry their complete validated state because turning every real-time update into a REST invalidation would add latency and request volume.

This avoids:

- exposing settings contents on a long-lived stream
- applying partial updates in the wrong order
- making replay mandatory for correctness

False-positive invalidations are safe. Missing an invalidation is also recoverable through the connection snapshot or fallback refresh.

### 5.3 In-memory revisions plus a process instance ID

The hub owns:

- a random `instanceId` created at server startup
- a monotonically increasing event `sequence`
- a monotonically increasing revision for each resource domain

Revisions do not need to be persisted. A new process has a new `instanceId`, and clients treat an instance change as a full configuration resync. Persisting delivery metadata would add disk writes without improving correctness.

### 5.4 No replay buffer in v1

The server accepts the browser-supplied `Last-Event-ID` but does not replay in v1. Every connection immediately receives a state snapshot containing the current instance, revisions, and runtime identity. A reconnect compares that state vector with the last one seen and invalidates anything that may have changed.

Composite event IDs are included now so replay can be added later without changing the wire shape:

```text
<instanceId>:<sequence>
```

Correctness must never depend on the replay window.

### 5.5 Keep editors draft-safe

Collection pages and overlays may refetch automatically. Editors must not silently replace an unsaved draft.

- Settings: refresh the saved server snapshot; retain an unsaved form draft and show “Settings changed elsewhere.”
- Team detail: refresh the backing team record; retain the draft and show an external-change warning when the selected team changed.
- Theme editor: if clean, refetch the selected theme; if dirty, mark it stale and offer **Reload server version** or **Keep editing**. Do not replace history or the current draft automatically.
- Lists and asset pickers: refresh automatically.

This feature does not add conditional writes, so choosing to save after an external-change warning still overwrites the current server value under the existing last-write-wins model.

## 6. Shared event contract

Add `src/shared/appEvents.ts` so server and client use the same Zod schemas and TypeScript types.

### 6.1 Resource domains

```ts
type AppResourceDomain = "settings" | "themes" | "assets" | "teams";
```

`teams` is included even though the roadmap outcome emphasizes settings, themes, and assets. Team edits alter normalized live state, team selectors, and logo resolution, so omitting the domain would leave admin tabs stale and make import behavior incomplete.

### 6.2 Event types

```ts
type AppEventType =
  | "system.snapshot"
  | "settings.changed"
  | "themes.changed"
  | "theme.published"
  | "assets.changed"
  | "teams.changed";
```

Each changed event maps to one revision domain. `theme.published` maps to the `settings` domain because publishing changes `settings.publishedThemeId`; it does not increment the themes revision.

`system.snapshot` replaces a standalone `runtime.changed` broadcast in v1. Runtime build identity is immutable within a process, so the only truthful runtime transition occurs across a restart, when the old process can no longer publish the new identity. The first snapshot from the new process supplies that identity.

### 6.3 Snapshot event

The server sends this event immediately after the SSE response is established:

```text
retry: 2000
id: 9ab2...:17
event: system.snapshot
data: {"protocol":1,"type":"system.snapshot","instanceId":"9ab2...","sequence":17,"occurredAt":"2026-08-19T05:00:00.000Z","revisions":{"settings":3,"themes":8,"assets":4,"teams":6},"runtime":{"appVersion":"1.8.0","releaseTag":"v1.8.0"}}

```

The snapshot includes no preferred LAN address because runtime reload detection only needs `appVersion` and `releaseTag`.

### 6.4 Changed event

Example:

```text
id: 9ab2...:18
event: themes.changed
data: {"protocol":1,"type":"themes.changed","instanceId":"9ab2...","sequence":18,"occurredAt":"2026-08-19T05:00:02.100Z","revision":9,"resourceIds":["theme-123"]}

```

Rules:

- `resourceIds` is optional, contains only opaque internal IDs, is de-duplicated, and is capped at 100 entries.
- A missing `resourceIds` means the entire domain may have changed.
- `theme.published` includes the newly published theme ID or an empty list when no theme is published.
- Unknown event types or protocol versions are ignored by the client and recovered through fallback reconciliation.
- The SSE `event` field and JSON `type` must agree.

## 7. Server design

### 7.1 `AppEventHub`

Add `src/server/appEventHub.ts` with an injectable clock and ID generator for deterministic tests.

Recommended public surface:

```ts
class AppEventHub {
  getSnapshot(runtime: RuntimeIdentity): AppEventSnapshot;
  publish(type: ChangedEventType, resourceIds?: string[]): AppChangedEvent;
  subscribe(listener: (frame: string) => boolean): () => void;
  heartbeat(): void;
  getStats(): { connectedClients: number; sequence: number };
  close(): void;
}
```

Behavior:

1. `publish` increments the global sequence and the affected domain revision before formatting the frame.
2. Broadcasting iterates over a snapshot of subscribers so unsubscribe during delivery is safe.
3. A listener returns `false` when `ServerResponse.write()` reports backpressure or the response is no longer writable. The route destroys that response and the hub removes the listener immediately. EventSource reconnect plus `system.snapshot` is safer than buffering an unbounded queue for a slow client.
4. A single 15-second heartbeat timer broadcasts `: keep-alive <unix-ms>\n\n` through the same bounded-delivery path.
5. Listener exceptions are isolated, logged without event payload contents, and remove only that listener.
6. `close` stops the heartbeat and clears subscribers. The existing graceful-shutdown stream registry sends `retry: 2000` and ends the underlying responses before the hub closes.

Set a conservative connection limit, initially 100 streams for the process. Reject additional connections with `503 EVENT_STREAM_CAPACITY` before hijacking the response. The expected operational count is only a handful of tabs and overlays.

### 7.2 SSE route

Add `src/server/appEventRoutes.ts` to register `GET /api/events`. Keeping route setup separate makes it testable with a small Fastify instance without refactoring the entire server entry point.

Response headers:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Route lifecycle:

1. Check capacity.
2. Hijack the reply and write the headers.
3. Add the raw response to the existing `openStreams` set.
4. Register the client with the event hub.
5. Immediately write `retry: 2000` and `system.snapshot`.
6. On `close`, `error`, or an unwritable response, unsubscribe exactly once and remove it from `openStreams`.

The endpoint follows the same CORS and network-access rules as the other APIs. It introduces no separate public listener and sends no credentials or configuration values.

### 7.3 Emission boundary

Publish in API/service orchestration after the storage operation has completed successfully and before returning the response. Do not emit inside `writeJson` or low-level storage helpers:

- route-level publication can consolidate compound mutations
- failed validation never reaches publication
- storage initialization and migrations do not produce browser events
- reusable storage functions remain independent of HTTP/runtime concerns

For asynchronous imports, emit only after the complete import function resolves. The current app, team, and theme import flows are not transactional; making them transactional belongs to the backup feature. This plan must not imply that an event turns a partially failed import into an atomic operation. A slow fallback reconciliation still discovers any partial state left by a failed legacy import.

### 7.4 Mutation-to-event matrix

| Mutation route | Events after success | Notes |
| --- | --- | --- |
| `PUT /api/settings` | `settings.changed` | Existing poller, update-check, and operator-text reconfiguration remains first. |
| `POST /api/live/poll/start` | `settings.changed` | Poll enabled is persisted settings. |
| `POST /api/live/poll/stop` | `settings.changed` | Poll enabled is persisted settings. |
| `POST /api/app/import` | `settings.changed`, `themes.changed`, `assets.changed`, `teams.changed` | Emit only after files and all JSON documents are written. |
| `POST /api/teams/import` | `teams.changed`, `assets.changed` | Imported logos can extend the asset registry. |
| `POST /api/teams` | `teams.changed` with team ID | Live poller reconfiguration remains unchanged. |
| `PUT /api/teams/:id` | `teams.changed` with team ID | Also affects subsequent normalized live state. |
| `DELETE /api/teams/:id` | `teams.changed` with team ID | A deleted ID may still be included as an invalidation hint. |
| `POST /api/teams/:id/logo` | `teams.changed`, `assets.changed` | One request changes the team record and may create/reuse assets. |
| `POST /api/operations/resolve` | `teams.changed` only when `remember` changes learned names | Resolution itself is already reflected through the live stream. A harmless broader invalidation is acceptable if detecting a no-op is costly. |
| `POST /api/themes` | `themes.changed` with theme ID | Includes clones. |
| `PUT /api/themes/:id` | `themes.changed` with theme ID | If this ID is published, the overlay refetches it automatically. |
| `DELETE /api/themes/:id` | `themes.changed`; also `settings.changed` if publication falls back | Capture the old published ID before deletion or safely emit both. |
| `POST /api/themes/:id/publish` | `theme.published` | This event increments the settings revision and invalidates settings; theme data itself did not change. |
| `POST /api/themes/import` | `themes.changed`, `assets.changed` | Imported asset IDs are remapped. |
| `POST /api/assets` | `assets.changed` | A duplicate upload may reuse an asset; a false-positive invalidation is safe. |

No configuration invalidation is required for live-feed refresh, resolution-only changes, or operator-text changes. The process-level live and operator bridges publish `live.state` and `operator-text.state` on the same hub. Update status retains its adaptive polling; exports and other read-only routes publish nothing.

### 7.5 Graceful shutdown and managed updates

Register the new stream in the existing `openStreams` set. During shutdown:

1. stop new event publication
2. send a retry hint and end all SSE responses
3. stop the event heartbeat
4. close Fastify

Do not emit `runtime.changed` before shutdown; the old process does not know whether installation and restart will succeed. The reconnect snapshot from the resulting process is authoritative.

## 8. Client design

### 8.1 `AppEventProvider`

Add `src/client/appEvents.tsx` and mount its provider in `main.tsx` above `App`, so admin routes, live overlay, and preview overlay share the same behavior.

The provider owns:

- one `EventSource("/api/events")`
- connection state: `connecting`, `open`, or `disconnected`
- the last `instanceId`, revision vector, and runtime identity
- a subscriber registry by resource domain
- external-store subscriptions for the latest live and operator-text state
- a slow reconciliation timer while disconnected

Use `addEventListener` for each named event. Parse every payload with the shared Zod schema before using it.

Do not close the `EventSource` in `onerror`. Mark the connection disconnected and let the browser apply the server's `retry` delay. Close it only when the provider unmounts or when deliberately replacing the connection.

### 8.2 Snapshot reconciliation

On `system.snapshot`:

1. If this is the first snapshot, establish the baseline and request a coalesced refresh of active resources. Initial hook loads and this refresh may overlap, so the resource coordinator must merge them.
2. Conservatively invalidate every active domain on each reconnect snapshot. This also retries a resource whose previous event-triggered GET failed after its revision was observed.
3. If `instanceId` changed but runtime identity is unchanged, continue with the same full active-domain resync. This covers ordinary restarts.
4. If runtime identity changed, trigger the guarded page reload described below. The new page performs normal initial loads.
5. Replace the saved revision vector before accepting subsequent changed events from that connection.

Events with an older/equal revision or a different stale instance are ignored. Gaps are harmless: receiving revision 12 after revision 9 invalidates once, and the GET returns the current resource.

### 8.3 Resource refresh coordinator

Refactor `useResource` to expose `refresh`, `refreshing`, and `stale`, and allow a hook to register event domains and an optional resource-ID predicate.

Each hook maintains:

- a 100 ms debounce window
- at most one request in flight
- a `dirtyWhileLoading` flag
- a request generation/mounted guard so an older response cannot replace a newer one
- the last successful value when a refresh fails

Algorithm:

```text
invalidation arrives
  -> mark stale
  -> debounce 100 ms
  -> if idle, fetch
  -> if already fetching, set dirtyWhileLoading
  -> on completion, run once more if dirtyWhileLoading
```

Initial loading and background refreshing are separate states. A transient refresh failure must not blank an already-rendering overlay; retain the last good resource and try again through reconnection/fallback.

Recommended hook mapping:

| Hook | Domain subscriptions | Filter |
| --- | --- | --- |
| `useSettings` | `settings` | none |
| `useThemes` | `themes` | none |
| `useTheme(id)` | `themes` | event has no IDs or includes `id` |
| `useAssets` | `assets` | none |
| `useTeams` | `teams` | none |
| `useRuntimeInfo` | none | Runtime identity comes from snapshots; retain REST for preferred LAN address. |

The provider owns only invalidation metadata, not a new normalized cache. Keeping the current hook-owned data model limits migration risk. A query library can be considered later if resource count and mutation complexity grow.

During the staged rollout, resource-event subscription must be opt-in. Keep Theme Editor's `useTheme` subscription disabled until its server baseline and draft are separated in Phase 5; enable event-aware `useTheme` immediately for overlay routes. Likewise, do not enable automatic editor-resource refresh merely by landing the Phase 3 hook refactor.

### 8.4 Overlay rewrite

Replace `OverlayPage`'s custom timers with resource hooks:

```ts
const settings = useSettings();
const selectedThemeId = mode === "preview" ? id : settings.data?.publishedThemeId ?? undefined;
const theme = useTheme(selectedThemeId);
const assets = useAssets();
```

Behavior:

- `settings.changed` changes the selected published theme ID.
- `themes.changed` for the selected ID reloads the theme, including a saved theme that is already published.
- `theme.published` prompts an immediate settings refresh and advances the settings-domain revision.
- `assets.changed` reloads the asset registry.
- live data and operator text come from the shared event store.
- keep the last good theme rendered while a replacement fetch is pending; switch only after the new theme parses successfully.
- if the published theme becomes `null`, render an explicit “No published theme” state instead of indefinitely retaining an obsolete theme.

Remove:

- the three-second `getAssets` interval
- the five-second settings/theme load interval
- the duplicate initial asset refresh in `OverlayPage`

### 8.5 Uploaded image cache invalidation

Most uploads use unique URLs, but full-app import can replace bytes while preserving an asset URL. A successful assets refetch alone may therefore leave an `<img>` element using cached bytes.

Derive a client-only asset URL cache key from `instanceId` and the assets revision, for example:

```text
/uploads/asset-123.png?v=9ab2-4
```

Apply it when `useAssets` prepares display records; do not persist the query string in `assets.json` or export packages. This keeps normal browser caching while guaranteeing imported/replaced content is revalidated.

If SSE has not supplied a valid snapshot, use a per-tab asset load generation as the cache key and increment it on each disconnected fallback reconciliation. This preserves image correctness even in an environment that blocks `/api/events` completely.

### 8.6 Draft and external-change behavior

Resource events must distinguish “server snapshot changed” from “replace the editor draft.”

- Add `externallyChanged` state to Settings, Team Detail, and Theme Editor.
- Capture whether the editor was dirty before applying a refreshed server snapshot.
- If clean, update both baseline and draft.
- If dirty, update the baseline/stale marker only and retain the draft.
- Show a non-modal warning with explicit reload/discard and keep-editing actions.
- Clear the warning after a successful save or explicit reload.

For Theme Editor specifically, event-aware refresh should be handled by the page rather than blindly enabling `useTheme` auto-refresh, because `themeResource.data` is currently also the mutable draft and undo/redo history source. A small source/draft separation is required before subscribing that editor to matching `themes.changed` events.

### 8.7 Slow fallback and browser lifecycle

When `/api/events` has not reached `OPEN` within 10 seconds or has entered the disconnected state:

- every 60 seconds, invalidate all currently subscribed configuration domains
- on the browser `online` event, request immediate reconciliation
- when `document.visibilityState` changes to `visible`, request immediate reconciliation if the tab was hidden or disconnected
- keep EventSource reconnection active while fallback reconciliation runs
- fetch `/api/live` at the configured interval only after the previous request settles
- fetch `/api/operations/text-fields` every two seconds only after the previous request settles

Stop the fallback interval as soon as a valid snapshot arrives. Do not poll every three or five seconds; the fallback exists for correctness, not event-level latency.

### 8.8 Runtime-version reload

The provider compares `{appVersion, releaseTag}` from consecutive `system.snapshot` events.

- The first valid snapshot becomes the loaded baseline.
- A different identity after reconnect triggers `window.location.reload()` once.
- Use a `sessionStorage` key containing both version and release tag and a 60-second guard to prevent reload loops.
- An `instanceId` change with the same runtime identity causes resource resync, not a full reload.

The REST runtime watcher runs only while `/api/events` is disconnected, at a 60-second interval, and never overlaps requests. It remains as defense against environments that block SSE.

## 9. Failure handling

| Failure | Expected behavior |
| --- | --- |
| Event arrives before initiating mutation response | A coalesced GET sees the committed state; an extra GET is acceptable. |
| Duplicate events | Debounce and revision checks produce one refresh. |
| Event is missed | Reconnect snapshot detects revision change; slow fallback also reconciles. |
| Browser sleeps | Visibility recovery plus EventSource reconnect refreshes active resources. |
| LAN drops | Last good UI state remains; fallback attempts continue; valid snapshot reconciles on recovery. |
| Server restarts on same version | New `instanceId` causes all active resources to refresh. |
| Managed update changes version | New runtime identity reloads the page exactly once. |
| Malformed/unknown event | Ignore it, record a rate-limited diagnostic, and rely on reconciliation. |
| Slow SSE client | Server drops only that stream; browser reconnects and gets a snapshot. |
| Resource refresh fails | Preserve last good data, expose stale/error state, and retry later. |
| Published theme is deleted | Settings and theme invalidations move the overlay to the fallback published theme. |
| Full import replaces an image at the same URL | Assets revision changes the display-only cache-busting query. |

## 10. Security and privacy

- Use the existing server origin and access boundary; do not expose a second port.
- Send only opaque IDs and revision metadata. Do not include upstream URLs, settings values, theme bodies, asset names, file paths, update details, or operator text.
- Keep `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` to discourage caching and proxy buffering.
- Cap total connections and evict backpressured clients.
- Do not log event payloads. Structured logs may include event type, sequence, revision, subscriber count, and disconnect reason.
- When temporary remote access is implemented, `/api/events` passes through the same authenticated tunnel and origin protections as other APIs.

## 11. Observability

Add lightweight structured logs or counters for:

- current and peak connected event clients
- connections, clean closes, error closes, and capacity rejections
- events published by type
- backpressure evictions
- client reconnect snapshots (server-side connection count only; no browser fingerprinting)

In the client, expose connection state through the provider for development diagnostics. Do not add a persistent operator warning for a brief reconnect. If disconnected for more than 30 seconds, admin pages may show a subtle “Live refresh reconnecting; slow refresh active” status. The transparent production overlay must not render diagnostic UI into the broadcast canvas.

## 12. Planned file changes

| File | Change |
| --- | --- |
| `src/shared/appEvents.ts` | Event names, resource domains, Zod payload schemas, and shared types. |
| `src/shared/appEvents.test.ts` | Contract parsing, invalid types, ID limits, and protocol-version tests. |
| `src/server/appEventHub.ts` | Instance/revision state, subscribers, frame formatting, heartbeat, capacity, and shutdown. |
| `src/server/appEventHub.test.ts` | Ordering, revisions, multiple clients, backpressure removal, heartbeat, and close tests. |
| `src/server/appEventRoutes.ts` | Testable Fastify registration for `/api/events`. |
| `src/server/appEventRoutes.test.ts` | Headers, initial snapshot, disconnect cleanup, and capacity response. |
| `src/server/index.ts` | Register the route, publish after successful mutations, and integrate graceful shutdown. |
| `src/client/appEvents.tsx` | Provider, EventSource lifecycle, revision reconciliation, fallback, visibility/online recovery, and runtime reload guard. |
| `src/client/resourceRefresh.ts` | Pure coalescing/in-flight refresh coordinator for unit testing. |
| `src/client/resourceRefresh.test.ts` | Burst, in-flight invalidation, stale response, and failure-preservation tests. |
| `src/client/hooks.ts` | Event-aware resource hooks and disconnected runtime fallback. |
| `src/client/main.tsx` | Mount `AppEventProvider` above all routes. |
| `src/client/pages/OverlayPage.tsx` | Replace asset/theme timers with event-aware hooks. |
| Settings, Team Detail, Theme Editor pages | Preserve drafts and expose external-change state. |
| `docs/api-reference.md` | Document `/api/events` and event payloads. |
| `docs/project-context.md` | Document event-driven configuration refresh and remaining SSE streams. |

No new production dependency is required; browser `EventSource`, Fastify's raw response, React context, and Zod are already available.

## 13. Delivery phases

### Phase 1 — Contract and server hub

- Add shared event schemas.
- Implement the in-process hub, sequence/revision state, heartbeat, capacity, and backpressure eviction.
- Register `/api/events` and integrate graceful shutdown.
- Add contract, hub, and route tests.

Gate:

- two simultaneous clients receive a valid initial snapshot and the same published event
- disconnect removes subscriptions and timers
- one backpressured client does not affect another client or a mutation
- `pnpm test` and `pnpm build` pass

### Phase 2 — Mutation coverage

- Add publication calls according to the mutation matrix.
- Consolidate compound import/logo events at the route boundary.
- Verify no event is sent after validation or persistence failure.
- Update API documentation.

Gate:

- every mutating route has an explicit event/no-event decision
- app and team imports invalidate every affected resource exactly after completion
- live and operator-text behavior remains unchanged

### Phase 3 — Shared client connection and resource coordinator

- Mount `AppEventProvider` once per tab.
- Add schema validation, revision reconciliation, reconnect behavior, slow fallback, and lifecycle recovery.
- Refactor resource hooks to use the tested coordinator.
- Keep all current overlay timers and runtime polling temporarily for comparison.

Gate:

- duplicate bursts cause one refetch per resource
- a reconnect after missed events refreshes the affected resources
- an in-flight invalidation causes exactly one follow-up fetch
- malformed events do not corrupt client state

### Phase 4 — Overlay cutover

- Rewrite published/preview theme selection around `useSettings` and `useTheme`.
- Enable asset revision cache busting.
- Remove the three-second asset and five-second theme timers.
- Move runtime REST checks to the disconnected 60-second fallback.
- Migrate live and operator hooks to the shared store and remove their legacy SSE routes.
- Relay the parent stream to the embedded Operator Overview overlay.

Gate:

- a theme save, publish, asset upload, team-logo upload, and full import all appear in an already-open overlay within one second on LAN
- disconnecting `/api/events` activates the 60-second fallback without blanking the overlay
- live score and operator text latency do not regress

### Phase 5 — Admin draft safety

- Enable automatic collection refresh across admin pages.
- Add external-change handling to settings and team detail.
- Separate Theme Editor's server baseline from its draft before enabling selected-theme invalidations.
- Verify local mutation responses plus self-received events do not reset forms or history.

Gate:

- clean editors adopt external updates
- dirty editors retain their draft and visibly report the server-side change
- save/discard/reload clears the warning predictably

### Phase 6 — Runtime watcher cutover and qualification

- Verify update restart, rollback, same-version restart, browser sleep, and LAN interruption.
- Move REST runtime polling to the disconnected 60-second fallback.
- Record request-volume before/after measurements.
- Update the roadmap status only after Windows portable qualification.

## 14. Automated test matrix

### Shared contract

- valid snapshot and each changed-event type parse
- unsupported protocol, invalid revision, mismatched type, and oversized ID list fail
- event frame does not accept arbitrary resource payload properties

### Server hub

- sequence is strictly increasing within an instance
- only the affected domain revision increments
- two listeners receive events independently
- unsubscribe is idempotent
- thrown, closed, or backpressured listener is removed
- heartbeat runs at the expected interval and stops on close
- subscriber capacity is enforced before route hijack

### Server route and mutation integration

- correct SSE headers and immediate snapshot
- heartbeat/comment framing remains valid
- closing the HTTP client cleans up the hub and `openStreams`
- successful settings/theme/asset/team mutations emit their mapped event
- schema failure, missing entity, failed upload, and rejected built-in deletion emit nothing
- compound import emits all affected domains only after completion
- graceful shutdown ends streams with a retry hint

### Client coordinator

- ten same-domain events inside 100 ms produce one request
- event during an in-flight request produces one follow-up request
- older request results cannot replace newer data
- failed refresh preserves last good data and marks it stale
- resource-ID filtering refreshes only the matching theme
- unmount cancels scheduled work and state publication

### Client reconnect and runtime

- revision gap invalidates once
- equal/older revisions are ignored
- new instance with same version resyncs without reload
- new version/release tag reloads once
- session guard prevents a reload loop
- `online` and visible transitions reconcile after interruption
- fallback starts while disconnected and stops after a valid snapshot

### Editor behavior

- external update replaces a clean draft
- external update preserves a dirty draft and raises a warning
- explicit reload replaces the dirty draft only after confirmation
- successful save clears stale/external-change state

## 15. Manual and Windows qualification

Test with at least two Chromium browser tabs and a vMix/OBS-style browser source:

1. Open Operations, Settings, Themes, Teams, and `/overlay/live` in separate clients.
2. Save the currently published theme and confirm the open overlay changes promptly.
3. Publish a different theme and confirm settings, theme lists, operator text, and overlay converge.
4. Upload a regular asset and a team logo; confirm open asset pickers and the overlay update.
5. Import a complete app backup that reuses asset URLs; confirm images show imported bytes rather than cached bytes.
6. Pause and resume live polling from another tab; confirm settings/operations state converges.
7. Put the overlay tab to sleep, perform multiple changes, then wake it; confirm one reconciliation reaches final state.
8. Block `/api/events` while leaving REST available; confirm the last good overlay remains and slow fallback converges.
9. Restart the same application version; confirm resource resync without a page-reload loop.
10. Install an update and exercise rollback; confirm the browser reloads once for each actual runtime identity transition.
11. Leave the browser source open for at least four hours and verify stable connection/subscriber counts and no increasing memory trend.

## 16. Acceptance criteria

The feature is complete when:

- one shared `/api/events` connection exists per top-level browser tab and the Operator Overview iframe opens none
- all mutation routes in the matrix publish only after successful completion
- configuration events contain no resource bodies or sensitive settings values
- an open overlay reflects settings, published-theme, theme-save, asset, team-logo, and import changes within one second on a healthy LAN
- overlay asset/theme polling at three/five seconds has been removed
- configuration/runtime fallback runs no faster than once per minute; live/operator fallbacks are serialized and never overlap
- reconnect, browser wake, same-version restart, update, and rollback all converge without manual refresh
- managed update runtime changes reload exactly once
- dirty Settings, Team Detail, and Theme Editor drafts are never silently overwritten
- slow clients are bounded and cannot delay other clients or API mutations
- live-scoreboard and operator-text behavior is preserved through the multiplexed stream
- `pnpm test`, `pnpm build`, `pnpm check:overlay-scope`, and the Windows qualification matrix pass

## 17. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A mutation path omits its event | Keep the route matrix next to tests; reconnect/fallback still repairs stale state. |
| Event burst creates GET storms | Domain revisions, 100 ms debounce, and single-flight refresh coordinator. |
| Self-originated events cause redundant GETs | Accept one coalesced GET in v1; avoid client IDs and custom mutation headers until measurements justify them. |
| Unsaved work is overwritten | Page-level baseline/draft separation and explicit external-change state. |
| Proxy buffers or kills SSE | No-transform/no-buffer headers, heartbeats, native reconnect, and slow REST fallback. |
| Server restart resets revisions | New random `instanceId` forces resync. |
| Image URL remains cached after import | Client-only cache key from instance and asset revision. |
| Slow browser consumes server buffers | Disconnect on backpressure; reconnect snapshot restores correctness. |
| Multiplexing regresses live/operator latency | Send their validated state directly on `/api/events`; do not convert them into REST invalidations. |
| Embedded preview opens another connection | Use a same-origin `MessageChannel` relay and fall back to EventSource only when no parent acknowledges. |

## 18. Recommended implementation order

Implement the shared contract and tested server hub first, then complete the mutation matrix before changing client polling. Add the provider and refresh coordinator with old timers still running, observe both paths, and only then cut the overlay over to events. Finish with editor draft safety and runtime-watcher relaxation.

This order creates a reversible rollout: until the overlay timers are removed, event delivery can be tested without becoming the only freshness mechanism.
