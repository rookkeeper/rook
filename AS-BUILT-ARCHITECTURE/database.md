# Database

## Summary

Rook's durable server-side state currently lives in one SQLite database, created by `server/src/server/datastore/RookDatastore.ts` at:

- `.var/rook/rook.sqlite` in normal local development
- `:memory:` in tests when explicitly configured

This database is intentionally small. Today it stores session persistence and durable environment decisions. Other environment state, runtime process state, subscriptions, and active/recent caches are still in memory.

## Ownership and layering

The target structure is:

- routes/API when the behavior is externally exposed
- services for orchestration and business rules
- repositories or stores for persistence-facing interfaces
- datastore for the underlying database connection

Not every feature needs every layer:
- internal-only logic does not need routes
- logic with no persistence does not need repositories/datastore access
- pure in-memory services may stop at the service layer

The direction of travel is still toward this layering, but the server is mid-transition. Some persistence-facing code still lives in domain-specific files like `environment/EnvironmentDecisionStore.ts` instead of a more uniform repository area, and some domain modules combine orchestration with storage concerns more than we ultimately want.

## Current tables

### `sessions`

Purpose:
- durable public session catalog
- mapping from public Rook session IDs to runtime-local ACP session IDs

Columns:
- `session_id TEXT PRIMARY KEY`
- `runtime_id TEXT NOT NULL`
- `runtime_session_id TEXT NOT NULL`
- `title TEXT NOT NULL`
- `cwd TEXT NOT NULL`
- `started_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Constraints and indexes:
- primary key: `session_id`
- unique constraint: `(runtime_id, runtime_session_id)`
- index: `sessions_updated_at_idx ON sessions(updated_at DESC)`

Used by:
- `SqliteSessionRepository`
- `AgentRuntimeManager`
- ACP `session/list`, `session/new`, `session/load`, `session/close`

### `session_environments`

Purpose:
- durable session-to-environment membership
- restore entered environments when a session is reloaded or its runtime is restarted

Columns:
- `session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE`
- `environment_id TEXT NOT NULL`
- `entered_at TEXT NOT NULL`

Constraints:
- primary key: `(session_id, environment_id)`
- cascade delete when the owning session is deleted

Used by:
- `SqliteSessionRepository.environmentIds(...)`
- `SqliteSessionRepository.replaceEnvironmentIds(...)`
- `AgentRuntimeManager.restoreEnvironmentMembership(...)`

### `environment_decisions`

Purpose:
- durable environment bundle decisions
- stores only persistent decisions, not per-session ephemeral ones

Columns:
- `bundle_hash TEXT PRIMARY KEY`
- `environment_id TEXT NOT NULL`
- `bundle_id TEXT`
- `decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject'))`
- `updated_at TEXT NOT NULL`

Important note:
- only `approve` and `reject` are stored here
- `accept` and `ignore` are intentionally in-memory session-scoped decisions managed by `EnvironmentManager`

Used by:
- `EnvironmentDecisionStore`
- `EnvironmentManager`
- environment offer resolution and durable approvals/rejections

## Current persistence interfaces

### `RookDatastore`

Role:
- owns the shared SQLite connection
- creates the database directory when needed
- is the lowest-level persistence primitive currently in use

### `SqliteSessionRepository`

Role:
- repository for session rows and session-environment membership
- hides SQL from the service layer

Main methods:
- `list()`
- `get(sessionId)`
- `save(record)`
- `touch(sessionId)`
- `delete(sessionId)`
- `environmentIds(sessionId)`
- `replaceEnvironmentIds(sessionId, environmentIds)`

### `EnvironmentDecisionStore`

Role:
- persistence wrapper for durable bundle decisions
- currently store-shaped rather than named as a repository, but serving the same architectural purpose

Main methods:
- `getDecision(bundleHash)`
- `setDecision(bundleHash, environmentId, bundleId, decision)`
- `clearDecision(bundleHash)`

## What is not yet in the database

Still in memory today:
- active and recent environment availability windows
- ephemeral `accept` / `ignore` decisions
- unresolved environment offers
- runtime subprocess handles
- per-session subscribers and notification routing
- environment restart queues
- location-context synthesis and most transient location state

## Current exceptions / cleanup targets

Small footnote on as-built reality:
- the intended layering is documented and partly implemented, but not fully regularized
- `SqliteSessionRepository` is a clean example of the target shape
- `EnvironmentDecisionStore` is also persistence-layer code, but it lives under `environment/` rather than a shared repository area
- some environment and location modules still mix domain logic, orchestration, and persistence-adjacent concerns more than the long-term structure should

That is acceptable for now, but these are good candidates for future cleanup as the server architecture gets more consistent.
