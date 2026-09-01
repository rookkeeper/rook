# Database

## Summary

Rook's durable server state is split across SQLite databases:

- the application database stores sessions, session membership, and durable environment decisions;
- the canonical environment repository database stores curated environment/capability content;
- the user-local environment repository database stores both writable personal content and
  website-scouted content; bundle publishers distinguish their ownership.

The application database remains separate from environment repositories. This database is intentionally small: it stores session persistence, session membership, and durable environment decisions. Runtime processes, ACP session history, active/recent environment caches, subscribers, and workspace projections remain outside this database. By default it lives under `ROOK_HOME/rook.sqlite` (`~/.rook/rook.sqlite` for the main checkout and `~/.rook-<worktree-slug>/rook.sqlite` for development worktrees), with `ROOK_DATABASE_PATH` as an explicit override.

For session recency, `sessions.updated_at` represents both prompt activity and explicit client-side view/touch events. The sessions table also stores `attention_status`, a CHECK-constrained enum of `clear`, `ready`, or `error`, plus durable `pinned` and `pinned_order` metadata. Active-turn state and view presence remain transient server state; the API combines them with the durable enum to return `activityStatus` as `active`, `ready`, `error`, `on`, or `off`. Pinning and pinned reordering do not change `updated_at`; newly pinned sessions append to the pinned order, and unpinning compacts the remaining order.

## Application database schema

The application database is created by `RookDatastore`, `SqliteSessionRepository`, and `EnvironmentDecisionRepository` in the same SQLite file:

### `sessions`

- `session_id TEXT PRIMARY KEY`
- `runtime_id TEXT NOT NULL`
- `runtime_session_id TEXT NOT NULL`
- `title TEXT NOT NULL`
- `cwd TEXT NOT NULL`
- `started_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `attention_status TEXT NOT NULL` — `clear`, `ready`, or `error`
- `pinned INTEGER NOT NULL` — `0` or `1`
- `pinned_order INTEGER NOT NULL`
- unique `(runtime_id, runtime_session_id)`

### `session_environments`

- `session_id TEXT NOT NULL` — cascading foreign key to `sessions`
- `environment_id TEXT NOT NULL`
- `entered_at TEXT NOT NULL`
- primary key `(session_id, environment_id)`

### `environment_decisions`

- `bundle_hash TEXT PRIMARY KEY`
- `environment_id TEXT NOT NULL`
- `bundle_id TEXT NOT NULL`
- `decision TEXT NOT NULL` — `approve` or `reject`
- `updated_at TEXT NOT NULL`

Only permanent decisions are stored here. Session-scoped `accept` and `ignore` decisions are held in `SessionDecisionRegistry` memory and expire on session/environment lifecycle events.

## Environment repository schema

Every environment repository database has the same three tables. The user-local database has
one `personal` repository projection that serves both user- and site-published bundles.

### `environments`

- `environment_id TEXT PRIMARY KEY` — canonical environment identifier.
- `display_name TEXT NOT NULL` — UI name.
- `description TEXT NOT NULL` — environment description.
- `metadata_json TEXT NOT NULL DEFAULT '{}'` — serialized discovery metadata.

There is exactly one row per environment id. User-authored display metadata and scout state
therefore coexist on the same `web:<host>` row.

### `capabilities`

- `capability_id TEXT PRIMARY KEY` — UUID identifying reusable capability content.
- `type TEXT NOT NULL` — `skill`, `instructions`, `llms-txt`, `facts`, `mcp`, or `app`.
- `name TEXT NOT NULL` — human-readable/source name used for display and authoring paths.
- `files_json TEXT NOT NULL` — complete nested file map for the capability.
- `content_hash TEXT NOT NULL` — hash of the capability file map.

A skill stores all of its files, including `SKILL.md`, scripts, references, and assets. Instructions, `llms.txt`, facts, MCP content, and app content use the same file-map shape.

### `bundles`

The bundle table is the environment/capability membership table:

- `bundle_id TEXT NOT NULL` — UUID grouping one atomic bundle.
- `environment_id TEXT NOT NULL` — owning environment identifier.
- `capability_id TEXT NOT NULL` — referenced capability, foreign key to `capabilities`.
- `publisher TEXT NOT NULL DEFAULT 'default'` — ownership discriminator. Existing personal
  paths keep their publisher; the scout writes the normalized host.
- `deleted_at TEXT NULL` — membership tombstone; a timestamp means the capability is deleted from this bundle/environment.

Primary key:

```text
(bundle_id, capability_id)
```

A capability can be referenced by memberships in multiple environments. Deleting one membership does not delete shared capability content. There are no revision tables, revision pointers, or persistent empty personal bundles.

### Web scout state

The scout writes into the personal repository's user-local
`<ROOK_HOME>/environment-repository.db`. The single `environments` row for a host stores
`fetched_at`, `status`, pass `errors`, and per-resource `etag` / `last_modified` validators
under `metadata_json.scout`. Content uses one bundle (`site`, publisher = host) per
environment. Empty and failed hosts keep their environment row for negative caching, but
rows without any live bundle memberships are omitted from listings and search. A refresh
replaces or removes only memberships whose publisher is that host; publishers such as
`default` are untouched. An error scout leaves previous content and validators in place.
`WebEnvironmentScoutStore.recordScout` is the only scout writer and preserves user-authored
display text.

## Repository layering

- `EnvironmentRepositoryDatastore` owns the SQLite connection and three-table schema.
- `SQLiteEnvironmentRepository` reads and writes normalized rows and projects publisher plus
  the derived `scoutPublished` flag into the bundle-facing `EnvironmentBundle` model.
- `WebEnvironmentScoutStore` owns metadata-backed scout state, host guards, and transactional,
  publisher-scoped `recordScout` updates; it is not a repository projection.
- `CompositeEnvironmentRepository` combines canonical, personal, project-directory, and
  synthetic repositories; the live synthetic source is `LocationContextRepository`.
- `EnvironmentRepositoryService` resolves bundles, calculates atomic bundle hashes, exposes search/preview, and routes capability write/delete/restore operations.

The API remains bundle-oriented even though storage is capability-oriented. Instructions and `llms.txt` are projected into `agentsMd` and `llmsTxt`; skills, facts, MCP, and apps are projected into their corresponding collections.

## Hashing and approval

Rook derives one deterministic bundle hash from the active capability memberships and their file content. Durable approve/reject decisions in the application database continue to use that bundle hash. Changing capability content or membership changes the hash; filesystem paths do not participate.

## Workspace projection

Writable personal content is materialized once per environment:

```text
<ROOK_HOME>/global-workspace/writable/<environment-key>/
├── AGENTS.md
└── .agents/skills/<skill-name>/
```

The default personal repository database is `~/.rook/environment-repository.db`, independent of `ROOK_HOME`; `ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB` can point it at a profile-specific file. The canonical repository defaults to `<checkout>/environment-repository.db`.

Each session receives disposable links:

```text
<ROOK_HOME>/agent-workspaces/<session-id>/
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── .agents/
│   ├── editable-per-environment/<environment> -> shared environment directory
│   └── skills/<visible-name>                  -> shared skill source
└── .claude/
    └── skills -> ../.agents/skills
```

`AGENTS.md` at the workspace root is a generated read-only aggregate. The `CLAUDE.md` and `.claude/skills` entries are relative symlink aliases for Claude Code runtimes, which auto-load `CLAUDE.md` and discover project skills only under `.claude/skills`. The individual instruction and skill sources are the editable paths. Canonical/external content is materialized read-only, while project-directory content links directly to project files.

The global watcher debounces settled shared-source changes, persists current file maps, recognizes missing writable source entries as membership deletion, and refreshes active session projections. Rebuild, startup cleanup, and session disposal are excluded from deletion inference.
