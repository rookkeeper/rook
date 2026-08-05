# Database

## Summary

Rook's durable server-side state is split across SQLite databases with different ownership:

- the application database, created by `server/src/infrastructure/datastores/RookDatastore.ts`:
  - `.var/rook/rook.sqlite` in normal local development
  - `:memory:` in tests when explicitly configured
- the canonical environment repository database:
  - `environment-repository.db` in the repository by default
- the personal environment repository database:
  - `~/.rook/environment-repository.db` by default

The application database stores sessions, transcripts, session-environment membership, and user decisions. Repository databases store environments, bundles, content revisions, and capability artifacts. Runtime process state, subscriptions, and active/recent environment caches remain in memory.

## Ownership and layering

The server is now organized **primarily by domain**. Within a domain, layering appears only where it is actually needed:

- routes/API when the behavior is externally exposed
- services for orchestration and business rules
- repositories or stores for persistence-facing interfaces
- datastores for the underlying database connection or concrete persistence backend

Not every feature needs every layer:
- internal-only logic does not need routes
- logic with no persistence does not need repositories/datastores
- pure in-memory services may stop at the service layer

As built today:
- `infrastructure/datastores/RookDatastore.ts` owns the application SQLite connection
- `environments/datastores/EnvironmentRepositoryDatastore.ts` owns one environment-repository SQLite connection
- `sessions/repositories/SqliteSessionRepository.ts` owns session/session-environment SQL
- `environments/repositories/EnvironmentDecisionRepository.ts` owns durable environment-decision SQL in the application database
- `sessions/repositories/SessionTranscriptRepository.ts` owns transcript-event SQL
- `environments/repositories/SQLiteEnvironmentRepository.ts` owns repository content queries, revisions, and artifact write-back

The `*Datastore` classes provide concrete SQLite connections and schema bootstrap. Repository implementations directly execute SQL against those connections; there is no additional query abstraction between repositories and SQLite.

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

### `session_transcript_events`

Purpose:
- durable append-only normalized transcript history per session
- lets second viewers hydrate from server state without asking the runtime to replay again

Columns:
- `sequence INTEGER PRIMARY KEY AUTOINCREMENT`
- `session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE`
- `created_at TEXT NOT NULL`
- `event_json TEXT NOT NULL`

Indexes:
- `session_transcript_events_session_idx ON session_transcript_events(session_id, sequence ASC)`

Used by:
- `SessionTranscriptRepository`
- session transcript hydration route
- live runtime-notification normalization in `AgentRuntimeManager`

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
- `EnvironmentDecisionRepository`
- `EnvironmentManager`
- environment offer resolution and durable approvals/rejections

## Environment repository tables

These tables live in each environment repository database, not in the application database.

### `environment_repository_environments`

Catalog of repository-known environments and their display metadata.

### `environment_repository_bundles`

Bundle identity and current revision pointer:

- `bundle_key` primary key
- `repository_id`
- `environment_id` foreign key to the repository environment
- `bundle_id`
- validity and serialized repository read errors
- `current_revision_key`
- unique `(repository_id, environment_id, bundle_id)`

### `environment_repository_bundle_revisions`

Immutable fetched content snapshots:

- `revision_key` primary key
- `bundle_key` foreign key
- `content_hash`
- optional `publisher_version`
- required `fetched_at`
- optional `source_locator`
- serialized `provenance_json`
- unique `(bundle_key, content_hash)`

The current bundle row points at one revision, while older revisions remain available for exact-hash history.

### `environment_repository_revision_artifacts`

Capability artifact content belonging to one revision:

- `revision_key`
- `artifact_kind` (`skills`, `mcp-servers`, `apps`, `facts`, or `llms-txt`)
- `artifact_id`
- `files_json` containing the complete nested file map
- primary key `(revision_key, artifact_kind, artifact_id)`

Skills retain their complete nested file map; MCP, app, fact, and `llms.txt` artifacts use the same representation for now. Bundle instructions remain on the bundle row because they are the generated-instruction source field.

## Current persistence interfaces

### `RookDatastore`

Role:
- owns the application SQLite connection
- creates the database directory when needed
- stores sessions, transcript events, session membership, and durable approve/reject decisions

It is intentionally separate from canonical and personal environment repository databases.

### `SqliteSessionRepository`

Role:
- repository for session rows and session-environment membership
- hides SQL from the rest of the session/runtime orchestration code

Main methods:
- `list()`
- `get(sessionId)`
- `save(record)`
- `touch(sessionId)`
- `delete(sessionId)`
- `environmentIds(sessionId)`
- `replaceEnvironmentIds(sessionId, environmentIds)`

### `SessionTranscriptRepository`

Role:
- append-only repository for normalized transcript events
- directly executes transcript SQL against the application SQLite connection

Main methods:
- `append(sessionId, event, createdAt?)`
- `list(sessionId)`
- `clear(sessionId)`

### `EnvironmentDecisionRepository`

Role:
- repository for durable bundle decisions
- directly executes decision SQL against the application SQLite connection

Main methods:
- `getDecision(bundleHash)`
- `setDecision(bundleHash, environmentId, bundleId, decision)`
- `clearDecision(bundleHash)`

## Repository write-back and projections

`SQLiteEnvironmentRepository` writes changed personal skill or instruction content by creating/updating the current revision and recalculating the content hash. `CapabilityWorkspaceManager` owns the server-mediated persistence boundary: it watches one process-wide writable SQLite materialization at `~/.rook/global-workspace/`, serializes settled source changes, and performs a final assessment before session/server shutdown. The directory is cleared at startup and retained after shutdown for inspection. New skills become artifacts when `SKILL.md` appears in an explicit environment authoring directory.

Canonical and personal repository content is SQLite-only. Passive environment registration does not create empty personal bundles; explicit entry creates the personal authoring bundle when needed. Project-directory sources are intentional direct file-backed exceptions: they use bundle ID `directory`, are watched at their actual paths, and never receive personal SQLite bundles. Immutable canonical/external content is materialized read-only directly into session workspaces. The filesystem permissions are an accidental-write boundary, not a strong security sandbox against an agent with arbitrary same-user shell access.

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
- the server now has a clearer domain-first organization
- persistence naming is still intentionally mixed between `Repository` and `Store` where the existing behavior and public understanding were preserved
- some environment and location modules still mix domain logic, orchestration, and persistence-adjacent concerns more than the long-term structure might eventually want

That is acceptable for now because the refactor preserved behavior, APIs, and schema while improving navigability.
