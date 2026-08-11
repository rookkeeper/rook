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

That starts the backend on `http://127.0.0.1:7665` from the main checkout. When run from a Git worktree, `run-rook.sh` selects an isolated development profile with a deterministic alternate port and separate local state.

## Local profiles and state

The launcher exports `ROOK_HOME` and `ROOK_DATABASE_PATH` for the selected profile. The main checkout keeps the existing defaults (`~/.rook/` for user-local state and `~/.rook/rook.sqlite` for the application database). A worktree defaults to `~/.rook-<worktree-slug>/rook.sqlite` and uses the worktree's canonical `environment-repository/` directory. The slug includes a short hash of the canonical worktree path.

The server's user-local repository, environment-authoring bindings, and application database honor `ROOK_HOME`. Worktree slugs include a short path hash, so same-named worktrees receive separate homes. When the profile home does not exist, the launcher seeds it by copying `~/.rook`, then removes the copied application database so the development profile starts without inherited production session history; subsequent configuration changes are isolated. `ROOK_AGENT_RUNTIMES_PATH` remains available as an explicit override. When starting the server through `run-rook.sh`, use `RUN_ROOK_HOME` / `RUN_ROOK_DATABASE_PATH` rather than ambient `ROOK_HOME` / `ROOK_DATABASE_PATH` to override the selected profile paths. The environment-repository API and bundle layout are unchanged.

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

- `src/infrastructure/` — auth, config loading, path helpers, remote proxy, shared datastore bootstrap
- `src/sessions/` — session routes, repository contract, SQLite session persistence, transcript storage/helpers
- `src/runtime/` — ACP facade, runtime REST routes, subprocess transport, runtime orchestration, realtime helpers
- `src/environments/` — environment routes, services, repositories, datastores, prompt/binding/type support
  - `SQLiteEnvironmentRepository` and `EnvironmentRepositoryDatastore` are the live database-backed repository path
- `src/runtime/CapabilityWorkspaceManager.ts` — shared writable sources, per-session links, watchers, read-only projections, and generated aggregate instructions
- `src/location/` — location identification, POI providers, dwell logic, trace helpers, environment bridge helpers

Within each domain, `routes/`, `services/`, `repositories/`, and `datastores/` appear only where that domain actually needs them.

Important nuance:
- not every feature needs every layer of the stack
- internal-only capabilities do not need routes
- features with no persistence do not need repository/datastore layers
- some modules legitimately stop at the service layer

For current SQLite tables and persistence ownership, see [../AS-BUILT-ARCHITECTURE/database.md](../AS-BUILT-ARCHITECTURE/database.md).

### Key examples

- `sessions/repositories/SqliteSessionRepository.ts` — session persistence
- `infrastructure/datastores/RookDatastore.ts` — shared SQLite connection owner
- `runtime/services/AgentRuntimeManager.ts` — per-session runtime orchestration
- `environments/services/EnvironmentManager.ts` — environment lifecycle/orchestration

For current SQLite tables and persistence ownership, see [../AS-BUILT-ARCHITECTURE/database.md](../AS-BUILT-ARCHITECTURE/database.md).

### API surface

- `GET /api/health` — service health
- `GET /api/agent_runtimes` — configured runtime catalog (only explicitly declared entries)
- `GET /api/sessions` — session list + running state
- `GET /api/sessions/:sessionId/transcript` — coalesced logical server-owned transcript hydration
- `POST /api/session/environments` — enter/leave environments for a session
- `POST /api/environments/register` — mark an environment available
- `POST /api/environments/decision` — record accept/approve/ignore/reject
- `GET /api/environments/preview` — bundle/file preview data
- `GET /api/environments/search?query=...` — repository environment search
- `GET /api/bundles/search?query=...&repository=...` — repository bundle search with optional source filter
- `GET /api/environments/list` — per-session environment list for client UI (`displayName`, `environmentId`, status, bundle counts)
- `GET /api/diagnostics/environments` — active/recent environment diagnostics
- `GET /api/ws` — session-bound ACP WebSocket facade (`?sessionId=<public-session-id>` preferred)

### ACP WebSocket

The facade at `/api/ws` is the primary live-session interface. The intended shape is one websocket per session. A client typically discovers sessions via REST, then opens `/api/ws?sessionId=<id>` and runs `initialize`.

It implements:

- `initialize` — returns runtime catalog, default runtime, env-offer extension capability
- `session/new` — creates session for a chosen runtime via `_meta.runtimeId` and `_meta.title` on an unbound websocket; on success that same websocket becomes bound to the new public session
- `session/load` — loads an existing session; replay is requester-private, not broadcast to all watchers
- `session/prompt`, `session/cancel` — standard prompt flow; image-capable runtimes accept standard ACP image content blocks with per-session capability reporting and bounded base64 validation
- `session/set_mode`, `session/set_config_option` — ACP controls
- `session/close` — closes a session
- `PATCH /api/sessions/:id` — rename a session without changing its recency ordering
- `POST /api/sessions/:id/touch` — mark a session as recently viewed so it moves to the top of the recents list even without a prompt
- `DELETE /api/sessions/:id` — delete a session, its transcript, and its workspace state
- `session/request_permission` — permission request relay
- `_com.rookkeeper/environment_offer*` — negotiated env-offer extension

### Session model

- Public session IDs are stable Rook-generated UUIDs (not runtime-derived)
- Each session maps to `runtimeId` + runtime-local `runtimeSessionId` in SQLite
- Sessions are a unified cross-runtime list ordered by `updatedAt` desc
- `updatedAt` now represents both prompt activity and explicit client-side "viewed" touches, so opening/resuming a session moves it to the top
- Session-to-environment membership persists in `session_environments`
- Logical transcript history persists in `session_transcript_events` so later viewers can hydrate from server state instead of forcing runtime replay; ACP chunks are merged and in-progress records are updated in place.

### Runtime management

`AgentRuntimeManager` lazily creates one `SessionRuntime` subprocess per active session. Provider differences (Pi, Claude, Cursor, generic ACP) are composed launch strategies in `runtimeLaunchPlan.ts`, not subclasses.

On environment change, only the affected session's runtime is restarted — the replacement process must successfully `session/load` the existing ACP session before the old process retires. A failed load never creates a fresh replacement session.

### Environment system

The environment system (registration, decision store, repository) continues to work through its existing HTTP API. The live server uses three-table canonical and personal SQLite repositories plus the intentional direct project-directory adapter. `ROOK_ENVIRONMENT_REPOSITORY_DB` and `ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB` can override SQLite locations. `CapabilityWorkspaceManager` clears and reuses one project-shaped shared environment source at `~/.rook/global-workspace/` for writable SQLite sources, retains it after shutdown for inspection, links those sources into per-session workspaces under `~/.rook/agent-workspaces/`, links project files directly, and materializes immutable external content read-only. Each runtime uses its agent workspace as cwd and discovers generated `AGENTS.md` plus standard `.agents/skills` there. Pi is launched with project approval because ACP is non-interactive and cannot answer Pi's trust prompt for the generated workspace. The aggregate contains tagged environment instructions, skill-authoring guidance, and a per-environment skill inventory; environment instructions are not duplicated through launch prompt injection. Watchers persist current personal capability content, soft-delete missing writable memberships, and reconcile direct project-source changes. `/api/environments/register` is treated as candidate registration: the server finalizes candidates asynchronously, can inspect observed path/URL implied environment ids through `EnvironmentRepository`, and only finalized environments participate in offers / approvals / runtime updates. Environment offers use the negotiated `com.rookkeeper` ACP extension rather than proprietary session updates.

### Key source files

- `src/index.ts` — server bootstrap and wiring
- `src/runtime/routes/acpFacadeRoute.ts` — ACP WebSocket facade
- `src/runtime/routes/runtimeRoutes.ts` — `GET /api/agent_runtimes`
- `src/environments/routes/environmentRoutes.ts` — environment HTTP endpoints
- `src/runtime/services/AgentRuntimeManager.ts` — runtime catalog and per-session orchestration
- `src/runtime/SessionRuntime.ts` — ACP stdio subprocess lifecycle
- `src/runtime/runtimeLaunchPlan.ts` — provider-specific launch strategies
- `src/infrastructure/datastores/RookDatastore.ts` — shared SQLite connection
- `src/sessions/repositories/SqliteSessionRepository.ts` — session persistence
- `src/infrastructure/config/agentRuntimes.ts` — runtime config loader
- `src/runtime/CapabilityWorkspaceManager.ts` — shared-source, link-projection, watcher, and aggregate-instruction lifecycle
- `src/environments/repositories/SQLiteEnvironmentRepository.ts` — SQLite repository
- `src/environments/datastores/EnvironmentRepositoryDatastore.ts` — repository database connection/schema
- `src/environments/repositories/ProjectDirectoryEnvironmentRepository.ts` — direct project-file capability source
- `src/agents/test-fixtures/mockAcpServer.mjs` — mock ACP runtime for testing

## Tests

```bash
npm test              # all tests
npm test -- --run     # run once (no watch)
```

Key test files:
- `src/runtime/acpFacade.test.ts` — ACP integration (initialize, session lifecycle, error cases)
- `src/infrastructure/config/agentRuntimes.test.ts` — runtime config validation
- `src/sessions/repositories/SqliteSessionRepository.test.ts` — session persistence
- `src/environments/repositories/EnvironmentDecisionRepository.test.ts` — decision repository
- `src/environments/services/EnvironmentManager.test.ts` — environment lifecycle
