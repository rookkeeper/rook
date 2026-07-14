# LEARNINGS

## Purpose of `server-next`

`server-next` is a parallel playground for rebuilding the Rook server/client stack from first principles without disturbing the current implementation. The goal is not to polish UI or preserve old server assumptions. The goal is to prove a cleaner architecture and interaction model.

## Core strategy

The new strategy is:

- `server-next` exposes one outward-facing ACP-compliant agent interface.
- Behind that interface, it manages many possible agent runtimes.
- Those runtimes are coordinated by `AgentRuntimeManager`.
- Each concrete runtime is represented by an `AgentRuntime`.

So the server is effectively a broker/meta-agent:

- outwardly: one ACP agent
- inwardly: many lazily managed ACP-capable runtimes

This is a better match for the product direction than binding the whole app to one agent instance at a time.

## `AgentRuntimeManager` and `AgentRuntime`

### `AgentRuntimeManager`

`AgentRuntimeManager` is the orchestration layer.

It is responsible for:

- loading configured runtimes
- exposing available runtime IDs
- choosing the default runtime
- creating and loading sessions
- mapping public session IDs to runtime-local session IDs
- presenting one unified session list across all runtimes
- lazily starting runtimes only when they are needed

### `SessionRuntime`

The real port should call the concrete runtime process a `SessionRuntime`: it is one ACP subprocess lifecycle for one public Rook session, not a shared process for every session using a profile.

It is responsible for:

- starting, loading, and restarting the underlying ACP subprocess for its session
- tracking that session's entered environments and effective launch configuration
- forwarding ACP requests and notifications
- tracking pending JSON-RPC requests
- serializing prompt and restart work
- surfacing runtime failure/exit conditions

`AgentRuntimeManager` is still lazy, but it lazily creates **one `SessionRuntime` per active session**. This is necessary because environment skills and startup instructions are session-specific.

Provider differences belong in composed launch/integration strategies (Pi, Claude, Cursor, generic ACP), not in a `SessionRuntime` subclass hierarchy.

## Public session model

A key learning is that the app should not treat sessions as separated by agent in the UI.

Instead:

- sessions are unified into one list
- public session IDs are stable Rook-generated UUIDs
- each session still carries runtime metadata
- creating a new session means choosing a `runtimeId`

This means the client can:

- show one combined session page
- order sessions by time
- create a new session for any runtime by referring to the runtime ID
- load an old session without needing separate per-agent tabs or silos

This mixed session model is likely to be retained in the real app.

## Server as an ACP-compliant agent

Another important learning is that the outer server should itself be ACP-compliant.

That gives us:

- one clean protocol surface for clients
- a stable transport contract
- the ability to swap or add runtimes behind the facade
- a clean distinction between client/server protocol and internal runtime implementation

This means `server-next` should keep acting like a single ACP agent even though internally it is coordinating many runtime processes.

## Config

Runtime configuration is now treated as first-class.

Current direction:

- config lives in `~/.rook/config/agent-runtimes.json`
- runtimes are identified by stable IDs
- each runtime can define type, command, args, env, cwd, and related runtime-specific settings

This is the right long-term direction because runtime choice is user configuration, not hardcoded server behavior.

One practical learning from the prototype: runtime config should prefer explicit, stable paths where needed. For example, absolute extension paths are safer than ambiguous relative paths for spawned runtimes.

## Layered architecture

The new server should move toward a clearer layered architecture:

- **API layer**: WebSocket/HTTP surface, auth boundary, ACP message handling
- **service layer**: session orchestration, runtime routing, policy decisions
- **repository layer**: persistence-facing abstractions for sessions and related records
- **datastore layer**: concrete storage implementation

This is the intended shape even if the prototype is not fully separated yet.

### Why this matters

This layering should make it easier to:

- evolve transport details without rewriting core logic
- replace flat-file persistence with a database
- test orchestration separately from protocol handling
- keep runtime process management isolated from persistence concerns

## Persistence direction

Right now the prototype uses a flat file for session records so iteration stays fast.

That is temporary.

The real implementation should use **SQLite**, consistent with the direction already used in the current server.

So the expected progression is:

- prototype: flat-file datastore
- real implementation: repository backed by SQLite

Likely persisted fields include:

- `sessionId`
- `runtimeId`
- `runtimeSessionId`
- `title`
- `cwd`
- `startedAt`
- `updatedAt`

Potentially more fields will be added later as product needs become clearer. Session-to-environment membership is also durable state: a `session_environments` table must preserve intended entered environment IDs across a server restart.

## Client learnings

The clients in `clients-next/` are intentionally spartan.

That is on purpose.

They are not trying to establish the final UI. They are only proving:

- websocket connectivity
- ACP initialization
- unified session listing
- session creation against a chosen runtime
- session loading
- prompt sending

So the current UI should be understood as a functionality test harness, not a design proposal.

What is likely to be retained is the interaction model:

- one server connection
- one combined session space
- sessions ordered by time
- ability to create a new session by choosing a runtime ID

### Environment offers as a sanctioned ACP extension

Environment offers are product events, not transcript updates. The client/server ACP boundary may use one explicitly negotiated extension under the owned reverse-domain namespace `com.the-rooks-nest`:

- `_com.the-rooks-nest/environment_offer` notification
- `_com.the-rooks-nest/environment_offer_resolve` request
- `_com.the-rooks-nest/environment_offer_resolved` notification

Support is advertised in `initialize` capability `_meta`. This replaces the old `_rookery_environment_event` fake `session/update` while retaining immediate offer presentation and resolution.

What is not yet the focus:

- polished transcript rendering
- final navigation design
- final session visuals
- toasts, error UX, and other product-grade affordances

## Summary

The main architectural learning is that Rook should move toward:

- one outward ACP-compliant server facade
- many lazily managed per-session internal runtimes
- one unified cross-runtime session space
- runtime selection at session creation time
- clear API/service/repository/datastore boundaries
- SQLite-backed persistence in the real implementation

And on the client side, the important retained idea is not the temporary UI, but the unified session model.