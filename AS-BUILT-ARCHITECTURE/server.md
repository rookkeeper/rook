# Server

## Summary

The server is a Fastify service on `127.0.0.1:7665` with an optional second remote/VPN listener. It exposes a session-bound ACP WebSocket facade at `/api/ws`, a REST control plane for runtimes, sessions, transcripts, and environments, and an internal runtime broker that launches one ACP subprocess per public session.

## Main components

- `server/src/server/index.ts`
  - builds the Fastify app
  - wires auth, routes, datastore, environment services, and runtime services
- `AgentRuntimeManager`
  - owns configured runtime profiles
  - creates one `SessionRuntime` per public session
  - maps public session IDs to runtime-local ACP session IDs
  - restarts only the affected session when environment state changes
- `SessionRuntime`
  - generic ACP stdio transport for a single session runtime process
  - initializes the subprocess, sends JSON-RPC, and relays notifications
- `EnvironmentManager`
  - tracks available environments, offers, approvals, active/recent state, and session subscriptions
- `EnvironmentRepositoryService`
  - resolves environment bundles from repo-backed repositories
- `SqliteSessionRepository`
  - persists sessions and session↔environment membership
- `EnvironmentDecisionStore`
  - persists durable environment decisions keyed by bundle hash
- location services
  - `EnvironmentIdentifier` ranks nearby `location:` environments
  - `LocationRegistrar` syncs identified locations into the environment manager

## Structural convention

The server is moving toward a layered structure:

- routes / API when a capability is externally exposed
- services for orchestration and business rules
- repositories or stores for persistence-facing interfaces
- datastore for the underlying database connection

Important nuance:
- not every feature needs every layer
- internal-only behavior does not need routes
- features with no persistence do not need repositories/datastore access
- some domain modules may legitimately stop at the service layer

As-built today, this structure is only partially regularized. Parts of the server already conform well, especially ACP/session persistence. Other areas — especially some environment and location code — still mix responsibilities more than the target architecture. Those are current exceptions we should gradually clean up, not a reason to abandon the layered direction.

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
  - `session/prompt`
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
- `POST /api/environments/identify`
- `POST /api/environments/register-location`
- `POST /api/session/environments`
- `GET /api/environments/list`
- `GET /api/diagnostics/environments`

### Runtime boundary
`SessionRuntime` speaks newline-delimited ACP JSON-RPC over stdio to subprocesses launched from runtime profiles. Supported runtime types are configured, not implicit: `pi`, `claude`, `cursor`, and generic `acp`.

## Persistence shape

Current durable persistence is SQLite-backed and centered on:
- session records
- append-only normalized transcript events per session
- session-environment membership
- durable environment bundle decisions

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
  - `skills[]`, `mcpServers[]`, `apps[]`, `errors[]`
- `EnvironmentBundleOffer`
  - `environmentId`, `bundleId`, `bundleHash`
  - `displayName`
  - `skills[]`, `mcpServers[]`, `apps[]`

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
1. client sends ACP `session/prompt` on a session-bound websocket
2. ACP facade resolves the public session
3. `AgentRuntimeManager` rewrites to the runtime-local session ID
4. `SessionRuntime` forwards the request to the subprocess
5. runtime emits `session/update` notifications
6. server normalizes live transcript events into `session_transcript_events`
7. server rewrites session IDs back to the public ID and forwards live notifications to subscribed watchers of that same session

### Environment offer and approval
1. a provider registers an environment candidate with `POST /api/environments/register`
2. the server finalizes it asynchronously, checking exact ids plus observed-path / observed-URL implied ids through `EnvironmentRepository`
3. finalized environments resolve matching bundles and hash them
4. undecided bundles are offered to subscribed sessions when that session enters the finalized environment
5. client resolves via REST decision or ACP extension resolution
6. approved skill paths are attached to that session's launch configuration

### Environment-driven runtime restart
1. session enters or exits an environment
2. `AgentRuntimeManager` computes merged `skillPaths`, `enteredEnvironmentIds`, and appended prompt text
3. it creates a replacement `SessionRuntime`
4. replacement must successfully `session/load` the exact existing runtime session
5. only then is the old subprocess retired

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
- durable decisions, transcript history, and session membership are SQLite-backed
- location identification is provider-pluggable behind `PoiLookupProvider`
