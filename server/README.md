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

### Layering

Target structure:
- **API layer** (`src/server/routes/`) when the capability is externally exposed
- **Service layer** (`src/server/services/`) for orchestration and business rules
- **Repository / store layer** for persistence-facing interfaces
- **Datastore layer** (`src/server/datastore/`) for the underlying database connection

Important nuance:
- not every feature needs every layer of the stack
- internal-only capabilities do not need routes
- features with no persistence do not need repository/datastore layers
- some modules legitimately stop at the service layer

As-built today, the server is only partway through this transition.

Examples:
- `SqliteSessionRepository` is a good example of the intended repository shape
- `RookDatastore` is the shared SQLite connection owner
- some environment/location code still mixes domain logic and persistence-adjacent concerns more than we ultimately want
- `EnvironmentDecisionStore` is persistence-layer code, but today it lives under `src/server/environment/` rather than a more uniform repository area

So this layering is the direction we are aiming toward, not a claim that every current module is already perfectly arranged.

For current SQLite tables and persistence ownership, see [../AS-BUILT-ARCHITECTURE/database.md](../AS-BUILT-ARCHITECTURE/database.md).

### API surface

- `GET /api/health` — service health
- `GET /api/agent_runtimes` — configured runtime catalog (only explicitly declared entries)
- `POST /api/session/environments` — enter/leave environments for a session
- `POST /api/environments/register` — mark an environment available
- `POST /api/environments/decision` — record accept/approve/ignore/reject
- `GET /api/environments/preview` — bundle/file preview data
- `GET /api/environments/list` — per-session environment list for client UI (`displayName`, `environmentId`, status, bundle counts)
- `GET /api/diagnostics/environments` — active/recent environment diagnostics
- `GET /api/ws` — connection-level ACP WebSocket facade (no session query parameter)

### ACP WebSocket

The facade at `/api/ws` is the primary client interface. It implements:

- `initialize` — returns runtime catalog, default runtime, env-offer extension capability
- `session/list` — unified cross-runtime session list with `_meta.runtimeId` and `_meta.startedAt`
- `session/new` — creates session for a chosen runtime via `_meta.runtimeId` and `_meta.title`
- `session/load`, `session/resume` — loads an existing session
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

### Runtime management

`AgentRuntimeManager` lazily creates one `SessionRuntime` subprocess per active session. Provider differences (Pi, Claude, Cursor, generic ACP) are composed launch strategies in `runtimeLaunchPlan.ts`, not subclasses.

On environment change, only the affected session's runtime is restarted — the replacement process must successfully `session/load` the existing ACP session before the old process retires. A failed load never creates a fresh replacement session.

### Environment system

The environment system (registration, decision store, repository) continues to work through its existing HTTP API. `AgentRuntimeManager` subscribes per-session to `EnvironmentManager` and applies skill paths to runtime launch configuration. Environment offers use the negotiated `com.rookkeeper` ACP extension rather than proprietary session updates.

### Key source files

- `src/server/index.ts` — server bootstrap and wiring
- `src/server/routes/acpFacadeRoute.ts` — ACP WebSocket facade
- `src/server/routes/runtimeRoutes.ts` — `GET /api/agent_runtimes`
- `src/server/routes/environmentRoutes.ts` — environment HTTP endpoints
- `src/server/services/AgentRuntimeManager.ts` — runtime catalog and per-session orchestration
- `src/server/runtime/SessionRuntime.ts` — ACP stdio subprocess lifecycle
- `src/server/runtime/runtimeLaunchPlan.ts` — provider-specific launch strategies
- `src/server/datastore/RookDatastore.ts` — shared SQLite connection
- `src/server/datastore/SqliteSessionRepository.ts` — session persistence
- `src/server/config/agentRuntimes.ts` — runtime config loader
- `src/server/agents/test-fixtures/mockAcpServer.mjs` — mock ACP runtime for testing

## Tests

```bash
npm test              # all tests
npm test -- --run     # run once (no watch)
```

Key test files:
- `src/server/acpFacade.test.ts` — ACP integration (initialize, session lifecycle, error cases)
- `src/server/config/agentRuntimes.test.ts` — runtime config validation
- `src/server/datastore/SqliteSessionRepository.test.ts` — session persistence
- `src/server/environment/EnvironmentDecisionStore.test.ts` — decision store
- `src/server/environment/EnvironmentManager.test.ts` — environment lifecycle
