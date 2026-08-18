# Temporary ngrok Remote Access Technical Plan

Status: implementation-ready design; not yet implemented

Last reviewed: 2026-08-18

Target: Windows x64 portable application, with injectable development and test adapters

## 1. Decision summary

Add one deliberately temporary remote-access session backed by the official `@ngrok/ngrok` JavaScript SDK.

The onsite operator configures one ngrok account authtoken, then starts a session from the local Settings page. The application generates one shared Basic Auth username and password, starts an HTTPS ngrok Agent Endpoint, validates the public route, and displays the temporary access details. Trusted offsite staff use the normal admin UI and may perform the same event-configuration and live-operation work as onsite staff.

The first version does not add application users, roles, a login page, session cookies, or per-person auditing. The shared credential represents one remote session, not an individual person.

Remote-access configuration and lifecycle controls remain onsite-loopback-only. Managed-update mutations also remain onsite-loopback-only because they stop or replace the application process. These are machine-lifecycle boundaries, not user permission levels.

The official SDK supports in-process endpoint creation, Traffic Policy, public URL discovery, and explicit listener closure. ngrok Basic Auth rejects unauthenticated requests at the edge before they reach the application:

- [ngrok JavaScript SDK](https://ngrok.github.io/ngrok-javascript/)
- [ngrok Basic Auth Traffic Policy action](https://ngrok.com/docs/traffic-policy/actions/basic-auth)
- [ngrok add-headers Traffic Policy action](https://ngrok.com/docs/traffic-policy/actions/add-headers)
- [ngrok free-plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits)

## 2. Goals

- Let trusted offsite staff open the existing admin UI in a normal browser.
- Keep the onsite application as the only source of truth.
- Require an explicit onsite action before any public endpoint exists.
- Use a fresh, strong Basic Auth credential for every session.
- Allow all normal event configuration and live operations remotely.
- Revoke access immediately in the application and close the ngrok endpoint on stop or expiry.
- Never resume a remote session automatically after application restart.
- Preserve local admin, polling, SSE, and overlay behavior if ngrok or the internet fails.
- Store the long-lived ngrok authtoken separately from portable data and protect it on Windows.
- Keep all temporary credentials, request markers, and generated Traffic Policy contents in memory only.
- Keep the existing updater safety boundary effective even though ngrok forwards from loopback.
- Provide clear operator status, failure messages, and a visible active-session warning.

## 3. Non-goals

- Application user accounts or invitations.
- Operator and administrator roles.
- Per-person permissions or attribution.
- A custom login page.
- Session cookies, password reset, MFA, OAuth, or OIDC.
- Revoking one remote person while retaining another.
- Conflict-free simultaneous editing or automatic merge.
- Automatically starting remote access at boot.
- Keeping remote access alive during an application update or restart.
- Exposing RDP, SMB, SSH, PBResults itself, or any service other than this HTTP application.
- Making an accidentally router-forwarded application port safe for public use. Only the built-in ngrok path is protected by this feature.
- A general multi-provider abstraction in the first implementation.
- Hiding ngrok's free-plan browser interstitial.

## 4. Trust model and accepted trade-offs

The intended users are a small team whose members are already trusted to change event configuration.

The generated username and password may be used by more than one offsite person. The application records the start, stop, expiry, and failure of the shared session, but it cannot truthfully identify which person made an individual change.

The accepted trade-offs are:

- anyone holding the current credential has full event-configuration access
- the credential can be forwarded to another person during the session
- stopping or rotating the session revokes everyone at once
- multiple browsers can edit concurrently
- existing last-write-wins behavior remains in place

The global active-session indicator is the operational coordination mechanism for the first version. Edit revisions and conflict detection can be added independently if real concurrent-edit problems justify them.

## 5. Current-state findings

### 5.1 The server is LAN-accessible and mostly unauthenticated

The Fastify server listens on `0.0.0.0`, and the admin UI, overlay, uploads, and normal APIs share one origin. That remains the local/LAN operating model.

### 5.2 Update mutations rely on socket loopback

Update mutations currently accept a request when `request.ip` is loopback. An ngrok agent or SDK also connects to the upstream service over loopback, so tunnelling directly to the existing port without additional classification could make a remote update request appear local.

The implementation must replace the updater's simple loopback test with a stricter onsite-management predicate and must explicitly reject recognized tunnel traffic.

### 5.3 CORS currently reflects arbitrary origins

The server currently registers CORS with `origin: true`. The browser client uses relative, same-origin requests and has no documented need for arbitrary cross-origin browser access.

Remote access must remove arbitrary origin reflection and add Origin validation for state-changing tunnel requests.

### 5.4 The application already uses long-lived HTTP streams

The live scoreboard and operator-text paths use Server-Sent Events. The remote-access qualification matrix must test both streams through ngrok and through the Basic Auth challenge. The tunnel must not buffer, truncate, or repeatedly reconnect healthy streams.

### 5.5 Portable updates preserve root runtime data

The packaged application keeps mutable runtime directories at the portable root while application versions are replaced independently. The ngrok authtoken envelope belongs in a root `secrets/` directory so it survives an application version switch but is not part of `data/`, exports, or backup payloads.

## 6. High-level architecture

```text
Offsite browser
    |
    | HTTPS + Basic Auth
    v
ngrok Agent Endpoint
    |  Traffic Policy:
    |  - block machine-lifecycle mutations
    |  - authenticate
    |  - add per-session upstream marker
    v
127.0.0.1:<scoreboard-port>
    |
    | Fastify request classification
    | + immediate Authorization removal
    | + Origin guard
    v
Existing admin UI, APIs, uploads, and SSE

Onsite localhost/LAN browser ---------------------> same Fastify server
Local overlay/vMix ------------------------------> same Fastify server
```

The tunnel is an additional route to the existing application. It does not create or synchronize a second copy of state.

The ngrok SDK runs inside the scoreboard server process. It opens an outbound control connection and forwards only to `127.0.0.1:<active-port>`. No router port forwarding or inbound firewall rule is required.

## 7. Proposed modules

Keep provider-specific behavior isolated without prematurely building a general plugin system.

### `src/shared/remoteAccess.ts`

- Zod request and response schemas
- public status types
- local-only credential response type
- phase, connection-state, and error-code enums
- constants for allowed session durations and confirmations

### `src/server/remoteAccessService.ts`

- state machine and serialization lock
- temporary credential and marker generation
- start, self-probe, stop, expiry, and shutdown lifecycle
- redacted public/local status projections
- event emission and lifecycle logging
- provider error normalization

### `src/server/ngrokRemoteAccessProvider.ts`

- lazy import of `@ngrok/ngrok`
- authtoken validation connection
- Traffic Policy construction
- `forward()` invocation and public URL validation
- listener status callback
- listener closure
- no general provider registry in v1

### `src/server/remoteAccessSecrets.ts`

- read, write, replace, and delete the encrypted authtoken envelope
- Windows DPAPI bridge
- environment-backed development mode
- injectable in-memory implementation for tests

### `src/server/remoteRequestSecurity.ts`

- request marker recognition
- constant-time marker comparison
- remote request context decoration
- strict onsite-loopback management predicate
- same-origin validation for unsafe methods
- fail-closed behavior for invalid or retired markers

### Client additions

- remote-access methods in `src/client/api.ts`
- a `useRemoteAccessStatus` hook
- a Remote access card in Settings
- start/stop and configuration dialogs
- an active-session banner in `AppShell`
- secret reveal/copy behavior limited to an onsite-loopback response

## 8. Dependency and packaging changes

Add `@ngrok/ngrok` as a production dependency. Use the SDK rather than spawning the standalone `ngrok` executable.

Reasons:

- endpoint lifetime is attached to the scoreboard process
- no separate install or PATH discovery is required
- credentials and Traffic Policy do not need to be written to a temporary CLI configuration file
- the SDK directly returns a listener and public URL
- the listener exposes an explicit close operation

The package supplies platform-specific native modules. The Windows packaging workflow already performs a production install on Windows and copies materialized `node_modules`, so it should select the Windows x64 package. Extend packaging validation to assert that:

- `@ngrok/ngrok/package.json` exists in the staged application
- the Windows x64 native package exists
- a packaged Node process can import the SDK without opening a tunnel
- the production lockfile contains the expected optional platform package

Do not let the SDK perform network work at normal server startup. Load or connect it only for authtoken testing or an explicit Start action.

The SDK documentation notes that Windows requires the Microsoft Visual C++ Redistributable. Add this to Windows qualification and surface a specific setup error when native module loading fails.

## 9. Long-lived authtoken storage

### 9.1 Storage location

Add runtime paths:

```text
<portable-root>/secrets/
  remote-access.json
```

This directory is outside `data/`, is not included in app exports, and is not copied into backup v2. It remains at the stable portable root across managed updates and rollbacks.

Do not add the authtoken to `AppSettings`, `settings.json`, build information, update transactions, or support bundles.

### 9.2 Windows protection

The packaged Windows implementation uses DPAPI with current-user scope. Normally only the same Windows user on the same machine can decrypt a current-user DPAPI blob. See [Microsoft's CryptProtectData documentation](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).

Persist an envelope rather than plaintext:

```json
{
  "version": 1,
  "provider": "ngrok",
  "protection": "windows-dpapi-current-user",
  "ciphertext": "<base64>",
  "updatedAt": "2026-08-18T12:00:00.000Z"
}
```

Use a non-interactive PowerShell DPAPI bridge because PowerShell is already a required component of the portable update workflow:

- invoke `powershell.exe` with a static encoded script
- send plaintext or ciphertext through stdin, never a command-line argument
- return only ciphertext during protection and plaintext during unprotection
- use `DataProtectionScope.CurrentUser`
- use fixed application-specific optional entropy
- impose a short timeout and output-size limit
- sanitize stderr before logging
- write the envelope atomically through a same-directory temporary file and rename

If the protected value cannot be decrypted after moving the portable directory to another computer or Windows account, report the integration as unconfigured and ask the onsite operator to paste the token again. Never fall back to treating ciphertext as plaintext.

### 9.3 Development and tests

- On non-Windows development hosts, support `NGROK_AUTHTOKEN` as a non-persistent override.
- When the environment override is active, the UI reports **Configured by environment** and cannot replace or delete it.
- Do not implement automatic plaintext persistence for macOS or Linux in v1.
- Unit tests use an injected in-memory secret store.

### 9.4 Configuration rules

- Configuration, replacement, testing, and deletion are onsite-loopback-only.
- The API never returns the token or its prefix.
- Replacing or deleting the token is forbidden while a session is starting, active, degraded, or stopping.
- **Save and test** first verifies connectivity with an ngrok control session that does not create a durable public endpoint, then commits the encrypted value.
- If validation fails, retain the previously working token unchanged.

## 10. Temporary session secrets

Generate all session material with `node:crypto`:

- session ID: `crypto.randomUUID()`
- username: `pbremote-` plus at least 48 bits of Base64URL randomness
- password: at least 144 bits of Base64URL randomness, normally 24 characters
- upstream marker: 256 bits of Base64URL randomness

Constraints:

- ASCII only
- no colon in the username because Basic Auth uses `username:password`
- no whitespace or ambiguous manual transcription requirement
- no reuse across sessions
- never persist any of these values
- never include them in error messages, logs, metadata, URLs, analytics, or event payloads

The password comfortably exceeds ngrok's eight-character minimum. Basic Auth is permitted only through the HTTPS endpoint returned by ngrok.

The UI must show the URL and credential as separate values. Never generate a URL such as `https://user:password@example`, because it can leak through history, messaging previews, logs, and browser behavior.

## 11. Traffic Policy

Build a JSON Traffic Policy in memory for each session and pass it directly to the SDK's `traffic_policy` option. Do not log the object.

The policy has two responsibilities.

### 11.1 Block machine-lifecycle mutations at the edge

Return `403` without forwarding for:

- unsafe methods under `/api/remote-access/`
- unsafe methods under `/api/update/`

`GET /api/remote-access/status` and `GET /api/update/status` may pass after authentication so the normal UI can render redacted status.

The application repeats these checks. The edge rule is defense in depth, not the authoritative authorization layer.

### 11.2 Authenticate and mark allowed traffic

The default request rule performs actions in this order:

1. Require the generated Basic Auth credential with enforcement enabled.
2. Add `x-pbresults-remote-session: <marker-secret>` for upstream classification.

Basic Auth and `add-headers` are currently free Traffic Policy actions. Do not use the metered `remove-headers` action merely to sanitize these requests. Instead, the earliest Fastify request hook classifies the marker and deletes `request.headers.authorization` before route hooks or handlers run. Pino redaction remains enabled as defense in depth.

ngrok may append the server marker when a client supplies the same header. Normal browser requests therefore contain exactly one marker value. Any empty, duplicated, comma-joined, malformed, or unexpected marker is rejected before route handling. A client-supplied marker can only make its own request fail closed; it cannot make tunnel traffic appear onsite.

Policy validation or installation failure aborts startup. The application must never retry with a less restrictive policy.

The first implementation should stay within the free plan's five-rule Traffic Policy allowance and use only free actions. Current action metering is documented in [ngrok's Traffic Policy Unit pricing](https://ngrok.com/docs/pricing-limits/traffic-policy-unit-pricing).

## 12. Application request classification

### 12.1 Recognized remote request

A request is recognized as remote only when:

- its socket peer is loopback
- the marker header exists exactly once
- an active or provisional session owns a marker
- the supplied marker matches with `crypto.timingSafeEqual`

Immediately after classification, delete the incoming `Authorization` header. No later hook, route handler, application log, or diagnostic object may receive the temporary Basic Auth credential. The public self-probe verifies this application-side sanitization.

Decorate the request with an internal remote context containing only:

```ts
type RemoteRequestContext = {
  kind: "ngrok";
  sessionId: string;
  publicOrigin: string;
};
```

Do not expose the marker through the decorated context.

### 12.2 Invalid or retired marker

If the marker header is empty, duplicated, malformed, retired, or does not match, reject the entire request with `403 REMOTE_SESSION_INVALID` before route handling.

This fail-closed behavior matters during stop failure: the endpoint may still exist briefly, but the application can stop accepting its marker before listener closure completes.

### 12.3 Strict onsite-loopback predicate

Replace `isLoopbackRequest()` for machine-lifecycle mutations with `isOnsiteManagementRequest()` requiring all of the following:

- socket peer is loopback
- no recognized or invalid tunnel marker is present
- Host is `localhost`, `127.0.0.1`, or `[::1]` on the active server port
- no `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, or `X-Forwarded-Proto` header is present
- Fastify proxy trust remains disabled

Use this predicate for:

- all remote-access configuration and lifecycle mutations
- every managed-update mutation, including check, download, install, skip, rollback, and result dismissal

Client-side hostname checks remain useful UI affordances but are never the security control.

### 12.4 Remote route boundary

Recognized remote requests may reach all existing UI, overlay, upload, SSE, read, and event-configuration routes except the machine-lifecycle mutations above.

This intentionally permits:

- settings changes
- polling start, stop, and refresh
- operations and operator text
- team resolution and team management
- theme creation, editing, publishing, import, and export
- asset upload
- app/team import and export
- future backup actions unless separately classified as process-lifecycle operations

## 13. Origin and CORS protection

Basic Auth is browser-ambient after a successful challenge, so it does not by itself prevent a malicious website from inducing a credentialed browser request.

### 13.1 CORS

Remove `origin: true`. Prefer no CORS headers because the supported browser client is same-origin. If a documented integration later requires CORS, add an explicit allowlist rather than reflection.

### 13.2 Unsafe-method Origin guard

Treat `POST`, `PUT`, `PATCH`, and `DELETE` as unsafe.

For a recognized remote request:

- require exactly one `Origin` header
- normalize it with `new URL(origin).origin`
- require an exact match with the ngrok public origin returned by the SDK
- reject missing, `null`, malformed, or mismatched origins with `403 REMOTE_ORIGIN_REQUIRED`

The supported remote surface is the browser UI, so rejecting non-browser remote mutation clients without Origin is acceptable.

For local/LAN unsafe requests:

- if Origin is present, require it to match the request's effective same origin
- if Origin is absent, preserve current non-browser API compatibility

Do not trust `X-Forwarded-Host` to construct an allowed origin. The remote expected origin comes from the validated listener URL held by `remoteAccessService`.

### 13.3 Response handling

- Add `Cache-Control: no-store` to remote API responses containing settings or remote-access status.
- Do not return the Basic Auth credential to a recognized remote request.
- Keep static asset caching behavior unchanged unless qualification finds credentialed cache leakage.

## 14. State machine

Use a serialized state machine so two browser actions cannot create multiple endpoints.

```ts
type RemoteAccessPhase =
  | "unconfigured"
  | "inactive"
  | "starting"
  | "active"
  | "degraded"
  | "stopping"
  | "failed";

type RemoteConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";
```

### Transitions

```text
unconfigured --save/test token--> inactive
inactive -----start-------------> starting
starting -----self-probe ok-----> active
starting -----error-------------> failed
active -------connection lost---> degraded
degraded -----reconnected-------> active
active/degraded --stop/expiry---> stopping
stopping -----listener closed---> inactive
stopping -----close error-------> failed (remote acceptance remains disabled)
failed -------successful stop---> inactive
inactive -----delete token------> unconfigured
```

Rules:

- Only one lifecycle operation may execute at a time.
- Start from any phase other than `inactive` returns `409 REMOTE_ACCESS_BUSY` or `409 REMOTE_ACCESS_ALREADY_ACTIVE`.
- Stop is idempotent from `inactive` and required from `failed` when a listener reference remains.
- A connection loss does not extend expiry.
- Startup always begins `unconfigured` or `inactive`; active state is never restored from disk.
- Status and errors are volatile. Only sanitized lifecycle events are appended to a log.

## 15. Session duration and expiry

Offer these initial durations:

- 30 minutes
- 1 hour
- 2 hours, default
- 4 hours
- 8 hours, hard maximum

The server validates the duration; the browser selection is not authoritative.

Record `startedAt` and `expiresAt` only after the public self-probe succeeds. Schedule expiry from the absolute timestamp so delays and connection degradation do not extend it.

At expiry:

1. Disable application acceptance for the session marker.
2. Emit a redacted status event.
3. Close the ngrok listener.
4. Clear the expiry timer and all temporary secrets.
5. Record `session.expired` in the lifecycle log.

## 16. Start protocol

`POST /api/remote-access/start` executes the following transaction:

1. Verify the strict onsite-loopback predicate.
2. Parse the duration and exact confirmation phrase.
3. Acquire the lifecycle mutex.
4. Require phase `inactive` and a decryptable authtoken.
5. Generate the session ID, username, password, and marker.
6. Build the Traffic Policy without logging it.
7. Enter `starting` with a provisional marker accepted only by the probe route.
8. Call `ngrok.forward()` with:
   - `addr: "127.0.0.1:<active-port>"`
   - the decrypted authtoken
   - HTTP endpoint type with HTTPS scheme only
   - generated Traffic Policy
   - sanitized application metadata containing no secrets
   - status-change callback
9. Read and validate `listener.url()`:
   - parseable absolute URL
   - `https:` scheme
   - origin only; no userinfo
10. Run the public self-probe.
11. If the probe succeeds, enter `active`, set expiry, and return local status with credentials.
12. If any step fails, disable the marker, close the listener if created, clear secrets, enter `failed`, and return a sanitized error.

Do not persist any partially started state. An application crash terminates the in-process endpoint connection and startup returns inactive.

## 17. Public self-probe

Before showing access details, request:

```text
GET <public-origin>/api/remote-access/probe
```

The probe client supplies:

- the generated Basic Auth header
- `ngrok-skip-browser-warning: 1` so a free-plan interstitial cannot masquerade as success
- a short timeout
- no redirect to a different origin

The probe route succeeds only while phase is `starting` and verifies:

- request classification matched the provisional marker
- socket peer is loopback
- the earliest request hook removed `Authorization` before the probe handler
- expected ngrok forwarding metadata is present
- no local-only route predicate would accept this request

Return `204` with no body.

If the probe receives HTML, a redirect outside the expected origin, `401`, `403`, a timeout, or a response that reached Fastify without the required classification, close the listener and fail startup.

## 18. Stop and shutdown protocol

### Manual stop

`POST /api/remote-access/stop`:

1. Verify strict onsite-loopback origin and confirmation.
2. Acquire the lifecycle mutex.
3. Immediately disable marker acceptance.
4. Enter `stopping` and clear the expiry timer.
5. Close the SDK listener with a bounded timeout.
6. Clear listener reference, URL, username, password, marker, and timestamps.
7. Enter `inactive` and emit a lifecycle event.

If listener closure fails, retain only the listener handle and retired-marker recognition needed to keep rejecting traffic. Enter `failed`, show a critical onsite error, and offer **Retry stop**. Never report the session stopped while the provider may still be connected.

### Application shutdown

Add remote access to `gracefulShutdown()` before closing Fastify:

- disable marker acceptance first
- attempt listener close with a short bounded timeout
- continue application shutdown even if ngrok does not acknowledge closure
- rely on process termination to drop the in-process control connection

A managed update therefore ends the remote session. The restarted application does not reopen it.

### Internet loss

If the SDK reports disconnection:

- enter `degraded`
- keep the original expiry
- show the loss locally
- allow the SDK's normal reconnect behavior
- return to `active` only for the same listener/session
- never affect local pollers, streams, or overlay

## 19. API contract

### `GET /api/remote-access/status`

Available through local, LAN, and authenticated remote origins.

Common response:

```ts
type RemoteAccessStatus = {
  provider: "ngrok";
  configured: boolean;
  phase: RemoteAccessPhase;
  connection: RemoteConnectionState;
  managementAllowed: boolean;
  remoteRequest: boolean;
  url: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  lastError: {
    code: RemoteAccessErrorCode;
    message: string;
    at: string;
  } | null;
};
```

When the request passes strict onsite-loopback management checks, add local configuration details. When a session is active, also add its credential:

```ts
type LocalRemoteAccessStatus = RemoteAccessStatus & {
  configurationSource: "windows-dpapi" | "environment" | null;
  credentials: {
    username: string;
    password: string;
  } | null;
};
```

LAN and remote responses omit `configurationSource` and `credentials` rather than returning redacted placeholders.

### `PUT /api/remote-access/configuration`

Strict onsite-loopback-only:

```json
{
  "authtoken": "<ngrok token>",
  "confirmation": "SAVE_AND_TEST_NGROK"
}
```

Tests the token, protects it, atomically stores it, and returns redacted status.

### `DELETE /api/remote-access/configuration`

Strict onsite-loopback-only and inactive-only:

```json
{
  "confirmation": "REMOVE_NGROK_CONFIGURATION"
}
```

Deletes the protected envelope and returns `unconfigured` status.

### `POST /api/remote-access/start`

Strict onsite-loopback-only:

```json
{
  "durationMinutes": 120,
  "confirmation": "START_REMOTE_ACCESS"
}
```

Returns `201` with active local status and the generated credential after self-probe success.

### `POST /api/remote-access/stop`

Strict onsite-loopback-only:

```json
{
  "confirmation": "STOP_REMOTE_ACCESS"
}
```

Returns inactive status only after listener closure succeeds.

### `GET /api/remote-access/probe`

Internal public-startup probe. Returns `204` only for the provisional session marker. It is not shown in the UI or API reference as a general health endpoint.

### Error codes

Initial stable codes:

- `REMOTE_ACCESS_LOCAL_REQUEST_REQUIRED`
- `REMOTE_ACCESS_ORIGIN_REQUIRED`
- `REMOTE_SESSION_INVALID`
- `REMOTE_ACCESS_NOT_CONFIGURED`
- `REMOTE_ACCESS_BUSY`
- `REMOTE_ACCESS_ALREADY_ACTIVE`
- `REMOTE_ACCESS_INVALID_DURATION`
- `REMOTE_ACCESS_SECRET_STORE_FAILED`
- `REMOTE_ACCESS_TOKEN_INVALID`
- `REMOTE_ACCESS_PROVIDER_UNAVAILABLE`
- `REMOTE_ACCESS_POLICY_REJECTED`
- `REMOTE_ACCESS_PUBLIC_URL_INVALID`
- `REMOTE_ACCESS_PROBE_FAILED`
- `REMOTE_ACCESS_STOP_FAILED`
- `REMOTE_ACCESS_NATIVE_MODULE_UNAVAILABLE`

Provider details and raw SDK errors must be sanitized before becoming an API message.

## 20. Client experience

### Unconfigured onsite state

The Settings card explains:

- an ngrok account is required
- the authtoken connects the app to that account
- offsite staff never receive the authtoken
- the token will be protected on this Windows user account

Controls:

- masked authtoken input
- **Save and test**
- link to ngrok's authtoken page and free-plan expectations

Use `autocomplete="off"` for the authtoken field and never repopulate it after save.

### Configured inactive state

Show:

- **ngrok configured**
- configuration source
- **Replace token**
- **Remove configuration**
- **Start remote access**

### Start confirmation

The dialog contains:

- duration selection, default two hours
- explicit statement that the credential grants full event configuration and live operations
- statement that updates and tunnel management stay onsite-only
- reminder that edits are shared and last-write-wins
- exact confirmation checkbox or phrase

### Active onsite state

Show prominently:

- Remote access active
- URL with **Copy URL**
- username and password with reveal/copy controls
- **Copy access details** without embedding credentials in the URL
- started and expiry times
- countdown
- connection health
- **Stop remote access** as a destructive action

Keep the password hidden by default. Use `autocomplete="new-password"` and do not offer browser persistence.

### Remote and LAN status

Remote and non-loopback LAN clients see:

- active-session banner
- URL, start time, expiry, and health
- a note that credentials and lifecycle controls are available only on the scoreboard computer through localhost

They never receive the password, marker, or authtoken configuration state beyond the redacted `configured` boolean.

### Global indicator

Add a non-dismissable banner to the admin shell while active or degraded. It must be visible on Operations, Settings, Teams, and Themes pages.

If Feature 2's event hub exists, emit `remote-access.changed` with only phase and revision and refetch status. Otherwise use a slow local fallback poll. Do not add another fast remote poll that unnecessarily consumes ngrok's request quota.

The live overlay itself should not display the banner. vMix continues using the local overlay URL.

## 21. Logging and redaction

Create a dedicated append-only lifecycle log:

```text
<portable-root>/logs/remote-access.log
```

Allowed fields:

- timestamp
- event type
- session ID
- phase
- start and expiry timestamps
- sanitized provider error code
- stop reason: manual, expiry, shutdown, startup-failure

Never log:

- authtoken or any substring intended to identify it
- username or password
- marker
- Basic Auth or Authorization header
- generated Traffic Policy
- DPAPI plaintext
- request or response bodies
- clipboard content

Configure Fastify/Pino redaction defensively for `authorization`, the marker header, `authtoken`, and credential-shaped fields even though normal request logging currently excludes bodies.

Before logging an SDK error, remove known secret values from the string and map common failures to stable application messages.

ngrok Traffic Inspector stores metadata by default, while full request/response capture is an account-level opt-in. Operational documentation should tell the team to leave full capture disabled because admin requests may contain exported configuration or uploaded data. See [ngrok Traffic Inspector](https://ngrok.com/docs/obs/traffic-inspection).

## 22. Free-plan behavior

As of this design, ngrok's free plan includes an account-assigned development domain, HTTPS, SDK use, up to three online endpoints, five Traffic Policy rules per policy, 20,000 HTTP requests per month, 1 GB of outgoing transfer per month, and a browser interstitial for HTML traffic.

Product implications:

- Do not promise a new random hostname for every session.
- Always rotate the Basic Auth credential even when the URL is unchanged.
- Expect the offsite browser to click ngrok's Visit interstitial before the Basic Auth/application flow.
- Use the bypass header only for the server's automated self-probe, not as a promise to remove the human-facing interstitial.
- Present quota exhaustion as a provider error without affecting local operation.
- Recommend a paid plan only when event-critical availability or frequent usage justifies it.

The current admin runtime-version watcher performs a request every five seconds: roughly 720 requests per hour for one continuously open browser, before other API traffic. At that rate, the 20,000-request allowance represents about 27 hours of active remote use per month. Feature 2 should reduce unnecessary polling before frequent remote use; until then, describe the free tier as suitable for occasional support sessions rather than guaranteed event-critical availability.

## 23. Test strategy

### 23.1 Unit tests

- credential generator format, minimum entropy, and no colon
- unique secrets across repeated sessions
- duration allowlist and maximum
- state-machine legal and illegal transitions
- serialization of simultaneous start/stop calls
- absolute expiry not extended by reconnect
- Traffic Policy contains Basic Auth, marker addition, and machine-route blocking using no metered actions
- policy and status serialization never expose secrets
- constant-time marker matching
- invalid, duplicate, retired, and absent marker behavior
- earliest request hook removes Authorization after classification and before route hooks
- strict onsite-loopback predicate
- remote Origin validation and normalization
- status credential projection for localhost versus LAN/remote
- SDK error sanitization
- DPAPI envelope parsing and atomic replacement through an injected bridge

### 23.2 Fastify route tests

- configuration/start/stop reject LAN and marked remote requests
- update mutations reject a marked request even when `request.ip` is loopback
- update mutations reject loopback requests carrying forwarding headers
- valid localhost update behavior remains unchanged
- valid marked remote requests can use every existing event-configuration mutation
- remote unsafe requests with missing or wrong Origin return 403
- remote safe GET and SSE requests are permitted
- invalid marker rejects before route handling
- inactive or retired session marker rejects all routes
- remote status omits credentials
- localhost status includes credentials only while active
- arbitrary CORS origins are no longer reflected
- probe is unavailable outside provisional startup

### 23.3 Service tests with a fake provider

- successful configure, start, probe, active, stop sequence
- invalid authtoken retains prior stored token
- provider start failure cleans all temporary secrets
- failed probe closes the listener
- manual expiry closes the listener
- degraded/reconnected callbacks preserve session identity and expiry
- stop failure disables application traffic and permits retry
- graceful shutdown is bounded
- server restart begins inactive

### 23.4 Real ngrok qualification

Run manually or in a protected CI job with a dedicated ngrok test account:

- unauthenticated HTML, API, upload, and SSE requests receive 401
- wrong Basic Auth receives 401
- correct Basic Auth loads the React application and relative assets
- both existing SSE streams remain connected and deliver events
- theme editing, publish, settings, teams, operator text, uploads, import, and export work remotely
- update and remote-management mutations return 403 remotely
- the same update controls continue to work through onsite localhost
- malicious cross-origin mutation returns 403
- Authorization is absent at the probe and normal handler layer after application-side sanitization
- client-supplied, duplicated, or comma-joined markers fail closed
- free-plan interstitial flow is understandable
- manual stop revokes the endpoint promptly
- expiry revokes the endpoint
- old credentials fail after a new session starts on the same assigned domain
- internet disconnect marks degraded without affecting local overlay or controls
- reconnection does not extend expiry
- killing the application makes the endpoint unavailable
- restarting the application does not reopen the session

### 23.5 Windows portable qualification

- clean Windows x64 machine can import the SDK native module
- required Visual C++ runtime behavior is understood and documented
- DPAPI store survives application restart and managed version switch
- DPAPI value cannot be decrypted under a different Windows user
- moving the portable directory to another machine produces a recoverable reconfiguration prompt
- authtoken envelope is absent from app export and backup
- update install closes the tunnel before shutdown and does not reopen it
- rollback preserves the encrypted authtoken but leaves remote access inactive
- antivirus does not quarantine the packaged SDK native module
- packaged size increase is measured and accepted

## 24. Delivery phases

### Phase 1: shared model and secret storage

- Add schemas and stable errors.
- Add runtime secret paths.
- Implement injectable secret store and Windows DPAPI bridge.
- Add configuration API and tests.

Exit criteria: packaged Windows can save, restart, decrypt, replace, and delete an ngrok authtoken without exposing it in data exports or logs.

### Phase 2: request boundary hardening

- Add remote marker classification.
- Add strict onsite-loopback predicate.
- Apply it to all update mutations.
- Remove permissive CORS reflection.
- Add unsafe-method Origin validation.

Exit criteria: route tests prove a loopback-forwarded remote request cannot invoke machine-lifecycle APIs.

### Phase 3: ngrok provider and lifecycle

- Add the SDK dependency and packaging assertions.
- Implement Traffic Policy generation.
- Implement start, self-probe, status callbacks, expiry, stop, and shutdown.
- Add lifecycle logs with redaction.

Exit criteria: fake-provider tests pass and no start failure leaves accepted credentials or a live application session.

### Phase 4: operator UI

- Add Settings card and configuration flow.
- Add start confirmation and active credential presentation.
- Add stop/retry controls and global banner.
- Add remote redaction and connection-loss states.

Exit criteria: an onsite operator can complete the workflow without using a terminal or ngrok dashboard after the one-time token copy.

### Phase 5: real provider and Windows qualification

- Execute real ngrok browser/API/SSE matrix.
- Execute Windows portable and DPAPI matrix.
- Measure request usage, endpoint teardown time, and packaging impact.
- Resolve all security-boundary and shutdown failures before release.

Exit criteria: remote event configuration works through a real ngrok account, stopping/expiry reliably revoke it, and local operation remains unaffected through all provider failures.

## 25. Rollout and rollback

Ship the feature default-off. Existing installations remain unconfigured and make no ngrok connection.

The first release should label the integration **Temporary remote access (ngrok)** and document that it is for trusted staff with shared full control.

If qualification or production use reveals a tunnel problem:

- stop the active listener
- disable the Start control with a clear provider error
- preserve the encrypted authtoken for a later fixed release
- leave all local/LAN functionality unchanged

Code rollback is safe because older application versions ignore the root `secrets/remote-access.json` file. Data formats and existing exports do not change.

## 26. Implementation checklist

- [ ] Add `@ngrok/ngrok` and lockfile changes.
- [ ] Add shared remote-access schemas and errors.
- [ ] Add root secrets runtime paths.
- [ ] Implement Windows current-user DPAPI storage.
- [ ] Add environment and in-memory secret-store adapters.
- [ ] Add configuration/test/delete APIs.
- [ ] Add request marker and strict onsite-loopback security helpers.
- [ ] Migrate every update mutation to the strict predicate.
- [ ] Remove arbitrary CORS origin reflection.
- [ ] Add remote unsafe-method Origin validation.
- [ ] Implement in-memory Traffic Policy generation.
- [ ] Implement ngrok start and HTTPS URL validation.
- [ ] Implement public authenticated self-probe.
- [ ] Implement lifecycle state machine, expiry, degraded state, and stop retry.
- [ ] Integrate listener closure into graceful shutdown and managed-update restart.
- [ ] Add redacted lifecycle log and logger redaction.
- [ ] Add client API, status hook, Settings card, dialogs, and global banner.
- [ ] Add optional `remote-access.changed` event-hub integration.
- [ ] Extend package validation for the Windows native SDK.
- [ ] Complete unit, route, fake-provider, real-ngrok, and Windows matrices.
- [ ] Update README, API reference, project context, portable readme, and operator instructions after implementation.
