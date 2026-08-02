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

A directory import can bootstrap SQLite, but the runtime does not require repository paths. `AgentWorkspaceMaterializer` converts resolved content into the ordinary files expected by the selected ACP runtime.

## Runtime projection

Each session gets a separate workspace under:

```text
.var/rook/agent-workspaces/<session-id>/
```

The workspace contains:

- `.agent/skills/` — materialized skill directories
- `AGENTS.md` — generated readable environment/bundle instructions
- `.agent/mcp-servers/` — read-only MCP configuration/content

Canonical and external materializations are read-only by filesystem policy. Personal skills and marked personal instruction sections are writable. Skills synchronize to the personal SQLite bundle; instruction edits synchronize to that bundle's instruction field. Project-owned skills/instructions map back to project files. The generated aggregate `AGENTS.md` remains a projection, not a database source file.

Changing entered environments or restoring a session rematerializes the workspace and restarts only the affected runtime after the existing ACP session has been successfully loaded.

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

Canonical and personal capability content exists in SQLite only. Runtimes receive per-session workspace projections, not repository storage paths. Project-directory environments remain the explicit exception because their project files are themselves the source of truth.

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
