# Environment repository

Rook's environment repository maps recognizable environments to capability bundles that Rook can discover, preview, approve, and load.

## Storage model

Each environment-repository SQLite database has exactly three tables:

- `environments` — environment identity and display metadata.
- `capabilities` — reusable capability content and a content hash.
- `bundles` — membership rows joining a bundle, environment, and capability.

A capability is stored in one uniform nested file-map format. A skill stores its complete directory, including `SKILL.md`, scripts, references, and assets. `AGENTS.md`, `llms.txt`, facts, MCP content, and app content use the same representation.

Capabilities use UUID `TEXT` identifiers and may be referenced by bundle memberships in multiple environments. A bundle is the atomic publication, review, approval, and runtime-loading unit. The bundle hash is derived deterministically from its active capability memberships and their content. Rook does not store revisions or revision pointers.

`deleted_at` belongs to a bundle membership, not the shared capability row. Deleting a writable capability from one environment leaves the capability content available to other memberships. Restoration clears the membership timestamp.

The canonical database and personal database use the same schema but different repository instances:

- canonical content is read-only and externally curated;
- personal content is writable and does not require approval;
- project-directory content is a direct filesystem source and is not stored in SQLite.

Entering an environment does not create an empty personal bundle. Rook creates temporary authoring state for the session and creates durable environment, capability, and bundle-membership rows only when real content is authored.

## Environment ids

Environment ids use:

```text
<type>:<uri-like-path>
```

Examples:

- `mac:md.obsidian`
- `web:example.com`
- `location:office`
- `dir:/Users/johnberryman/projects/github/rookkeeper/rook`

Registration and entry are literal. Observed paths and URLs can discover known repository environments, but entering a child environment does not implicitly enter its parent.

## Repository projection and API

The repository layer stores normalized rows and projects them into the existing bundle-facing `EnvironmentBundle` API:

- `skill` capabilities become `bundle.skills`;
- `instructions` becomes `bundle.agentsMd`;
- `llms-txt` becomes `bundle.llmsTxt`;
- `facts`, `mcp`, and `app` capabilities become their corresponding bundle collections.

The server exposes:

```text
GET  /api/environments/search?query=...
GET  /api/bundles/search?query=...&repository=canonical|personal|project-directory
GET  /api/environments/preview?environmentId=...
```

Previews expose the bundle hash, active capability content, and repository identity. Revision metadata is not part of the API.

## Runtime workspace projection

The process-wide writable source is project-shaped and contains one environment directory per personal environment:

```text
~/.rook/global-workspace/writable/<environment-key>/
├── AGENTS.md
└── .agents/
    └── skills/<skill-name>/
```

Each session receives disposable links:

```text
~/.rook/agent-workspaces/<session-id>/
├── AGENTS.md
└── .agents/
    ├── AGENTS_FILES/<environment>        -> shared environment directory
    ├── editable-skills/<environment>     -> shared environment/.agents/skills
    └── skills/<visible-name>             -> shared skill source
```

The root `AGENTS.md` is a generated, read-only aggregate. Individual linked files under `AGENTS_FILES` are the editable instruction sources. New skills belong under `.agents/editable-skills/<environment>/`, never directly under `.agents/skills/`.

Canonical content is materialized read-only into the session workspace. Project-directory skills and instructions link directly to project files. The global watcher observes shared personal sources, debounces settled changes, writes current capability content to SQLite, and interprets missing writable source entries as membership soft deletion. Rebuild and cleanup operations are suppressed from deletion inference.

## Approval and deletion

Personal capabilities are user-owned and do not require approval. Canonical capabilities remain immutable and require the normal decision flow. Decisions apply to the derived content hash of an atomic bundle; changing active capability content or membership produces a different hash.

A writable skill or instruction source can be soft-deleted through its authoring path. The membership remains with a nullable `deleted_at` timestamp, the capability files remain available for restoration, and deleted content is omitted from bundle resolution, search, previews, aggregate instructions, and runtime discovery.

The generated aggregate `AGENTS.md` is never an editable source. Deleting or rebuilding it only causes regeneration and does not delete capability content.

## Deferred work

- publishing, sharing, signed publishers, and remote repository adapters;
- capability-level approval or dependency graphs;
- conflict merging for concurrent personal edits;
- MCP startup and lifecycle;
- stronger OS-level sandboxing.
