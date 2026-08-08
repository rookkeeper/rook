# Server

## Summary

The server is a Fastify service on `127.0.0.1:7665` for the main checkout, with an optional second remote/VPN listener. A Git worktree launched through `scripts/run-rook.sh` receives an isolated development profile with a deterministic alternate port and profile-specific local state. The server exposes a session-bound ACP WebSocket facade at `/api/ws`, a REST control plane for runtimes, sessions, transcripts, and environments, and an internal runtime broker that launches one ACP subprocess per public session.

## Main components

- `server/src/index.ts`
  - builds the Fastify app
  - wires infrastructure, domain services, repositories, and routes
- `runtime/services/AgentRuntimeManager`
  - owns configured runtime profiles
  - creates one `SessionRuntime` per public session
  - maps public session IDs to runtime-local ACP session IDs
  - restarts only the affected session when environment state changes
- `runtime/SessionRuntime`
  - generic ACP stdio transport for a single session runtime process
  - forwards standard ACP image prompt blocks unchanged to image-capable runtimes
  - initializes the subprocess, sends JSON-RPC, and relays notifications
- `environments/services/EnvironmentManager`
  - tracks available environments, offers, approvals, active/recent state, and session subscriptions
- `environments/services/EnvironmentRepositoryService`
  - resolves environment bundles from repo-backed repositories and canonical content hashes
- `environments/repositories/SQLiteEnvironmentRepository`
  - stores canonical and personal capability content and bundle memberships in separate SQLite repositories
- `environments/repositories/ProjectDirectoryEnvironmentRepository`
  - reads project-owned `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and `.mcp.json` files in place
- `runtime/CapabilityWorkspaceManager`
  - owns the process-wide `~/.rook/global-workspace/` SQLite materialization, environment-level manifest, watchers, and disposable per-session link projections; clears the global root at startup and retains it after shutdown
  - links writable personal content into every applicable session, links project sources directly, and materializes immutable external content read-only
- `sessions/repositories/SqliteSessionRepository`
  - persists sessions and session↔environment membership directly in SQLite
- `environments/repositories/EnvironmentDecisionRepository`
  - persists durable environment decisions keyed by bundle hash directly in SQLite
- location services
  - `location/EnvironmentIdentifier` ranks nearby `location:` environments
  - `location/LocationRegistrar` syncs identified locations into the environment manager

## Source organization

The server is now organized **primarily by domain**. Within a domain, subfolders such as `routes/`, `services/`, `repositories/`, and `datastores/` are used only when that domain actually has those layers.

Top-level layout:

- `server/src/infrastructure/`
  - cross-domain bootstrap/support code
  - auth, config loading, path helpers, remote proxy, shared SQLite connection bootstrap
- `server/src/sessions/`
  - session routes, repository contract, SQLite session repository, transcript persistence/helpers
- `server/src/runtime/`
  - ACP facade, runtime REST routes, subprocess transport, runtime orchestration, realtime helpers, runtime-only extension code
- `server/src/environments/`
  - environment routes, services, repositories, datastores, prompt/binding/type support
- `server/src/location/`
  - location identification, POI lookup providers, dwell logic, trace helpers, and environment bridge helpers

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
  - `session/list` (unbound websocket only; REST preferred)
  - `session/new` (unbound websocket only; success binds that websocket to the new public session)
  - `session/load`
  - `session/resume`
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
- `GET /api/sessions` — session listing over REST (replaces WebSocket `session/list`)
- `GET /api/sessions/:sessionId/transcript` — server-owned normalized transcript for hydrators / second viewers
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

The launcher exports `ROOK_HOME` and `ROOK_DATABASE_PATH`. User-local configuration and personal environment-repository bindings resolve under `ROOK_HOME`; the default is `~/.rook` for production and `~/.rook-<worktree-slug>` for a development worktree. The slug includes a short hash of the canonical worktree path, so same-named worktrees remain isolated. On first launch, development profiles seed `ROOK_HOME` by copying the production `~/.rook` directory; later launches leave the existing profile home unchanged. Runtime definitions, user configuration, personal environment-repository state, and other durable local state therefore become profile-specific. `ROOK_AGENT_RUNTIMES_PATH` remains an explicit escape hatch. The canonical environment repository remains the `environment-repository/` directory belonging to the checkout that launched the server.

## Persistence shape

Current durable persistence is SQLite-backed and split between:

- the application database: session records, append-only normalized transcript events, session-environment membership, and durable environment decisions
- the environment repository databases: environments, reusable capabilities, and bundle memberships for canonical and personal repositories

Canonical and personal environment-repository content is SQLite-only; the legacy directory repository and importer are no longer runtime or migration sources. Project-directory environments remain the intentional direct file-backed exception. The global workspace is an inspectable projection, never durable storage.

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

The `GET /api/sessions` response additionally includes a `running` boolean
(derived from whether a `SessionRuntime` is active for that session).

Related tables:
- `session_environments(session_id, environment_id, entered_at)`
- `session_transcript_events(sequence, session_id, created_at, event_json)`

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
3. server calls runtime `session/new`
4. server stores a public session record with a new public UUID
5. server returns that public session ID and binds the same websocket to it

### Prompt execution
1. every configured runtime starts with the base `## You are Rook` identity prompt and uses its agent workspace as process cwd; environment-specific instructions are discovered through generated `AGENTS.md`
2. client sends ACP `session/prompt` on a session-bound websocket
3. ACP facade resolves the public session
4. `AgentRuntimeManager` rewrites to the runtime-local session ID
5. `SessionRuntime` forwards the request to the subprocess
6. runtime emits `session/update` notifications
7. server normalizes live transcript events into `session_transcript_events`
8. server rewrites session IDs back to the public ID and forwards live notifications to subscribed watchers of that same session

### Environment offer and approval
1. a provider registers an environment candidate with `POST /api/environments/register`
2. the server finalizes it asynchronously, checking exact ids plus observed-path / observed-URL implied ids through `EnvironmentRepository`
3. finalized environments resolve matching bundles and hash them
4. undecided bundles are offered to subscribed sessions when that session enters the finalized environment
5. client resolves via REST decision or ACP extension resolution
6. approved/personal bundle content is resolved for workspace projection. The generated aggregate `AGENTS.md` exposes approved/user-owned instruction sources in environment-tagged blocks, gives authoring guidance, inventories known skill names by environment, and the workspace uses the standard `.agents/skills/` discovery directory; Pi receives one-run project approval because ACP is non-interactive, and the runtime no longer receives duplicate environment prompt injection.

### Environment-driven runtime restart
1. session enters or exits an environment
2. `AgentRuntimeManager` resolves approved bundle content and asks `CapabilityWorkspaceManager` to update that session’s links and generated aggregate
3. shared SQLite/project sources receive a final assessment before replacement; ordinary file edits do not themselves require runtime restart
4. it creates a replacement `SessionRuntime` with the workspace as cwd
5. replacement must successfully `session/load` the exact existing runtime session
6. only then is the old subprocess retired

### Location registration
1. phone client posts `register-location`
2. `EnvironmentIdentifier` ranks nearby business environments
3. `LocationRegistrar` syncs them into the active/recent environment cache
4. affected sessions receive offers and/or environment-entered updates

## Notable architectural characteristics

- one public session = one runtime subprocess
- websocket connections are session-bound, not general multi-session ACP pipes
- `session/load` replay is requester-private; it no longer fans out to every watcher of that session
- the server owns a durable normalized transcript for each session so additional viewers can hydrate without runtime replay
- environment state is session-specific at runtime launch time
- writable SQLite capability files have one process-wide temporary materialization and are linked into per-session workspaces
- durable decisions, transcript history, and session membership are SQLite-backed
- canonical and personal environment repository content is SQLite-backed; project-directory environments remain direct file-backed sources
- facts and `llms.txt` use capability-specific projections; MCP content is reviewable/read-only but not started by the runtime
- personal authoring uses one shared writable source per environment, watcher-mediated current-content write-back and membership soft deletion, and explicit environment authoring directories; filesystem permissions are not a strong sandbox against same-user arbitrary shell access
- location identification is provider-pluggable behind `PoiLookupProvider`
