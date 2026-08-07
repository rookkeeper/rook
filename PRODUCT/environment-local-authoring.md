# Environment-local authoring

Rook can learn environment-specific skills and instructions from the user. Personal SQLite content is the durable source for non-directory environments. A project directory is the durable source for a `dir:` environment.

## Ownership

Canonical capabilities are immutable and read-only. Personal capabilities are writable and do not require approval. Project-directory capabilities are direct project files and never become personal SQLite rows.

A capability may be shared by multiple bundle memberships. Soft deletion is membership-scoped: deleting a personal skill or instruction from one environment sets `bundles.deleted_at`, while the capability files remain available for restoration or other memberships.

Entering an environment with no personal content does not create an empty bundle. Rook creates temporary session authoring state; the first real authored instruction or capability creates the durable rows.

## Uniform capability content

All capability kinds use the same nested file-map representation in SQLite:

```text
skill:        <skill-name>/SKILL.md, scripts/, references/, ...
instructions: AGENTS.md
llms-txt:     llms.txt
facts:        one or more fact files
mcp/app:      configuration and supporting files
```

Each capability has a UUID `TEXT` id, a human-readable name, a type, the complete file map, and a content hash. There is no revision history.

## Workspace topology

Rook keeps one shared writable source per personal environment:

```text
~/.rook/global-workspace/writable/<environment-key>/
├── AGENTS.md
└── .agents/skills/<skill-name>/
```

Each session links into that source:

```text
~/.rook/agent-workspaces/<session-id>/.agents/
├── AGENTS_FILES/<environment>        -> shared environment directory
├── editable-skills/<environment>     -> shared environment/.agents/skills
└── skills/<visible-name>             -> shared skill source
```

The root workspace `AGENTS.md` is a generated read-only aggregate. The editable instruction source is `.agents/AGENTS_FILES/<environment>/AGENTS.md`. New skills must be created at `.agents/editable-skills/<environment>/<skill-name>/SKILL.md`; `SKILL.md` makes a new skill eligible for persistence.

The shared global watcher observes the writable environment directories. It debounces content changes, persists settled current file maps, detects missing writable instruction or skill entries as membership deletion, and updates all active session projections. Workspace rebuild and shutdown cleanup are not treated as user deletion.

## Project-directory authoring

A project environment keeps ownership in the project:

```text
<project>/
├── AGENTS.md
└── .agents/skills/<skill-name>/
```

Session links point directly to these files. Project edits remain project edits. Deleting a project file is not a personal SQLite soft delete.

## Safety boundaries

- [ ] Canonical and external projections remain read-only.
- [ ] Non-writable skills must not be changed or made writable.
- [ ] The generated aggregate must not be edited directly.
- [ ] Deleting a writable authoring source affects only that bundle membership.
- [ ] A deleted membership can be restored without losing its capability file map.

Filesystem permissions are not a strong security boundary against an agent with arbitrary same-user shell access. Stronger OS-level isolation remains future work.
