# Server

## Summary

The server is a Fastify service on `127.0.0.1:7665` for the main checkout, with an optional second remote/VPN listener. A Git worktree launched through `scripts/run-rook.sh` receives an isolated development profile with a deterministic alternate port and profile-specific local state. The server exposes a session-bound ACP WebSocket facade at `/api/ws`, a REST control plane for runtimes, sessions, and environments, and an internal runtime broker that launches one ACP subprocess owned as a process group per public session.

## Main components

- `server/src/index.ts`
  - builds the Fastify app
  - wires infrastructure, domain services, repositories, and routes
- `runtime/services/AgentRuntimeManager`
  - owns configured runtime profiles
  - creates one `SessionRuntime` process group per public session, with serialized per-session creation
  - globally serializes ACP `session/new`/`session/load` operations that can update pi-acp's shared session mapping file
  - maps public session IDs to runtime-local ACP session IDs
  - restarts only the affected session when environment state changes
- `runtime/SessionRuntime`
  - generic ACP stdio transport for a single session runtime process group
  - forwards standard ACP image prompt blocks unchanged to image-capable runtimes
  - bounds shutdown and terminates adapter/provider descendants together
  - initializes the subprocess, sends JSON-RPC, and relays notifications
- `environments/services/EnvironmentManager`
  - tracks available environments, offers, approvals, active/recent state, and session subscriptions
- `environments/services/EnvironmentRepositoryService`
  - resolves environment bundles from repo-backed repositories and canonical content hashes
- `environments/repositories/SQLiteEnvironmentRepository`
  - stores canonical and personal capability content and bundle memberships in separate SQLite repositories
- `environments/repositories/ProjectDirectoryEnvironmentRepository`
  - reads project-owned `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and `.mcp.json` files in place
- `environments/repositories/LocationContextRepository`
  - in-memory synthetic repository for the generated location-context skill bundle
- `environments/services/JsonlEnvironmentMetadataCaptureSink`
  - appends candidate-registration metadata to ignored local JSONL files for development inspection; it does not persist capability content
- `location/PtilesPoiLookupProvider`
  - production POI lookup using byte-range reads from the upstream `.ptiles` datasets, with building/business matching and scoring
- `runtime/CapabilityWorkspaceManager`
  - owns the process-wide `$ROOK_HOME/global-workspace/` SQLite materialization, environment-level manifest, watchers, and disposable per-session link projections; defaults to the active profile's `ROOK_HOME`, clears the global root at startup, and retains it after shutdown
  - links writable personal content into every applicable session, links project sources directly, and materializes immutable external content read-only
- `sessions/repositories/SqliteSessionRepository`
  - persists sessions and session↔environment membership directly in SQLite
- `environments/repositories/EnvironmentDecisionRepository`
  - persists durable environment decisions keyed by bundle hash directly in SQLite
- location services
  - `location/EnvironmentIdentifier` ranks nearby `location:` environments
  - `location/LocationRegistrar` applies dwell gating, registers the current/nearby candidates, and writes the current location-context skill
  - `location/ptiles/` parses and queries admin, building, and business vector-tile data
- `shared/`
  - server-side ACP JSON-RPC, agent, environment, repository, and bundle-hash contracts shared across domains
- `infrastructure/remoteProxy`
  - optional second listener that proxies a remote/VPN address to the loopback Fastify server

## Source organization

The server is organized **primarily by domain**. Within a domain, subfolders such as `routes/`, `services/`, `repositories/`, and `datastores/` are used only when that domain actually has those layers.

Top-level layout:

- `server/src/infrastructure/`
  - cross-domain bootstrap/support code
  - auth, config loading, path helpers, remote proxy, shared SQLite connection bootstrap
- `server/src/sessions/`
  - session routes, repository contract, and SQLite session repository
- `server/src/runtime/`
  - ACP facade, runtime REST routes, subprocess transport, runtime orchestration, subscriber/replay routing, runtime-only extension code
- `server/src/environments/`
  - environment routes, services, repositories, datastores, prompt/binding/type support
- `server/src/location/`
  - location identification, POI lookup providers, dwell logic, trace helpers, ptiles readers/scoring, and environment bridge helpers
- `server/src/shared/`
  - cross-domain wire and DTO contracts; this is shared server code, not a second application layer
- `server/scripts/location/`
  - GPX replay, dwell analysis, trace fetching, and map-rendering tools used to validate the location pipeline

Important nuance:
- not every domain needs every layer
- internal-only behavior does not need routes
- features with no persistence do not need repositories/datastores
- some support files intentionally stay adjacent to their domain instead of being forced into a generic shared layer

See also: [database.md](./database.md)

## Main interfaces

### WebSocket ACP facade
- route: `GET /api/ws`
- websocket may be session-bound up front via `?sessionId=<public-session-id>`
- a websocket that starts unbound becomes bound after a successful `session/new`
- once bound, the websocket is restricted to that session only
- client methods handled directly:
  - `initialize`
  - `session/new` (unbound websocket only; success binds that websocket to the new public session)
  - `session/load`
  - `session/prompt` (including standard ACP image blocks when the selected runtime supports them)
  - `session/cancel`
  - `session/set_mode`
  - `session/set_config_option`
  - `session/close`
- owned extension:
  - `_com.rookkeeper/environment_offer`
  - `_com.rookkeeper/environment_offer_resolve`
  - `_com.rookkeeper/environment_offer_resolved`

### REST control plane
- `GET /api/health`
- `GET /api/agent_runtimes`
- `GET /api/sessions` — session listing over REST
- `PATCH /api/sessions/:sessionId` — rename or pin/unpin one session without changing recency ordering
- `POST /api/sessions/reorder-pinned` — replace the complete pinned-session order; the request must contain each currently pinned session exactly once
- `POST /api/sessions/:sessionId/touch` — acknowledge pending attention, mark one session as recently viewed, and keep it open for activity acknowledgment
- `POST /api/sessions/:sessionId/unview` — leave the session view so later completed turns can become pending attention
- `DELETE /api/sessions/:sessionId` — delete one session plus workspace state
- `POST /api/environments/register`
- `POST /api/environments/decision`
- `GET /api/environments/preview`
- `GET /api/environments/search?query=...`
- `GET /api/bundles/search?query=...&repository=...`
- `POST /api/environments/identify`
- `POST /api/environments/register-location`
- `POST /api/session/environments`
- `GET /api/environments/list`
- `GET /api/diagnostics/environments`

### Runtime boundary
`SessionRuntime` speaks newline-delimited ACP JSON-RPC over stdio to subprocesses launched from runtime profiles. Supported runtime types are configured, not implicit: `pi`, `claude`, `cursor`, and generic `acp`. Runtime profiles report image-prompt support explicitly (Pi defaults to supported), and the facade validates image MIME/data limits before forwarding.

## Local profile configuration

The launcher exports `ROOK_HOME` and `ROOK_DATABASE_PATH`. Runtime configuration, the application database, and capability workspaces resolve under `ROOK_HOME`; the default is `~/.rook` for production and `~/.rook-<worktree-slug>` for a development worktree. The slug includes a short hash of the canonical worktree path, so same-named worktrees remain isolated. On first launch, development profiles seed `ROOK_HOME` by copying the production `~/.rook` directory, including the application database, so the development profile starts with the same sessions and durable local state; later launches leave the existing profile home unchanged. The default application database path is `ROOK_HOME/rook.sqlite`. The personal environment-repository database is a separate source and defaults to `~/.rook/environment-repository.db`; it only follows a different profile when `ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB` is explicitly set. `run-rook.sh` computes and exports `ROOK_HOME` / `ROOK_DATABASE_PATH` for the selected profile, so ambient values are not treated as launcher inputs; use `RUN_ROOK_HOME` / `RUN_ROOK_DATABASE_PATH` when an explicit launcher override is intended. `ROOK_AGENT_RUNTIMES_PATH` remains an explicit escape hatch. The canonical environment repository remains the `environment-repository.db` file belonging to the checkout that launched the server.

## Persistence shape

Current durable persistence is SQLite-backed and split between:

- the application database: session records, session-environment membership, and durable environment decisions
- runtime-owned ACP session files: conversation history and replay source
- the environment repository databases: environments, reusable capabilities, and bundle memberships for canonical and personal repositories

Canonical and personal environment-repository content is SQLite-only. Project-directory environments remain the intentional direct file-backed exception, and location-context bundles are an in-memory synthetic repository backed by a generated skill directory. The global workspace is an inspectable projection, never durable storage. Deterministic personal authoring bundles are recreated from entered non-directory memberships independently of live observation status. By default, a development profile isolates the application database and workspaces but shares the personal repository database with the production profile unless the personal database override is supplied.

The database details live in [database.md](./database.md).

## Core data schemas

### Session record
Persisted in SQLite:
- `sessionId`
- `runtimeId`
- `runtimeSessionId`
- `title`
- `cwd`
- `startedAt`
- `updatedAt`
- `attentionStatus` — durable `clear`, `ready`, or `error` enum constrained in SQLite; timeout/forced-cancel cleanup records `error`
- `pinned` — durable boolean organization state
- `pinnedOrder` — durable positional order among pinned sessions

The `GET /api/sessions` response additionally includes `running` and the
server-authoritative `activityStatus` (`active`, `ready`, `error`, `on`, or
`off`). `active` is an in-flight ACP prompt; `ready` and `error` are durable
pending attention states; `on` and `off` reflect live runtime liveness after
attention precedence is applied. `updatedAt` is used for both prompt activity and explicit view/touch operations,
so entering a session can move it to the top of the shared recents list without
creating a synthetic prompt. Pinned sessions are ordered by durable `pinnedOrder`, while unpinned sessions retain `updatedAt DESC` recency ordering; clients render the shared `Pinned` then `Recent` organization.

Related tables:
- `session_environments(session_id, environment_id, entered_at)`

### Environment decision model
- `accept` — allow for this session/visit
- `approve` — durable allow
- `ignore` — dismiss for this session/visit
- `reject` — durable reject

### Environment preview / offer
- `EnvironmentPreview`
  - `environmentId`
  - `bundles[]`
- `EnvironmentBundlePreview`
  - `id`, `bundleId`, `environmentId`, `repository`, `valid`, `bundleHash`
  - bundle content hash derived from active capability memberships
  - `skills[]`, `mcpServers[]`, `apps[]`, `facts[]`, optional `llmsTxt`, `agentsMd`, `errors[]`
- bundle search supports filtering by repository id (`canonical`, `personal`, or source-specific ids)
- `EnvironmentBundleOffer`
  - `environmentId`, `bundleId`, `bundleHash`
  - `displayName`
  - capability summary for skills, MCP/apps, facts, `llms.txt`, and instructions as available

### Location identification
`IdentifyAvailableRequest`:
- `latitude`, `longitude`
- optional `horizontalAccuracy`, `source`, `dwellSeconds`, `isStationary`, `speedMetersPerSecond`, `observedAt`

`EnvironmentCandidate`:
- `environmentId`, `displayName`
- optional `operator`, `storeNumber`, `address`, `latitude`, `longitude`, `website`, `distanceMeters`
- `confidence`, `matchReasons[]`, `hasKnownEnvironment`, optional `possibleSkills[]`

## Main processes

### Session creation
1. client sends `session/new` with runtime metadata on an unbound websocket
2. `AgentRuntimeManager` creates a `SessionRuntime`
3. server calls runtime `session/new` through the server-wide ACP session-mutation gate
4. server stores a public session record with a new public UUID
5. server returns that public session ID and binds the same websocket to it

### Prompt execution
1. every configured runtime starts with the base `## You are Rook` identity prompt and uses its agent workspace as process cwd; environment-specific instructions are discovered through generated `AGENTS.md` (aliased as `CLAUDE.md` for Claude runtimes)
2. client sends ACP `session/prompt` on a session-bound websocket
3. ACP facade resolves the public session
4. `AgentRuntimeManager` rewrites to the runtime-local session ID
5. `SessionRuntime` forwards the request to the subprocess
6. runtime emits `session/update` notifications
7. `AgentRuntimeManager` distinguishes pi-acp's retry-only progress messages from actual agent output; an `end_turn` with exhausted retry progress and no actual output becomes a failed prompt, while a recovered turn remains successful
8. server rewrites session IDs back to the public ID and forwards live notifications to subscribed watchers of that same session
9. bounded request/cancellation waits force-stop an unresponsive runtime group, reconcile the turn state, and mark the session `error`; a later request lazily creates one replacement, privately adopts the persisted ACP session with `session/load`, and then forwards the new prompt without replaying the transcript or interrupted prompt

### Environment offer and approval
1. a provider registers an environment candidate with `POST /api/environments/register`
2. the server finalizes it asynchronously, checking exact ids plus observed-path / observed-URL implied ids through `EnvironmentRepository`
3. finalized environments resolve matching bundles and hash them
4. undecided bundles are offered to subscribed sessions when that session enters the finalized environment
5. client resolves via REST decision or ACP extension resolution
6. approved/personal bundle content is resolved for workspace projection. The generated aggregate `AGENTS.md` exposes approved/user-owned instruction sources in environment-tagged blocks, gives authoring guidance, inventories known skill names by environment, and the workspace uses the standard `.agents/skills/` discovery directory, aliased as `.claude/skills` so Claude Code's native skill discovery finds the same content; Pi receives one-run project approval because ACP is non-interactive, and environment instructions are not duplicated through launch prompt injection.

### Environment-driven runtime restart
1. session enters or exits an environment
2. `AgentRuntimeManager` resolves approved bundle content and asks `CapabilityWorkspaceManager` to update that session’s links and generated aggregate
3. shared SQLite/project sources receive a final assessment before replacement; ordinary file edits do not themselves require runtime restart
4. it waits for any active prompt on the session to finish
5. it creates a replacement `SessionRuntime` with the workspace as cwd
6. replacement normally takes over through the server-wide ACP session-mutation gate and `session/load` of the exact existing runtime session; if the runtime returns an ACP response error for that load, it retries with `session/new` and persists the new runtime session id, while startup, transport, timeout, and malformed-load-response failures abort the restart
7. only then is the previous subprocess retired

### Session environment restoration
1. the first request for a persisted session after server startup reads its durable `session_environments` membership
2. known repository-backed environments are rehydrated into the fresh `EnvironmentManager`; unobserved memberships remain entered as recent UI entries without deleting membership, while entered environments retain repository-backed bundles and non-directory memberships receive their deterministic personal authoring projection
3. rehydrated entries follow the normal bundle decision, workspace materialization, and affected-session runtime replacement flow
4. the request then privately recovers the persisted ACP session before forwarding the client operation

### Location registration
1. phone client posts `register-location`
2. `EnvironmentIdentifier` queries the configured `PoiLookupProvider` (the production path is `PtilesPoiLookupProvider`) and ranks nearby business environments
3. `LocationRegistrar` rejects drive-by observations, writes a generated location-context `SKILL.md` for a genuine dwell, and registers the current/nearby candidates through the normal repository facade
4. the current candidate is accepted for the active environment flow; affected sessions receive offers and/or environment-entered updates

## Notable architectural characteristics

- one public session = one owned runtime process group
- non-prompt runtime waits are bounded; prompts remain pending until completion, client cancellation, or runtime exit, while cancellation timeout force-stops the group and reconciles turn state
- runtimes idle for 30 minutes without user or runtime activity are collected without deleting their durable sessions; the next server request privately restores the persisted ACP session before prompting
- Rook shutdown and session deletion terminate all owned runtime groups, including provider descendants
- ACP session mapping mutations are serialized across sessions to protect pi-acp's shared map
- websocket connections are session-bound, not general multi-session ACP pipes
- `session/load` replay is requester-private; it is not fanned out to other watchers of that session
- session discovery uses the REST sessions endpoint
- ACP runtime history is the sole transcript source; clients use requester-private `session/load` replay for initial hydration, while server-side runtime recovery discards that replay before attaching the replacement to visible subscribers
- environment state is session-specific at runtime launch time; environment-driven runtime replacement waits for active prompts before retiring the current runtime
- writable SQLite capability files have one process-wide temporary materialization and are linked into per-session workspaces
- durable decisions and session membership are SQLite-backed; ACP session history remains runtime-owned
- canonical and personal environment repository content is SQLite-backed; project-directory environments remain direct file-backed sources
- facts and `llms.txt` use capability-specific projections; MCP content is reviewable/read-only but not started by the runtime
- personal authoring uses one shared writable source per environment, watcher-mediated current-content write-back and membership soft deletion, and explicit environment authoring directories; filesystem permissions are not a strong sandbox against same-user arbitrary shell access
- location identification is provider-pluggable behind `PoiLookupProvider`; production uses range-fetched ptiles data and tests commonly use `StubPoiLookupProvider`
- development/validation tooling includes GPX replay and trace-analysis scripts under `server/scripts/location/`; these are operational tools, not server request routes
