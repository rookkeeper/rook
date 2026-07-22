# Server

## Summary

The server is a Fastify service on `127.0.0.1:7665` with an optional second remote/VPN listener. It exposes a connection-level ACP WebSocket facade at `/api/ws`, a REST control plane for runtimes and environments, and an internal runtime broker that launches one ACP subprocess per public session.

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
- client methods handled directly:
  - `initialize`
  - `session/list`
  - `session/new`
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

Related table:
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
  - `skills[]`, `mcpServers[]`, `apps[]`, `errors[]`
- `EnvironmentBundleOffer`
  - `environmentId`, `bundleId`, `bundleHash`
  - `displayName`, `sourceName`, `canonicalSourceUrl`
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
1. client sends `session/new` with runtime metadata
2. `AgentRuntimeManager` creates a `SessionRuntime`
3. server calls runtime `session/new`
4. server stores a public session record with a new public UUID
5. later client `session/load`s the public session

### Prompt execution
1. client sends ACP `session/prompt`
2. ACP facade resolves the public session
3. `AgentRuntimeManager` rewrites to the runtime-local session ID
4. `SessionRuntime` forwards the request to the subprocess
5. runtime emits `session/update` notifications
6. server rewrites session IDs back to the public ID and forwards them to subscribed clients

### Environment offer and approval
1. a provider registers an environment with `POST /api/environments/register`
2. `EnvironmentManager` resolves matching bundles and hashes them
3. undecided bundles are offered to subscribed sessions
4. client resolves via REST decision or ACP extension resolution
5. approved skill paths are attached to that session's launch configuration

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
- pure ACP on both protocol boundaries
- environment state is session-specific at runtime launch time
- durable decisions and session membership are SQLite-backed
- location identification is provider-pluggable behind `PoiLookupProvider`
