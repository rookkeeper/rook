# Part B final review and implementation audit

## Status

Part B replaces per-session writable capability copies with shared source files and disposable per-session links. The server test suite passes with this model.

```text
SQLite personal content → temporary shared writable source → session links
project content         → direct project source           → session links
immutable external      → read-only session materialization
```

The global workspace is retained at `~/.rook/global-workspace/` for inspection, but it is not durable. Rook clears it at startup before materializing current sources. SQLite and project files remain the sources of truth.

## Identifier inventory

| Identifier | Construction and scope |
| --- | --- |
| Public session ID | `crypto.randomUUID()` in `AgentRuntimeManager.createSession()`. It identifies one Rook session, its session workspace, API routing, and durable session row. |
| Runtime-local session ID | Returned by ACP `session/new`; unique only within the selected runtime. SQLite stores it with the public ID and runtime ID. |
| Environment ID | Provider string such as `web:example.com`, `mac:md.obsidian`, `location:office`, or `dir:/absolute/path`. It is never used raw as a workspace path. |
| Bundle identity | `(repository, environmentId, bundleId)`. SQLite enforces this tuple as unique and derives `bundle_key` from it. Project bundles use `directory`, not `personal`. |
| Revision identity | `revision_key = bundle_key + content_hash`. The exact content hash is the durable approval key. |
| Artifact ID | Scoped to a bundle revision and artifact kind. It is not globally unique. |
| Global source key | SHA-256 base64url digest of repository, environment, bundle, source kind, and optional artifact ID. It names a stable SQLite source path under `~/.rook/global-workspace/` until the next startup clear. `manifest.json` maps it back to those identities. |
| Environment nickname | Path-safe display-name slug, assigned in sorted environment-ID order and suffixed `_2`, `_3`, etc. on collision. It is only agent-facing. |
| Visible skill directory | Original skill ID when free; `_2`, `_3`, etc. only for session workspace collisions. Skill frontmatter is unchanged. |

`dir:` environments infer project ownership from their environment type. Registering one does not create an SQLite personal bundle.

## Where Rook’s text lives

- **Base identity**: `server/src/environments/support/RookIdentityPrompt.ts`. This is the sole text directly injected through runtime launch configuration.
- **Environment instructions**: bundle `agentsMd` content in SQLite, or the project’s `AGENTS.md` (falling back to `CLAUDE.md` only when `AGENTS.md` is absent).
- **Aggregate template**: `renderAggregateAgents()` in `runtime/CapabilityWorkspaceManager.ts`. It creates read-only session-root `AGENTS.md`, emits environment-tagged instruction sources, gives concrete relative authoring paths, explains skill editing and creation, inventories known skill names by environment, and embeds small facts.
- **Editable instruction source**: `.agents/AGENTS_FILES/<environment-nickname>/AGENTS.md`. It is a link to a writable SQLite/project source or a read-only external materialization.
- **Skill guidance**: the aggregate tells the agent to create skills beneath `.agents/editable-skills/<environment-nickname>/`.

The removed `EnvironmentPromptTemplate` and `EnvironmentManager.runtimeInstructionsForSession()` no longer create a duplicate environment system prompt. Runtimes discover the aggregate from their workspace cwd.

## Lifecycle

### Server startup

`buildServer()` opens repositories and creates `CapabilityWorkspaceManager`. The manager creates:

- the process-wide `~/.rook/global-workspace/` root for writable SQLite sources, clearing its previous contents first;
- a separate temporary project-authoring staging root for project files that do not yet exist;
- `~/.rook/agent-workspaces/` for disposable session projections;
- no personal SQLite bundle for a passively registered environment; explicit entry creates the writable authoring bundle when needed;
- a source manifest and debounced watchers for global/staging sources.

The global root can be inspected or deleted while Rook is stopped. Its contents are cleared at the next startup and recreated from durable SQLite/project sources as sessions are created or restored.

### New agent/session

1. Rook creates the public UUID before ACP `session/new`.
2. It creates an empty agent workspace at `~/.rook/agent-workspaces/<session-id>/`.
3. Both subprocess launch cwd and ACP `session/new` cwd use that workspace.
4. Rook starts the ACP runtime and stores the public/runtime-local session mapping.

The base Rook identity is injected once. No environment skill paths or environment prompt text are injected explicitly. Pi discovers the standard `.agents/skills` workspace directory after Rook grants one-run project approval to the generated workspace for non-interactive ACP startup.

### Reopening a persisted session

Before creating/reusing a runtime, Rook recreates the empty session workspace if necessary, restores durable environment membership, then projects active sources and performs the normal ACP `session/load` replacement flow. A deleted session workspace is never treated as durable state; the retained global workspace is likewise cleared and rebuilt from current source materializations at startup.

### Entering an environment

For an environment with skills, Rook resolves approved/user-owned bundles, materializes or reuses the shared source, creates session links, regenerates aggregate instructions, and replaces only that session runtime after successful ACP load.

For an environment with no skills, Rook still creates the per-environment AGENTS/authoring structure when writable. A writable instruction source starts with a generated default message, but that baseline is not persisted to SQLite/project storage until changed. Empty skill directories are not durable artifacts. `SKILL.md` is the promotion boundary.

### File edits and promotion

- An existing personal skill is editable through both `.agents/skills/<name>` and `.agents/editable-skills/<environment>/<name>`; both resolve to the same global source tree.
- A global watcher debounces settled source changes, serializes personal skill/instruction edits as SQLite revisions, and leaves dirty sources in place if persistence fails.
- A new skill in an editable slot is persisted once it contains `SKILL.md`, then receives its normal `.agents/skills` link.
- Existing project skills and instructions are direct links to project files. Project roots are watched directly and never write SQLite.
- If a project lacks `.agents/skills` or `AGENTS.md`, Rook uses temporary project staging until the first completed skill/instruction is promoted into the project.
- Immutable external skills/instructions/MCP files are materialized directly into each session as read-only files, not placed in the writable global root.

### Session close and server shutdown

`closeSession()` performs a final workspace assessment before ACP close, removes only that session workspace, and leaves shared sources available to other sessions.

`AgentRuntimeManager.close()` assesses shared sources, closes runtimes, and removes session projections. `CapabilityWorkspaceManager.close()` stops watchers, performs the final assessment, retains the global workspace for inspection, and removes only the temporary project-staging root before repositories/databases close.

## Capability parity

The new manager preserves capability-specific projections:

- ordinary skills, including nested files;
- small facts inline in generated `AGENTS.md`;
- large facts and `llms.txt` as read-only generated reference skills;
- MCP configuration/content in read-only `.agents/mcp-servers/`.

MCP startup and lifecycle remain deferred.

## Legacy removal audit

The replaced ideas are removed from active server source and tests:

- `DirectoryEnvironmentRepository`, importer wiring, checked-in directory tree, compatibility projections, and legacy source-path database fields were removed during Part A;
- `AgentWorkspaceMaterializer.ts` and its tests are deleted;
- per-session writable-copy synchronization (`syncWritableChanges`) is deleted;
- marker-based aggregate instruction write-back is deleted;
- `EnvironmentPromptTemplate.ts`, its tests, and `runtimeInstructionsForSession()` are deleted;
- the runtime no longer injects materialized skill paths or environment prompt text alongside workspace discovery.

The intentional `ProjectDirectoryEnvironmentRepository` remains. It is not a compatibility layer: it is the explicit direct-file source adapter for `dir:` environments.

Repository write routing now carries repository identity in addition to environment and bundle identity, so two repositories cannot be selected merely because they share a bundle name.

## Validation performed

- Full server suite: **115 passed, 5 skipped**.
- Server TypeScript typecheck: passed.
- Focused tests cover shared links across sessions, source manifest identity, skill collision suffixes, watcher persistence, new-skill promotion, direct project links/watchers, read-only external projections, project bundle identity, and SQLite revision write-back.

## Remaining future work

- bounded/reported retry policy and richer error surfacing for failed watcher writes;
- stronger concurrency control than same-user last-writer-wins;
- stronger OS isolation or a separate runtime user;
- exposing a real project directory inside the agent workspace for coding tasks;
- richer MCP lifecycle, discovery, authentication, and approvals;
- validation with configured real Pi, Claude, and Cursor runtimes.
