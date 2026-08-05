# Environment repository

This is the product-level description of Rook's environment-linked capability catalog.

## Purpose

An environment repository maps recognizable environments to capability bundles that Rook can discover, preview, approve, and load. It is intentionally broader than a skill repository. A bundle may contain skills, instructions, facts, `llms.txt` reference material, app metadata, and MCP configuration/content.

Bundles remain the atomic publication, review, approval, and runtime-loading unit. Capabilities are not approved independently in the current product.

## Current storage model

The live repository abstraction is:

```text
API/routes
    ↓
Environment services
    ↓
EnvironmentRepository
    ↓
SQLite or an intentional source adapter
```

The live server uses one logical union of:

- the canonical SQLite database at `environment-repository.db`
- the personal SQLite database at `~/.rook/environment-repository.db`
- project-directory sources for existing project files
- synthetic repositories such as location context

SQLite is the sole source of truth for canonical and personal content. A project-directory environment is intentionally different: the project files are already the source of truth.

Each repository revision records the content hash plus source/fetch/provenance fields. The application database remains separate and stores sessions, transcripts, membership, and durable bundle decisions.

## Environment ids

Environment ids use:

```text
<type>:<uri-like-path>
```

Current kinds include `location`, `web`, `mac`, `dir`, `iphone`, `android`, and `windows`.

Examples:

- `mac:md.obsidian`
- `web:example.com`
- `location:office`
- `dir:/Users/johnberryman/projects/github/rookkeeper/rook`

Registration and entry are literal. Observed paths and URLs can help discover known repository environments, but entering a child environment does not implicitly enter its parent.

## Bundle and revision model

A bundle identity is the repository, environment, and bundle name. A revision is one stored content snapshot of that identity. The canonical content hash is authoritative for approval; an optional publisher version is provenance, not a substitute for the hash.

A bundle may contain:

- **Skills** — complete nested file maps, including references, scripts, and assets.
- **Instructions** — bundle-level `AGENTS.md`-like text.
- **Facts** — small facts inline in generated instructions; large facts become generated reference skills.
- **`llms.txt`** — fetched full text stored and exposed as a generated reference skill.
- **MCP content** — configuration/content projected into a separate read-only area. MCP startup and tool discovery are deferred.
- **Apps/metadata** — reviewable bundle content where supported.

Only agent-visible or runtime-controlling content participates in approval hashing. Display-only metadata does not.

## Repository and source adapters

The first implementations are:

- `SQLiteEnvironmentRepository` — live canonical/personal storage, revisions, search, and write-back.
- `ProjectDirectoryEnvironmentRepository` — direct project-owned `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and `.mcp.json` content.
- `CompositeEnvironmentRepository` — one logical view over those sources.

The runtime does not require SQLite repository paths. `CapabilityWorkspaceManager` projects resolved content into ordinary agent files while preserving SQLite and project directories as the durable sources.

## Runtime projection

Each runtime uses its per-session agent workspace as its process working directory:

```text
~/.rook/agent-workspaces/<session-id>/
├── AGENTS.md
└── .agents/
    ├── skills/
    ├── editable-skills/<environment-nickname>/
    ├── AGENTS_FILES/<environment-nickname>/AGENTS.md
    └── mcp-servers/
```

The process-wide global workspace at `~/.rook/global-workspace/` provides one writable file tree for each SQLite-backed personal source. Rook clears it at startup and retains it after shutdown for inspection. Session workspaces symlink to those trees. Project-owned skills and instructions are linked directly to project files; immutable external content is materialized directly and read-only into each session instead of entering the writable global workspace.

`AGENTS.md` is a generated read-only aggregate. Individual linked `AGENTS_FILES` are the editable instruction sources. Filesystem watchers serialize settled personal changes as new SQLite revisions and reconcile project-source changes without writing SQLite. Changing entered environments restarts only the affected runtime after the existing ACP session has been successfully loaded. Pi starts with one-run approval for the generated workspace so non-interactive ACP startup discovers `.agents/skills`; this does not replace bundle-level content approval.

## Decisions and approval

Decisions are bundle-scoped:

- `accept` — allow this bundle for the current session/visit.
- `ignore` — skip it for the current session/visit.
- `approve` — persist approval for the exact content hash.
- `reject` — persist rejection for the exact content hash.

Personal bundles are user-owned and do not require approval. External/canonical bundles remain immutable to the user and require the normal decision flow. If agent-visible content changes, its hash changes and the durable decision no longer applies.

## Search, preview, and review

Environment and bundle search are separate operations. The current bundle endpoint supports a repository filter:

```text
GET /api/environments/search?query=...
GET /api/bundles/search?query=...&repository=canonical|personal|project-directory
GET /api/environments/preview?environmentId=...
```

Previews expose bundle identity, repository, validity/errors, canonical hash, revision source/fetch metadata, nested artifacts, facts, `llms.txt`, and instructions. Client artifact views use a file-tree/content presentation so users review the actual agent-visible content.

## Storage boundary

Canonical and personal capability content exists durably in SQLite only. The global workspace and session workspaces are projections, not repository storage; the global workspace is deliberately retained between shutdown and the next startup but is never authoritative. Passive environment registration does not create empty personal bundles. Project-directory environments remain the explicit direct-file source; their bundle ID is `directory` and they never receive an SQLite personal bundle.

## Deferred product work

The migration intentionally does not finish:

- publishing, sharing, signed publishers, or formal provenance
- remote repository adapters and revalidation scheduling
- capability-level approval or dependency graphs
- conflict merging for concurrent personal edits
- prompt-injection validation of repository content
- strong OS-level sandboxing beyond filesystem permissions
- MCP startup, authentication, tool enumeration, sharing, and lifecycle
- substantial UI redesign
