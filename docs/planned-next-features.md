# Planned Next Features

Status: proposed roadmap  
Last reviewed: 2026-08-17

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
| 1 | Automatic updates from GitHub Releases | Very high | Medium | Detailed technical plan ready |
| 2 | Automatic local and cloud backups | Very high | Medium | Proposed |
| 3 | Authentication and remote-access security | Required foundation | High | Proposed |
| 4 | Remote configuration tunnel | High | High | Proposed |
| 5 | Additional backup and tunnel providers | Medium | Medium | Proposed |

Automatic local backup is a dependency of safe update installation. Feature 1 therefore includes a narrowly scoped pre-update safety snapshot, while the complete scheduled-backup product remains Feature 2.

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

See [automatic-updates-technical-plan.md](./automatic-updates-technical-plan.md) for the complete implementation plan.

## Feature 2: automatic local and cloud backups

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

## Feature 3: authentication and remote-access security

### Outcome

The application has a security boundary suitable for remote access instead of relying on possession of a LAN or tunnel URL.

### Required foundation

- Authentication enabled before any public tunnel can start.
- Separate operator and administrator permissions.
- Administrator-only settings, imports, backups, updates, tunnel configuration, and user management.
- Secure, HTTP-only session cookies.
- CSRF and Origin validation for state-changing requests.
- Restrictive CORS configuration.
- Login and sensitive-action rate limits.
- Expiring and revocable remote sessions.
- Audit history recording actor, action, target, time, and outcome.
- Optimistic concurrency or revision checks for remotely edited settings and themes.
- Clear UI indicator whenever remote access is active.

The update install and rollback endpoints must remain loopback-only until this authentication and authorization work is complete.

## Feature 4: remote configuration tunnel

### Outcome

The onsite operator can deliberately open a temporary, authenticated route that allows approved remote staff to use the same admin UI against the onsite application.

Remote staff edit the onsite state directly. There is no separate cloud copy to merge, and loss of internet disables only the remote session—not local control or the overlay.

### Preferred integration

Use a named Cloudflare Tunnel protected by Cloudflare Access as the primary browser-only integration.

Reasons:

- remote staff can use a normal browser without installing a VPN client
- access can be limited to approved identities or email one-time PINs
- the tunnel is outbound from the event machine and requires no inbound router configuration
- a named tunnel is appropriate for a persistent, authenticated application route

This option requires a Cloudflare account, an active domain, and a configured tunnel token. Secrets must be stored outside normal exported settings.

Cloudflare Quick Tunnels should not be the production default because they are intended for testing and do not support Server-Sent Events, which this application uses for live state and operator text.

### Alternative integrations

- **Tailscale Serve:** a strong private-network choice for a small trusted team when every participating device can install Tailscale. Plan eligibility must be checked for commercial event use.
- **ngrok:** useful for development or a prototype, but its free-tier request, transfer, identity, and interstitial constraints make it a poor default for event production.

### Operator workflow

1. An administrator configures the provider once.
2. The onsite operator selects **Start remote session**.
3. The app verifies authentication, tunnel configuration, and internet reachability.
4. The app starts and supervises the tunnel process.
5. The UI shows the remote URL, allowed identities, start time, expiry, and connection health.
6. The onsite operator can copy the URL or revoke the session immediately.
7. The tunnel stops automatically at expiry or application shutdown, according to policy.

### Safety requirements

- Remote access defaults to off.
- A tunnel cannot start without authentication and an allow policy.
- Tunnel credentials are redacted from logs and excluded from backups.
- Public routes must not bypass the application security boundary.
- Local overlay URLs continue to use the onsite address.
- Tunnel failure must never stop local polling, control, or overlay rendering.

## Suggested delivery sequence

1. Implement the release manifest and packaged build metadata needed by managed updates.
2. Install a stable root launcher and updater coordinator.
3. Implement update checking, verified download, installation, health checking, and rollback.
4. Add the pre-update local data snapshot used by Feature 1.
5. Generalize that snapshot into backup v2 with scheduled local destinations.
6. Add an S3-compatible backup destination.
7. Add application authentication, authorization, audit history, and edit revisions.
8. Add the Cloudflare named-tunnel integration.
9. Add Google Drive and optional Tailscale integrations based on operator demand.

## Product principles for this roadmap

- Local operation always wins over cloud convenience.
- No silent restart or update during live production.
- Every destructive operation gets validation, a recovery path, and a visible result.
- Remote access is temporary, explicit, authenticated, and auditable.
- Provider integrations are replaceable adapters rather than core application dependencies.
- Backward compatibility is required for existing portable data and export packages.
