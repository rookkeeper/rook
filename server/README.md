# Rook server

Fastify API and runtime orchestration for the Rook native clients and CLI tooling. Part of the [Rook](../README.md) monorepo. Product/architecture notes: [PRODUCT/](../PRODUCT/). Repo-level setup, `.env`, binding, and auth live in [docs/setup.md](../docs/setup.md).

## Quick start

From this package:

```bash
npm install
npm run dev
```

Or from the repo root:

```bash
./scripts/run-rook.sh server
```

That starts the backend on `http://127.0.0.1:7665`.

## Network binding and auth

The server binds loopback (`127.0.0.1`) by default. For remote phone access, set `ROOK_BIND_IP` to add a second listener. When `ROOK_AUTH_TOKEN` is configured, every HTTP + WebSocket client — including localhost — must send it. See [docs/setup.md](../docs/setup.md).

## Runtime configuration

Rook loads configured runtimes from `~/.rook/config/agent-runtimes.json`. See `../docs/configuration.md`.

Default example:

```json
{
  "id": "MyPiOpenAiAgent",
  "type": "pi",
  "args": ["-e", "/absolute/path/to/my-agent", "--provider", "openai-codex", "--model", "gpt-5.4"]
}
```

A `MockAcpAgent` is configured for fast CLI-driven testing — it stores transcripts, replays history on `session/load`, and handles common prompt patterns.

## Architecture

The server is a single ACP-compliant agent from the client's perspective. Internally it's a broker that lazily manages per-session runtime subprocesses.

### Organization

The server is organized **primarily by domain**:

- `src/server/infrastructure/` — auth, config loading, path helpers, remote proxy, shared datastore bootstrap
- `src/server/sessions/` — session routes, repository contract, SQLite session persistence, transcript storage/helpers
- `src/server/runtime/` — ACP facade, runtime REST routes, subprocess transport, runtime orchestration, realtime helpers
- `src/server/environments/` — environment routes, services, repositories, datastores, prompt/binding/type support
- `src/server/location/` — location identification, POI providers, dwell logic, trace helpers, environment bridge helpers

Within each domain, `routes/`, `services/`, `repositories/`, and `datastores/` appear only where that domain actually needs them.

Important nuance:
- not every feature needs every layer of the stack
- internal-only capabilities do not need routes
- features with no persistence do not need repository/datastore layers
- some modules legitimately stop at the service layer

For current SQLite tables and persistence ownership, see [../AS-BUILT-ARCHITECTURE/database.md](../AS-BUILT-ARCHITECTURE/database.md).

### Key examples

- `sessions/datastores/SqliteSessionRepository.ts` — session persistence
- `infrastructure/datastores/RookDatastore.ts` — shared SQLite connection owner
- `runtime/services/AgentRuntimeManager.ts` — per-session runtime orchestration
- `environments/services/EnvironmentManager.ts` — environment lifecycle/orchestration

For current SQLite tables and persistence ownership, see [../AS-BUILT-ARCHITECTURE/database.md](../AS-BUILT-ARCHITECTURE/database.md).

### API surface

- `GET /api/health` — service health
- `GET /api/agent_runtimes` — configured runtime catalog (only explicitly declared entries)
- `GET /api/sessions` — session list + running state
- `GET /api/sessions/:sessionId/transcript` — normalized server-owned transcript hydration
- `POST /api/session/environments` — enter/leave environments for a session
- `POST /api/environments/register` — mark an environment available
- `POST /api/environments/decision` — record accept/approve/ignore/reject
- `GET /api/environments/preview` — bundle/file preview data
- `GET /api/environments/list` — per-session environment list for client UI (`displayName`, `environmentId`, status, bundle counts)
- `GET /api/diagnostics/environments` — active/recent environment diagnostics
- `GET /api/ws` — session-bound ACP WebSocket facade (`?sessionId=<public-session-id>` preferred)

### ACP WebSocket

The facade at `/api/ws` is the primary live-session interface. The intended shape is one websocket per session. A client typically discovers sessions via REST, then opens `/api/ws?sessionId=<id>` and runs `initialize`.

It implements:

- `initialize` — returns runtime catalog, default runtime, env-offer extension capability
- `session/list` — legacy/unbound-only session list (REST is preferred)
- `session/new` — creates session for a chosen runtime via `_meta.runtimeId` and `_meta.title` on an unbound websocket; on success that same websocket becomes bound to the new public session
- `session/load`, `session/resume` — loads an existing session; replay is requester-private, not broadcast to all watchers
- `session/prompt`, `session/cancel` — standard prompt flow
- `session/set_mode`, `session/set_config_option` — ACP controls
- `session/close` — closes a session
- `session/request_permission` — permission request relay
- `_com.rookkeeper/environment_offer*` — negotiated env-offer extension

### Session model

- Public session IDs are stable Rook-generated UUIDs (not runtime-derived)
- Each session maps to `runtimeId` + runtime-local `runtimeSessionId` in SQLite
- Sessions are a unified cross-runtime list ordered by `updatedAt` desc
- Session-to-environment membership persists in `session_environments`
- Transcript history persists in `session_transcript_events` so later viewers can hydrate from server state instead of forcing runtime replay

### Runtime management

`AgentRuntimeManager` lazily creates one `SessionRuntime` subprocess per active session. Provider differences (Pi, Claude, Cursor, generic ACP) are composed launch strategies in `runtimeLaunchPlan.ts`, not subclasses.

On environment change, only the affected session's runtime is restarted — the replacement process must successfully `session/load` the existing ACP session before the old process retires. A failed load never creates a fresh replacement session.

### Environment system

The environment system (registration, decision store, repository) continues to work through its existing HTTP API. `/api/environments/register` is treated as candidate registration: the server finalizes candidates asynchronously, can inspect observed path/URL implied environment ids through `EnvironmentRepository`, and only finalized environments participate in offers / approvals / runtime updates. `AgentRuntimeManager` subscribes per-session to `EnvironmentManager` and applies skill paths to runtime launch configuration. Environment offers use the negotiated `com.rookkeeper` ACP extension rather than proprietary session updates.

### Key source files

- `src/server/index.ts` — server bootstrap and wiring
- `src/server/runtime/routes/acpFacadeRoute.ts` — ACP WebSocket facade
- `src/server/runtime/routes/runtimeRoutes.ts` — `GET /api/agent_runtimes`
- `src/server/environments/routes/environmentRoutes.ts` — environment HTTP endpoints
- `src/server/runtime/services/AgentRuntimeManager.ts` — runtime catalog and per-session orchestration
- `src/server/runtime/SessionRuntime.ts` — ACP stdio subprocess lifecycle
- `src/server/runtime/runtimeLaunchPlan.ts` — provider-specific launch strategies
- `src/server/infrastructure/datastores/RookDatastore.ts` — shared SQLite connection
- `src/server/sessions/datastores/SqliteSessionRepository.ts` — session persistence
- `src/server/infrastructure/config/agentRuntimes.ts` — runtime config loader
- `src/server/agents/test-fixtures/mockAcpServer.mjs` — mock ACP runtime for testing

## Tests

```bash
npm test              # all tests
npm test -- --run     # run once (no watch)
```

Key test files:
- `src/server/runtime/acpFacade.test.ts` — ACP integration (initialize, session lifecycle, error cases)
- `src/server/infrastructure/config/agentRuntimes.test.ts` — runtime config validation
- `src/server/sessions/datastores/SqliteSessionRepository.test.ts` — session persistence
- `src/server/environments/datastores/EnvironmentDecisionStore.test.ts` — decision store
- `src/server/environments/services/EnvironmentManager.test.ts` — environment lifecycle
