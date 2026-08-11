# Database

## Summary

Rook's durable server state is split across SQLite databases:

- the application database stores sessions, transcripts, session membership, and durable environment decisions;
- the canonical environment repository database stores curated environment/capability content;
- the personal environment repository database stores writable user content.

The application database remains separate from environment repositories. This database is intentionally small: it stores session persistence and durable environment decisions. Runtime processes, active/recent environment caches, subscribers, and workspace projections remain transient. By default it lives under `ROOK_HOME/rook.sqlite` (`~/.rook/rook.sqlite` for the main checkout and `~/.rook-<worktree-slug>/rook.sqlite` for development worktrees), with `ROOK_DATABASE_PATH` as an explicit override.

For session recency, no extra table or column was added: the existing `sessions.updated_at` field now represents both prompt activity and explicit client-side view/touch events, so opening a session can reorder the shared recents list without synthesizing transcript content.

## Session transcript persistence

`session_transcript_events` stores logical transcript records rather than one row per ACP transport chunk. Contiguous user, assistant, and thought chunks are merged; tool-call updates are merged by `toolCallId` into the tool record's arguments, status, and accumulated output; plan and usage records are replaced by their latest update within a section. The current in-progress record is updated in place so a second client can hydrate a running session without waiting for the turn to finish.

The REST transcript response retains the normalized event shape consumed by clients, but its events are already coalesced. On the first server startup after this format change, the transcript-only migration clears legacy chunk-level rows once; sessions and all non-transcript application data remain intact. A migration marker prevents the reset from recurring.

## Environment repository schema

Each environment repository database has exactly three tables.

### `environments`

- `environment_id TEXT PRIMARY KEY` — canonical environment identifier.
- `display_name TEXT NOT NULL` — UI name.
- `description TEXT NOT NULL` — environment description.
- `metadata_json TEXT NOT NULL DEFAULT '{}'` — serialized discovery metadata.

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
- `environment_id TEXT NOT NULL` — owning environment, foreign key to `environments`.
- `capability_id TEXT NOT NULL` — referenced capability, foreign key to `capabilities`.
- `publisher TEXT NOT NULL DEFAULT 'default'` — publisher metadata.
- `deleted_at TEXT NULL` — membership tombstone; a timestamp means the capability is deleted from this bundle/environment.

Primary key:

```text
(bundle_id, capability_id)
```

A capability can be referenced by memberships in multiple environments. Deleting one membership does not delete shared capability content. There are no revision tables, revision pointers, or persistent empty personal bundles.

## Repository layering

- `EnvironmentRepositoryDatastore` owns the SQLite connection and three-table schema.
- `SQLiteEnvironmentRepository` reads and writes normalized rows and projects them into the bundle-facing `EnvironmentBundle` model.
- `CompositeEnvironmentRepository` combines canonical, personal, project-directory, and synthetic repositories.
- `EnvironmentRepositoryService` resolves bundles, calculates atomic bundle hashes, exposes search/preview, and routes capability write/delete/restore operations.

The API remains bundle-oriented even though storage is capability-oriented. Instructions and `llms.txt` are projected into `agentsMd` and `llmsTxt`; skills, facts, MCP, and apps are projected into their corresponding collections.

## Hashing and approval

Rook derives one deterministic bundle hash from the active capability memberships and their file content. Durable approve/reject decisions in the application database continue to use that bundle hash. Changing capability content or membership changes the hash; filesystem paths do not participate.

## Workspace projection

Writable personal content is materialized once per environment:

```text
~/.rook/global-workspace/writable/<environment-key>/
├── AGENTS.md
└── .agents/skills/<skill-name>/
```

Each session receives disposable links:

```text
~/.rook/agent-workspaces/<session-id>/
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
