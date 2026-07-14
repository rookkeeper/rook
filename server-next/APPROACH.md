# Porting the Unified ACP Runtime Architecture to Rook

## Status and intent

This document is the approach for moving the architecture proven in `server-next/` and `clients-next/` into the real `server/` and `clients/` packages.

This is deliberately a **replacement**, not a compatibility layer. There is no external customer population that requires preserving the old agent/session API. We should remove the room-oriented, per-agent session-control architecture rather than wrapping it in new names.

The scope is intentionally narrow in one important respect:

- Preserve the environment system and its HTTP API behavior.
- Preserve health, authentication, remote proxying, native client configuration, and platform environment providers.
- Replace the agent/session API and its WebSocket implementation with one strictly ACP-compliant facade.

The first client-facing milestone is the unified session home screen. Chat rendering can retain its mature presentation while its transport and state are made strictly ACP-based.

## Confirmed target model

```text
Native clients (macOS, iPhone, Android)
             |
             | one authenticated WebSocket per client process/window
             | ACP JSON-RPC
             v
server ACP facade: GET /api/ws
             |
             v
AgentRuntimeManager (service)
  ├─ SessionService / session repository
  ├─ runtime catalog from configured agent-runtimes.json
  └─ lazy SessionRuntime instances (one per public session)
        ├─ composed Pi launch integration
        ├─ composed Claude launch integration
        ├─ composed Cursor launch integration
        └─ composed generic ACP launch integration
```

The real server becomes a single ACP-compliant agent from a client’s perspective. It is internally a broker for multiple configured runtimes.

A client does **not** connect to a session-specific WebSocket. It maintains one logical ACP connection to `server`:

- it sends `initialize` once per physical connection;
- it sends `session/list`, `session/new`, `session/load`, `session/prompt`, and other ACP methods through that connection;
- it may switch sessions without reconnecting;
- if the physical WebSocket drops, it reconnects, initializes again, refreshes the session list, and loads the selected session as needed.

## The unified session space

The existing product has an agent picker followed by a per-agent session list. That division goes away.

The opening screen in every native client becomes a **Sessions** home screen:

- one mixed list of all sessions, regardless of runtime;
- ordered by most recently updated first;
- each row shows at least title, runtime ID, and relevant timestamps;
- selecting a row loads that ACP session and opens the existing chat experience;
- a New affordance opens or reveals a small new-session form with title and configured Agent Runtime selection.

Creating a session selects a runtime ID, but runtime selection does not create a UI silo. Runtime is session metadata, not navigation structure.

Public session IDs are stable Rook-generated UUIDs. The persisted record maps that durable identity to `runtimeId` and the runtime-local ACP `runtimeSessionId`.

The session record persists the public ID plus `runtimeId`, `runtimeSessionId`, title, cwd, `startedAt`, and `updatedAt`. ACP does not provide a general `startedAt`; Rook owns and stores that field.

## Server API target

### Retain unchanged

These remain normal authenticated HTTP endpoints and retain their existing behavior:

- `GET /api/health`
- environment registration, preview, decision, entry/exit/list, location identification/registration, and diagnostics routes
- bearer authentication boundary
- loopback listener and remote proxy behavior

The environment subsystem remains a Rook service. It is not replaced by ACP and does not become a client-side concern.

### Replace

Remove the current agent/session control-plane endpoints:

- `GET /api/agents`
- `GET /api/agent/sessions?agent=...`
- `GET /api/agent/session/recent`
- `POST /api/agent/start`

Replace agent enumeration with:

- `GET /api/agent_runtimes`

`GET /api/agent_runtimes` returns **only explicitly configured runtimes**. It must not expose implicit parent/base definitions such as `PiAgent`, `ClaudeAgent`, `CursorAgent`, or mock agents. A user who wants vanilla Pi, Claude Code, or Cursor must declare it in `~/.rook/config/agent-runtimes.json`.

The endpoint is useful for native UI presentation and diagnostics, but session listing and creation are ACP operations, not REST operations.

### Recreate `GET /api/ws`

Delete the current query-bound route:

```text
GET /api/ws?sessionId=<id>
```

Recreate it as an authenticated, connection-level ACP endpoint:

```text
GET /api/ws
```

It must not require a session query parameter and must not bind the socket to one room. The API layer only owns WebSocket lifecycle, authentication, JSON-RPC parsing, and dispatch to the session/runtime service.

## Required outward ACP behavior

The facade must implement and route standard ACP operations appropriate to its declared capabilities:

- `initialize`
- `session/list`
- `session/new`
- `session/load`
- `session/resume` where supported by the underlying runtime
- `session/prompt`
- `session/cancel`
- `session/set_mode`
- `session/set_config_option`
- `session/close`
- standard ACP permission request/response relay
- standard `session/update` notification relay

Runtime selection for `session/new` belongs in the sanctioned extensibility field:

```json
{
  "cwd": "/path/to/workspace",
  "mcpServers": [],
  "_meta": {
    "runtimeId": "MyPiOpenAiAgent",
    "title": "Investigate sync failure"
  }
}
```

`session/list` returns one flat list. Rook-owned session metadata is attached through `_meta`, for example `runtimeId` and `startedAt`; the standard session summary fields remain standard ACP fields.

The server must rewrite runtime-local IDs to public IDs on outgoing messages and rewrite public IDs back to runtime-local IDs before forwarding to a runtime. Runtime-local IDs must never be used as client routing keys.

## Strict ACP boundary: remove these concepts

The chat connection must be 100% ACP-compliant. Do not retain Rookery-specific messages as a temporary compatibility path.

### Remove custom JSON-RPC method

- `_rookery/steering_prompt`

The UI’s “Send now” / mid-run steering behavior is removed. A message sent while a run is active remains a queued normal `session/prompt`; cancel remains standard ACP `session/cancel`.

### Remove Rookery-only ACP session updates

These must not be sent over the client/server ACP connection:

- `_rookery_run_completed`
- `_rookery_run_failed`
- `_rookery_assistant_message_completed`
- `_rookery_status_changed`
- `_rookery_protocol_error`
- `_rookery_connection_error`
- `_rookery_modes_state`
- `_rookery_tool_input_delta`
- `_rookery_tool_call_ready`
- `_rookery_tool_output_delta`
- `_rookery_environment_event`

Completion and errors come from the JSON-RPC response to the standard ACP request. Standard `session/update` types drive transcript state. Runtime stderr and transport diagnostics belong in logs; product-grade client error presentation can later be a normal toast/banner, not a fabricated ACP update.

### Remove room-centric session transport

Delete rather than adapt:

- `SessionRoom`
- `SessionRoomManager`
- `RoomEventStream`
- `EnvironmentSessionState`
- `roomRuntime.ts`
- `/api/agent/start` room creation/reuse logic
- WebSocket `sessionId` query binding and room subscription lifecycle

### Remove old runtime inheritance/discovery layer

The target runtime process abstraction is `SessionRuntime`, not `BaseAgent`. A `SessionRuntime` is created lazily per public session and uses a composed provider integration rather than provider subclasses. Delete rather than preserve:

- `BaseAgent`
- `PiAgent`
- `ClaudeAgent`
- `CursorAgent`
- `MockAgent` and its special runtime path
- `agentDiscovery.ts` and its built-in parent registry
- JSONL `sessionLog.ts` as the source of truth for agent sessions

The new config can retain `parentId` as descriptive lineage/metadata if useful, but it is not runtime discovery and does not cause implicit base runtimes to appear.

## Environment preservation without ACP extensions

The environment system is valuable and must continue to work. The old implementation couples it to `SessionRoom` so it can rebuild a `BaseAgent` and broadcast `_rookery_environment_event` updates. That coupling must be replaced, not removed as product behavior.

Introduce an environment-facing service interface owned by the new session/runtime service, conceptually:

```text
EnvironmentManager
  -> AgentRuntimeManager (internal subscription per session)
      -> SessionRuntime for that public session
```

`AgentRuntimeManager` is responsible for the existing semantics:

- subscribe/unsubscribe a session to environment availability;
- accept one explicit non-ACP API request containing the session ID plus environment IDs to enter and leave;
- apply accepted/approved environment skill paths to only that session’s runtime configuration;
- start a replacement `SessionRuntime` process and successfully `session/load` its current ACP session before stopping the old process;
- treat a failed `session/load` as an error; never silently create a replacement ACP session and lose session state;
- retain existing environment decision rules, environment list behavior, location registration behavior, and HTTP route contracts.

The adapter must not emit Rookery-specific `session/update` messages. Environment offer UI uses one explicitly negotiated ACP extension under the owned reverse-domain namespace `com.the-rooks-nest`, not a fake chat update:

- `_com.the-rooks-nest/environment_offer` notification
- `_com.the-rooks-nest/environment_offer_resolve` request
- `_com.the-rooks-nest/environment_offer_resolved` notification

Support is advertised in `initialize` capability `_meta`. Offers are stored per session and replayed after reconnect/load for capable clients. Explicit environment membership remains a normal HTTP API; future agent tools call the same service method.

This is the primary migration risk. It needs dedicated tests proving that environment entry/exit and restart behavior still work for Pi, Claude, Cursor, and generic ACP runtimes.

## Layered server architecture

The port is an opportunity to make the real server follow the intended layers explicitly.

### API layer

Suggested location: `server/src/server/api/` or clearly named route modules.

Responsibilities:

- Fastify route registration
- HTTP/WebSocket authentication boundary
- JSON-RPC framing and protocol-level validation
- ACP response/error serialization
- existing environment REST routes

The ACP WebSocket handler must contain no runtime spawning, persistence queries, or environment policy.

### Service layer

Suggested location: `server/src/server/services/`.

Responsibilities:

- `AgentRuntimeManager`: lazy runtime catalog and one-`SessionRuntime`-per-session lifecycle
- `SessionService`: public session ID routing, session creation/load/list/update, ordered unified list
- environment/session coordination owned directly by `AgentRuntimeManager`, which subscribes to `EnvironmentManager` internally
- any narrow configuration service needed to expose explicitly configured runtime definitions

This layer owns policy and orchestration.

### Repository layer

Suggested location: `server/src/server/repositories/`.

Responsibilities:

- `SessionRepository` interface and SQLite implementation
- existing environment decision repository/store boundary, preserved or moved behind the same convention

The service layer must depend on repository interfaces rather than SQL statements or file paths.

### Datastore layer

Suggested location: `server/src/server/datastore/`.

Responsibilities:

- SQLite connection/setup/migration ownership
- transaction and schema initialization

The real implementation uses SQLite, consistent with the current server’s environment-decision datastore. The `server-next` JSON flat file was a prototype expedient only; it is not the target for the real server.

A likely `sessions` table includes:

```text
session_id           TEXT PRIMARY KEY   -- public <runtime>:<runtime-session>
runtime_id           TEXT NOT NULL
runtime_session_id   TEXT NOT NULL
name                 TEXT NOT NULL
cwd                  TEXT NOT NULL
started_at           TEXT NOT NULL
updated_at           TEXT NOT NULL
```

Use an index on descending `updated_at` for the home screen query. Define uniqueness for `(runtime_id, runtime_session_id)`.

## Runtime configuration migration

Replace the current profile source and naming:

```text
~/.rook/config/agent-profiles.json
```

with:

```text
~/.rook/config/agent-runtimes.json
```

The config loader validates configured concrete runtimes. It does not synthesize defaults. Its supported initial fields should include at least:

- `id`
- `type`: `pi`, `claude`, `cursor`, or generic `acp`
- `parentId` as optional descriptive metadata
- `command`
- `args`
- `env`
- `cwd`
- `model`
- runtime-specific options already needed by Pi/Claude/Cursor

Where spawned commands need file paths, document and prefer explicit absolute paths. The Pi prototype demonstrated that an incorrect relative extension path can cause `pi-acp` to report only the secondary “stream was destroyed” error after Pi exits.

## Client migration

### Shared principle

The native clients should preserve the current mature chat UI:

- user and assistant blocks
- streaming text
- thinking blocks
- tools
- permissions
- plans
- usage
- modes/config options where supported by ACP
- cancel
- queued ordinary messages
- environment screens and platform environment providers

The transport/reducer changes; the chat’s visual language does not need to be rebuilt.

### Shared Swift client (`clients/RookKit`)

Replace the current session-bound `AcpSocket` contract:

```text
connect(sessionId:, request: /api/ws?sessionId=...)
```

with a connection-level ACP socket that:

- connects to `/api/ws`;
- initializes once per physical connection;
- owns request IDs and pending request continuations for every ACP method;
- routes updates by their `sessionId`;
- reconnects after a transport close and reinitializes as a new ACP connection;
- does not silently recreate or start sessions outside ACP;
- removes `sendSteeringMessage`.

Move session listing, new-session creation, and loading from `RookAPI` REST calls to the ACP socket/client service. Keep `RookAPI` for health and environment REST operations.

Update `AgentSessionSummary` to the unified ACP session summary plus Rook `_meta` fields, rather than old `AgentSessionRecord` JSON from `/api/agent/start`.

### macOS

The current root navigation uses `PanelMode.home`, `.sessions(agentId:)`, and `.chat`. Replace the agent picker/per-agent session navigation with one sessions home panel.

The former `RookView`/home composition should show the unified list and New form. It should no longer render `agentTree` or call `openAgentSessions(_:)`.

The chat remains `ChatView` and uses the shared ACP socket. Remove the queued-message “Send now” control and any calls to the steering extension.

### iPhone

`AgentPickerScreen` becomes the sessions home experience. The `selectedAgentId` state and `SessionsScreen(model:agentId:)` division go away.

The new-session form selects a title and configured runtime. `ChatScreen` remains visually familiar, but only invokes standard ACP methods over the one connection.

### Android

Apply the same state-machine change to `RookViewModel`, `RookApp`, `AgentPickerScreen`, `SessionsScreen`, `RookApi`, and `AcpSocket`:

- no `_selectedAgentId`
- no REST agent-session lifecycle methods
- one ACP connection
- unified ACP `session/list`
- new session via ACP `session/new` with `_meta.runtimeId` and title
- session load via ACP `session/load`
- remove `sendSteeringMessage` and UI affordances that call it

The existing Compose chat blocks can remain and should continue mapping standard ACP updates.

## Migration sequence

Do this in coherent vertical slices; do not leave protocol compatibility shims behind.

1. **Write contract tests first.** Define tests for `initialize`, explicit runtime enumeration, unified `session/list`, `session/new`, `session/load`, prompt, cancel, permission relay, reconnect, and no `_rookery` client/server messages.
2. **Introduce SQLite session repository and schema.** Migrate no old session data automatically unless separately decided; old JSONL session records are not a compatible source of stable Rook session IDs.
3. **Add runtime config loader and composed runtime integrations.** Port the manager approach as one lazy `SessionRuntime` per public session, including restart-safe `session/load`, public-ID rewriting, and runtime exit handling.
4. **Build the service layer.** Attach `AgentRuntimeManager` directly to `EnvironmentManager` before touching the public route. Add the explicit session-environment API that supplies enter/leave lists.
5. **Replace agent/session routes and `/api/ws` in one server cutover.** Delete room code, legacy agent API, BaseAgent hierarchy, steering, and Rookery ACP updates in the same change.
6. **Port RookKit transport and unified session state.** Keep health/environment REST services intact.
7. **Port macOS, iPhone, and Android home/session navigation.** Each gets the same unified list and title/runtime New flow.
8. **Reconnect and environment regression tests.** Verify an interrupted physical socket reconnects without creating a new logical session, and verify environment actions retain their behavior without custom ACP updates.
9. **Update architecture/product docs.** Update `PRODUCT/AS-BUILT-ARCHITECTURE.md`, `PRODUCT/agent-client-protocol.md`, root README, server README, and client READMEs to remove room/steering language and document the unified model.

## Explicit non-goals for the first port

- A redesigned chat UI
- New transcript rendering concepts
- Toast/error UX polish
- Automatic migration of old JSONL session records
- Compatibility support for old session REST endpoints or old WebSocket query semantics
- Reintroducing custom ACP methods/updates as shortcuts for environment or runtime state

## Additional learnings during port

### CLI client as a debugging tool

A minimal Node.js CLI client (`clients/cli/`) proved invaluable for rapid iteration:

- `rook exec --runtime <id> <prompt>` — one-shot turns against any configured runtime
- `rook exec --sessionId <id> <prompt>` — resume and extend an existing session
- `rook sessions` — list all sessions with metadata
- `rook --transcript --sessionId <id>` — dump the raw ACP session transcript
- `--title` enables named sessions for easy identification in the native clients
- `--last-message-only` suppresses streaming output, useful for scripting

The CLI talks ACP directly — no native UI rebuilds needed. Combined with the configured `MockAcpAgent` runtime (which stores transcripts and replays on load), it enables fast test-driven debugging of server behavior, ACP message routing, and session state before touching any native client code.

### Session replay: clear-before-load, not after

When a native client resumes a session via `session/load`, the runtime may stream session history as `session/update` notifications. If the client clears its chat blocks AFTER `session/load` returns (the natural tendency in an `enterChat`-style helper), the replayed history is wiped.

The correct pattern: clear state BEFORE `session/load`, buffer incoming replay events separately from active-turn streaming state (so user/assistant/thinking/tool sections remain distinct blocks, not merged streaming blocks), and keep `isRunning = false` during replay so the UI status indicator stays "Ready."

## Definition of done

The port is complete when:

1. The actual server exposes one authenticated ACP WebSocket facade at `/api/ws` with no session query binding.
2. Only configured runtime entries are exposed by `GET /api/agent_runtimes`.
3. Session list/new/load/prompt are ACP-only and work across Pi, Claude, Cursor, and generic configured runtimes.
4. Sessions are persisted in SQLite and returned as one time-ordered cross-runtime list.
5. macOS, iPhone, and Android open on that unified sessions home screen and create sessions by runtime ID.
6. Existing chat UX remains, but no client/server steering method or `_rookery_*` session update remains on the ACP boundary.
7. Environment HTTP behavior and platform providers continue to work, with environment-to-runtime coordination behind the service layer.
8. The old SessionRoom and BaseAgent architecture is deleted, not retained for fallback.
