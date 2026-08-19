# Planned Next Features

Status: active roadmap
Last reviewed: 2026-08-19

## Why these features are next

The main scoreboard, theme, team-resolution, operator-control, backup/import, and Windows portable workflows are now mature enough that the next work should focus on operational reliability.

The next feature group should make the application:

- easier to update without manual file replacement
- recoverable after machine failure or operator error
- safely configurable by trusted staff away from the onsite machine
- resilient when event internet access is unavailable

The onsite application remains the source of truth. Cloud services may add convenience, but the local overlay and operator controls must continue to work when internet access is lost.

## Priority order

| Priority | Feature | Value | Complexity | Current status |
| --- | --- | --- | --- | --- |
| 1 | Automatic updates from GitHub Releases | Very high | Medium | Implemented; Windows qualification pending |
| 2 | Event-driven UI refresh | High | Medium | Implemented; Windows qualification pending |
| 3 | Automatic local and cloud backups | Very high | Medium | Proposed |
| 4 | Temporary ngrok remote access | High | Medium | Planned; technical design complete |
| 5 | Additional backup and remote-access providers | Medium | Medium | Proposed |

Automatic local backup is a dependency of safe update installation. Feature 1 therefore includes a narrowly scoped pre-update safety snapshot, while the complete scheduled-backup product remains Feature 3.

## Feature 1: automatic updates from GitHub Releases

### Outcome

An onsite operator can discover, download, install, and roll back a stable Windows portable release without manually moving or replacing application files.

### Core behavior

- Check the official GitHub repository for stable releases at startup, on a schedule, and on demand.
- Display the installed version and any available version in Settings.
- Download an update without interrupting the running scoreboard.
- Validate release identity, platform, archive size, and SHA-256 digest.
- Require an explicit onsite confirmation before installation.
- Stop the server, take a pre-update local data snapshot, switch versions, and restart on the same port.
- Verify the restarted application through a health endpoint.
- Roll back the application pointer and data snapshot automatically if health verification fails.
- Keep the previous application version and recent safety snapshots for manual recovery.
- Never install silently during an event.

### Scope boundary

The first version targets the packaged Windows x64 portable release only. Development checkouts, macOS helpers, and generic Node installations report that managed updates are unsupported.

See [automatic-updates-technical-plan.md](./automatic-updates-technical-plan.md) for the implemented protocol and remaining Windows qualification matrix.

## Feature 2: event-driven UI refresh

### Outcome

The admin UI and browser overlay refresh changed settings, published themes, and assets shortly after a successful mutation without repeatedly polling each resource every few seconds.

The application remains correct across browser sleep, network loss, proxy interruptions, and application restarts. Configuration events are notifications and existing resource APIs remain authoritative; latency-sensitive live and operator state is delivered directly.

### Implemented architecture

Use one multiplexed Server-Sent Events endpoint for configuration invalidations, live scoreboard state, and operator-text state:

```text
GET /api/events
```

The server owns a small in-process event hub that:

- tracks connected browser clients
- broadcasts typed events after successful persistence
- assigns monotonically increasing event IDs
- sends heartbeats to keep connections alive
- removes disconnected clients without blocking other clients

Initial event types:

- `system.snapshot`
- `settings.changed`
- `themes.changed`
- `theme.published`
- `assets.changed`
- `teams.changed`
- `live.state`
- `operator-text.state`

`system.snapshot` carries the process instance, resource revision vector, runtime build identity, normalized live state, and operator-text state when a client connects. It covers restart recovery and runtime-version detection; the old process cannot truthfully emit the new runtime identity before an update restart.

Configuration events identify the changed resource or revision without placing settings, themes, assets, or teams on the stream. The two latency-sensitive state events carry their validated payloads directly and replace the former dedicated SSE endpoints.

### Client behavior

Clients should:

1. Fetch initial settings, theme, assets, and runtime metadata normally.
2. Open one shared `/api/events` connection; same-origin embedded overlays use the parent tab's relay.
3. Refetch only the resource affected by each event.
4. Coalesce bursts of duplicate events into one refresh.
5. Reconnect automatically after disconnects.
6. Reconcile against the `system.snapshot` event after reconnect so missed events do not cause stale UI.

The overlay should stop using fast settings, theme, and asset timers once the event path is reliable. A slow fallback refresh remains for environments that cannot maintain SSE connections.

### Runtime and automatic-update interaction

Application updates restart the server and terminate existing browser connections. The overlay should reconnect to `/api/events`, compare the new `system.snapshot` runtime identity, and reload once if the application version or release tag changed.

The runtime-version safety check now runs only as a serialized 60-second fallback while the event connection is unavailable.

### Reliability and security requirements

- Event delivery is best-effort; API snapshots remain authoritative.
- Reconnects must recover without requiring a full manual page refresh.
- Event IDs and `Last-Event-ID` may support short replay buffers, but correctness must not depend on replay.
- Events must be emitted only after a successful write.
- The event endpoint must follow existing local/LAN access rules.
- Event payloads must not expose secrets or private settings values.
- Slow or broken clients must not block server mutations or other subscribers.

### Delivery phases

1. Implement the server event hub and multiplexed SSE endpoint.
2. Emit configuration invalidations and bridge live/operator state into the hub.
3. Add a shared client store with reconnect and refresh coalescing.
4. Replace overlay fast polling and legacy streams while retaining serialized fallbacks.
5. Relay events from Operator Overview to its same-origin iframe.
6. Qualify request volume, connection stability, missed-event recovery, and browser overlay freshness.

### Testing scope

- event delivery to multiple clients
- disconnect cleanup and heartbeat behavior
- event emission only after successful writes
- reconnect and snapshot recovery
- duplicate-event coalescing
- runtime-change reload exactly once
- fallback behavior when SSE is unavailable
- no regression to live scoreboard delivery or managed update restart/rollback

See [event-driven-ui-refresh-technical-plan.md](./event-driven-ui-refresh-technical-plan.md) for the detailed event contract, mutation coverage, client refresh coordinator, draft-safety behavior, rollout phases, and qualification matrix.

## Feature 3: automatic local and cloud backups

### Outcome

Operators can schedule verified backups and restore the application after machine loss, disk failure, a bad import, or accidental configuration changes.

### Backup contents

The backup v2 format should include:

- application settings
- themes
- teams
- asset metadata
- uploaded asset contents
- operations state, including team-resolution and operator-text overrides
- backup format version
- originating application version
- creation timestamp
- per-entry integrity checksums

Runtime logs should be exported as a separate optional support bundle. Program binaries do not belong in a data backup because they are recovered from a signed or verified release.

Cloud-provider credentials must never be included in a portable backup.

### Destination order

1. Local folder or removable USB storage.
2. S3-compatible storage such as AWS S3, Cloudflare R2, or MinIO.
3. Google Drive.

All destinations should implement one provider interface so scheduling, retention, verification, status reporting, and restore behavior stay consistent.

### Required behavior

- Manual **Back up now** action.
- Scheduled backups.
- Automatic backup before updates and destructive imports.
- Configurable retention with safe defaults.
- Last-success, last-failure, duration, size, and destination status.
- Write to a temporary object or file and finalize only after validation.
- Restore preview that reports backup version, contents, and compatibility.
- Restore into staging and commit atomically.
- Test-restore validation without replacing live data.
- Windows-protected storage for destination credentials where available.

### Existing foundation and gaps

The current full-app JSON export already includes settings, themes, teams, asset metadata, and uploaded asset contents. It does not include operations state, and the current restore removes old asset files before the replacement has fully completed. Backup v2 should be backward-compatible with v1 imports and make restoration transactional.

## Feature 4: temporary ngrok remote access

### Outcome

An onsite operator can deliberately open a temporary HTTPS route that lets trusted offsite staff use the same admin UI against the onsite application.

Remote staff edit onsite state directly. There is no cloud copy to merge, and loss of internet or the tunnel disables only remote access. Local operation and the overlay continue normally.

### Trust and scope decision

The initial version is intentionally designed for a small, trusted team:

- no application user accounts or user-management UI
- no operator/administrator role split
- no application login page or session-cookie system
- one shared, randomly generated Basic Auth credential per remote session
- the same event-configuration and live-operation capabilities available onsite
- no per-person attribution; lifecycle logs identify a shared remote session only

The accepted operational trade-offs are that the credential can be shared, one person cannot be revoked independently, and simultaneous edits remain last-write-wins. Stopping the session or starting a new one revokes the credential for everyone.

### Provider and integration

Use the official `@ngrok/ngrok` JavaScript SDK to create an HTTPS Agent Endpoint from the application process. This avoids a separately installed or supervised command-line process and ties tunnel lifetime to the scoreboard process.

The onsite operator configures an ngrok authtoken once. The token authenticates the scoreboard application to the team's ngrok account; it is not shared with offsite staff. In the packaged Windows application, store it outside exported application data and protect it with current-user Windows DPAPI.

Each remote session uses ngrok Traffic Policy to:

- require one generated Basic Auth username and password
- add an unguessable server-recognized marker to authenticated upstream requests

The application uses that marker to distinguish remote tunnel traffic from real loopback traffic. This is required because the ngrok SDK connects to the local server from loopback, while update mutations currently use loopback origin as a safety boundary. The earliest Fastify request hook rejects malformed or duplicated markers and removes the forwarded `Authorization` header before route hooks, handlers, or normal request logging. Keeping header removal in the application lets the ngrok policy use only currently free actions.

### Operator workflow

1. Once per onsite machine, open **Settings → Remote access**, paste the ngrok authtoken, and select **Save and test**.
2. Select **Start remote access**, choose a duration, and confirm that the credential grants full event-configuration access.
3. The application generates a session username, strong password, expiry, and ngrok HTTPS endpoint.
4. The application performs an authenticated public self-probe before reporting the session active.
5. The UI shows the URL and temporary credential with copy controls, plus start time, expiry, and connection health.
6. Offsite staff opens the URL, clicks ngrok's free-plan **Visit Site** interstitial when shown, completes the Basic Auth prompt, and uses the normal admin UI.
7. Onsite staff selects **Stop remote access**, or the application stops it automatically at expiry or shutdown.
8. A new session always receives a new credential and does not resume automatically after restart.

### Access boundary

Authenticated remote staff may use operations, settings, teams, themes, publishing, assets, imports, exports, and future backup controls.

Two machine-lifecycle areas remain onsite-loopback-only rather than becoming permission roles:

- configuring, starting, and stopping remote access
- software update checks, downloads, installation, result dismissal, skipping, and rollback

### Safety requirements

- Remote access defaults to off.
- Only one remote session may be active at a time.
- A session cannot become active until Basic Auth, request marking, header stripping, and upstream reachability pass a self-probe.
- Unsafe remote requests require an exact same-origin `Origin`; the application no longer reflects arbitrary CORS origins.
- Tunnel-management and update mutations are blocked both at the ngrok policy and application layers.
- The ngrok authtoken is encrypted at rest on packaged Windows and excluded from exports, backups, and logs.
- Temporary usernames, passwords, marker secrets, and Traffic Policy contents remain in memory only and are never logged.
- A visible application-wide indicator remains present while remote access is active.
- Sessions have a short default expiry, a hard maximum duration, and immediate onsite revocation.
- Local overlay URLs continue to use the onsite address.
- Tunnel failure must never stop local polling, control, or overlay rendering.
- Application shutdown and managed-update restart close the endpoint; startup never restores it automatically.

### ngrok free-plan expectations

The free plan is acceptable for occasional support sessions. Operators should expect one account-assigned development domain rather than a new random hostname, ngrok's **Visit Site** browser interstitial, a 20,000 HTTP-request monthly allowance, and 1 GB of outgoing transfer per month. The endpoint still exists only while enabled and its Basic Auth credential rotates for every session. The multiplexed event stream removes the former five-second runtime request load; disconnected clients still use conservative serialized REST fallbacks.

See [remote-access-technical-plan.md](./remote-access-technical-plan.md) for the implementation protocol, API, secret storage, request boundary, failure handling, and qualification matrix.

## Feature 5: additional backup and remote-access providers

After the first backup and ngrok integrations are proven, add providers only in response to operational demand:

- Google Drive as another backup destination
- Tailscale Serve as a private-network remote-access option
- Cloudflare Tunnel when identity-based access or a managed domain is required

Keep provider-specific credentials and lifecycle behavior behind narrow service boundaries. Do not build a general provider framework before the second implementation requires one.

## Suggested delivery sequence

1. Implement the release manifest and packaged build metadata needed by managed updates.
2. Install a stable root launcher and updater coordinator.
3. Implement update checking, verified download, installation, health checking, and rollback.
4. Add the event hub and event-driven UI refresh path.
5. Add the pre-update local data snapshot used by Feature 1.
6. Generalize that snapshot into backup v2 with scheduled local destinations.
7. Add an S3-compatible backup destination.
8. Add the temporary ngrok remote-access session, hardened remote request boundary, and Windows-protected authtoken storage.
9. Qualify Basic Auth, SSE, expiry, revocation, shutdown, and Windows portable packaging against a real ngrok account.
10. Add Google Drive, Tailscale, or Cloudflare integrations based on operator demand.

## Product principles for this roadmap

- Local operation always wins over cloud convenience.
- No silent restart or update during live production.
- Every destructive operation gets validation, a recovery path, and a visible result.
- Remote access is temporary, explicit, authenticated, visibly active, and recorded at the shared-session lifecycle level.
- Provider integrations are replaceable adapters rather than core application dependencies.
- Backward compatibility is required for existing portable data and export packages.
