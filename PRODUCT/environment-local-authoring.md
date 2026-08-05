# Environment-local authoring

Rook can learn environment-specific skills and instructions from the user. SQLite is the durable source for personal content; a project directory is the durable source for a `dir:` environment.

## Ownership

Non-directory environments may receive one user-owned `personal` bundle in the personal SQLite repository. Passive environment registration does not create it; explicit entry creates the empty authoring bundle when needed. It is revisioned and hashed but bypasses approval.

A `dir:` environment does **not** receive an SQLite personal bundle. Its project bundle is named `directory`; project-owned skills live under `.agents/skills/` and project instructions live in the project-root `AGENTS.md`.

## Workspace topology

At server startup Rook clears and recreates the process-wide workspace at `~/.rook/global-workspace/` for writable SQLite materializations. It is rebuildable from SQLite and retained after shutdown for inspection; the next startup clears it again.

Each runtime uses a separate agent workspace as its process and ACP working directory:

```text
~/.rook/agent-workspaces/<session-id>/
├── AGENTS.md                                      generated, read-only aggregate
└── .agent/
    ├── skills/<skill-name>                         normal skill link or read-only external materialization
    ├── editable-skills/<environment-nickname>/     explicit authoring location
    ├── AGENTS_FILES/<environment-nickname>/AGENTS.md
    └── mcp-servers/                                read-only review projection
```

Existing writable SQLite skills are linked into both `skills/` and their environment-specific `editable-skills/` directory, pointing to one shared global file tree under `~/.rook/global-workspace/`. Existing project skills and instructions are linked directly to their project files. Immutable external content is materialized directly and read-only into each agent workspace; it does not enter the writable global workspace.

The aggregate `AGENTS.md` is generated and read-only. It contains each environment’s source text and concrete relative paths to the linked instruction file and authoring directory. The individual file is the source to edit, never the aggregate.

## Authoring and persistence

A new skill is created in:

```text
.agent/editable-skills/<environment-nickname>/<skill-name>/SKILL.md
```

Its parent identifies ownership. `SKILL.md` makes the skill real. A completed personal skill is persisted to SQLite and linked into `.agent/skills/`. A completed project skill is written to `.agents/skills/` in the project and then linked directly from the workspace. Empty skill directories and empty instruction placeholders do not create durable content.

Rook watches shared SQLite files and active project source roots. It debounces writes, serializes changed personal files as new SQLite revisions, regenerates affected aggregate instructions, and retries at the next assessment if persistence fails. Project edits remain project edits and never enter SQLite.

The server performs a final source assessment before closing a session or shutting down. Closing a session removes only its disposable links; it does not remove shared global sources needed by other sessions.

## Current safety boundary

Canonical/external projections are read-only by filesystem policy. Same-user filesystem permissions are not a strong defense against an agent with arbitrary shell access; stronger sandboxing is future work.

Concurrent editing remains simple shared-file/last-write-wins behavior. Publishing, sharing, conflict merging, MCP execution, and stronger isolation are deferred.
