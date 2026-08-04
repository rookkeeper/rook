# Part B final review and implementation audit

## Status

This is the review baseline for Part B. The shared global workspace, symlink topology, and watcher are not implemented yet. The current server still uses per-session materialized copies. The implementation target is recorded in [`TODO.md`](./TODO.md).

This report intentionally separates what the current code does from what Part B will change.

## Identifier inventory

### Public sessions

- `AgentRuntimeManager.createSession()` creates the public Rook session ID with `crypto.randomUUID()`.
- ACP returns a separate runtime-local session ID from `session/new`.
- The application database stores both IDs with the runtime ID, title, cwd, and timestamps.
- `SessionRuntime` and the ACP facade use the public ID at the API boundary and the runtime-local ID at the subprocess boundary.

### Environment IDs

Environment IDs are strings produced by environment providers. Current forms include:

- `web:<host>` and deeper web paths;
- `mac:<bundle-id>` and Mac application contexts;
- `location:<slug>`;
- `dir:/absolute/path` for project directories.

Environment IDs are unique identifiers for the current machine/runtime context, but they are not all safe to use directly as filesystem names. Part B will retain the full ID in its internal mapping and use a path-safe environment nickname for agent-facing workspace paths.

### Bundle identity

A bundle ID is not globally unique by itself. The effective repository identity is:

```text
repository + environment ID + bundle ID
```

SQLite currently derives `bundle_key` from that composite identity. A revision key is derived from the bundle key and the content hash. Durable decisions use the content hash because approval applies to the exact agent-visible content.

The current project-directory implementation incorrectly uses `bundleId: "personal"`. Part B changes that to `directory` and prevents automatic SQLite personal-bundle creation for `dir:` environments.

### Artifact identifiers

Skill, MCP, app, fact, and generated-reference artifact IDs are scoped to their bundle revision. They are not globally unique. The current runtime skill directory is flat, so Part B uses the deliberately simple collision rule:

- first skill keeps its name;
- later collisions use `_2`, `_3`, and so on for the workspace folder/link;
- the skill’s internal frontmatter is not changed.

### Session and workspace paths

The current capability workspace uses the public session ID:

```text
.var/rook/agent-workspaces/<session-id>/
```

The Part B target moves agent workspaces to the chosen per-session location under `~/.rook/agent-workspaces/<session-id>/` and introduces a separate temporary process-wide global workspace for writable SQLite materializations.

The global workspace will use a server-owned source mapping. That mapping will connect each path to its repository, environment, bundle, artifact, source kind, and mutable/revision identity. The path itself does not need to expose every identifier.

## Where Rook’s agent text lives

Rook’s current agent-facing text comes from several places.

### Base Rook identity

`server/src/environments/support/RookIdentityPrompt.ts` contains the base identity text beginning with:

```text
## You are Rook
```

`AgentRuntimeManager.baseRuntimeConfiguration()` injects this as the runtime’s appended system prompt for every configured runtime, including sessions with no entered environment.

### Environment instructions

`EnvironmentManager.runtimeInstructionsForSession()` currently combines:

- the base Rook identity;
- `EnvironmentPromptTemplate.ts` output;
- environment metadata and authoring guidance;
- selected bundle instruction text.

`AgentWorkspaceMaterializer` separately generates a root `AGENTS.md`. During the current environment restart flow, both the template-generated prompt and the materialized `AGENTS.md` content are passed to the runtime. This is a known duplication that Part B removes.

### Target instruction model

Part B will use:

```text
agent workspace/AGENTS.md                         generated, read-only aggregate
agent workspace/.agent/AGENTS_FILES/<environment>/AGENTS.md
                                                     individual writable/read-only source link
```

The aggregate will be generated from a template. The template will contain Rook’s authoring instructions and will interpolate concrete relative paths for the current session workspace. The individual source file, not the aggregate, will be the editable source.

The aggregate can be regenerated without restarting the server. A currently running runtime may not reload already-injected system instructions immediately; that is accepted for this phase.

### Skill instructions

The runtime currently receives explicit `skillPaths` and provider-specific launch arguments. Part B will instead make the agent workspace the runtime `cwd` so normal runtime discovery finds `.agent/skills` and `AGENTS.md`. Explicit skill injection must be removed where it would duplicate discovery.

## Current lifecycle

### Server startup

`buildServer()` currently:

1. opens the application SQLite database;
2. opens canonical and personal environment SQLite repositories;
3. creates the project-directory and location-context repository adapters;
4. composes repositories into one logical repository;
5. constructs `EnvironmentRepositoryService`, `EnvironmentManager`, and `AgentRuntimeManager`;
6. registers REST and ACP routes.

No global capability workspace is currently created at server startup.

### Agent/session startup

A new public session currently:

1. creates a `SessionRuntime` subprocess;
2. calls runtime `session/new`;
3. stores the public/runtime session mapping;
4. subscribes the session to environment events.

The per-session capability workspace is not materialized until an environment entry event requires it.

### Environment entry with skills

The current flow is:

```text
client/API enter request
  → AgentRuntimeManager.applyEnvironmentChange()
  → EnvironmentManager.enterEnvironment()
  → environment event listener
  → AgentRuntimeManager.scheduleEnvironmentRestart()
  → sync old writable workspace
  → resolve approved/user-owned bundles
  → AgentWorkspaceMaterializer.materialize()
  → create replacement runtime
  → replacement session/load
  → retire old runtime
```

The materializer currently copies skills into the session workspace, generates `AGENTS.md`, creates generated fact/`llms.txt` skills where applicable, and materializes MCP content separately.

### Environment entry without skills

If an entered environment has no resolved skill content, the current materializer still creates the session workspace structure and generated `AGENTS.md`, but there are no skill paths to load.

Current registration also automatically ensures a SQLite personal bundle for environments. Part B removes that behavior for `dir:` environments. A directory environment with no existing files should not create SQLite repository content merely because it was registered.

### Runtime restart after environment changes

Environment membership changes use an ACP-preserving replacement process:

1. synchronize the current workspace;
2. materialize the new environment set;
3. start a replacement runtime;
4. load the existing runtime-local ACP session;
5. only then close the old runtime.

The public session remains the same.

### Session close

`AgentRuntimeManager.closeSession()` currently calls workspace synchronization before sending `session/close`, closing the runtime, detaching it, and deleting the session record.

Part B changes this to a final global/project source reconciliation and session-link cleanup. Shared global writable files must not be deleted just because one session closes.

### Server shutdown

The current `AgentRuntimeManager.close()` closes active runtime processes and clears in-memory state, but it does not currently perform a final `syncWorkspace()` for every active session first. Part B must add an explicit final reconciliation/flush before closing watchers, deleting the temporary global workspace, or closing databases.

The shutdown sequence should be:

```text
stop accepting new work
  → stop/debounce watcher events
  → final assessment of dirty global/project sources
  → flush SQLite writes and retries
  → remove per-session links
  → close runtime processes
  → remove temporary global workspace
  → close repositories/databases
```

## Target lifecycle

### Rook startup

1. Create a temporary process-wide global writable workspace.
2. Initialize its source mapping/manifest.
3. Start watchers for the global writable workspace.
4. Restore persisted sessions and their environment memberships as sessions are resumed.
5. Recreate per-session agent workspaces and links from SQLite and active project sources.

### Agent startup

1. Create or recover the session workspace.
2. Set runtime `cwd` to that workspace.
3. Link writable SQLite skills into both `.agent/skills` and `.agent/editable-skills/<environment>`.
4. Link existing project skills directly to project sources.
5. Materialize immutable external skills directly and read-only.
6. Create/link individual AGENTS source files.
7. Generate the read-only aggregate `AGENTS.md` from its template.
8. Start the runtime without duplicate skill/instruction injection.

### Entering an environment

For an environment with skills:

1. Resolve the current bundle content.
2. Create or reuse global writable SQLite files, or direct project links.
3. Create the session’s editable-skill links.
4. Create read-only external skill files directly in the session workspace.
5. Generate the environment’s individual AGENTS source and aggregate entry.
6. Update the runtime workspace and load/restart only as required by the environment membership change.

For an environment without skills:

1. Still create its authoring/AGENTS placeholder structure if it is writable.
2. Generate its aggregate instruction entry.
3. Do not create a SQLite artifact until the user writes content.
4. Do not create an empty project file until the user writes content.

### File changes

- Existing writable SQLite files are changed through links into the global workspace; the global watcher serializes settled changes into new SQLite revisions.
- Existing project files are changed through direct agent-workspace links; project watchers observe the actual project source and do not write SQLite.
- New SQLite skills are created under `.agent/editable-skills/<environment>`. Once `SKILL.md` exists, the watcher creates the SQLite artifact and the `.agent/skills` link.
- New project skills are created under the project’s `.agents/skills`, creating that directory if needed.
- New project instructions are created in the project-root `AGENTS.md`.

### Shutdown and restart

Session shutdown performs a final source assessment before removing only that session’s links. Rook shutdown flushes watcher queues and dirty files before removing the temporary global workspace.

After a Rook restart, SQLite and project sources are used to recreate the global/session links. The temporary global workspace itself is not trusted as durable state.

## Legacy code removal audit

The old filesystem repository implementation has been removed from the current server source:

- `DirectoryEnvironmentRepository` is gone;
- the directory import command is gone;
- the checked-in legacy `environment-repository/` tree is gone;
- legacy source-path database columns are gone;
- `EnvironmentBinding` and compatibility projection code are gone;
- normal server wiring uses canonical/personal SQLite repositories, the project-directory adapter, and the synthetic location adapter.

`ProjectDirectoryEnvironmentRepository` is not legacy code. It is the intentional direct-file repository for project-owned content.

The current `AgentWorkspaceMaterializer` is not a second repository implementation, but its per-session writable-copy behavior is the part Part B replaces. After the shared-link implementation is complete, the old writable-copy synchronization, `sourcePath` fallback, marker-based personal instruction extraction, and duplicate environment-prompt path must be removed rather than retained as compatibility layers.

The final code audit must search both source and tests for old names and old behavior. The only remaining directory-backed repository behavior should be the intentional project-directory adapter.

## Final review requirements

Before Part B is considered complete, the final review must show:

- every public/session/environment/bundle/revision/artifact/workspace identifier and its scope;
- every source of Rook’s identity, authoring instructions, environment text, and generated aggregate text;
- startup, session startup, environment entry, environment exit, runtime replacement, session close, server shutdown, and Rook restart flows;
- behavior for environments with skills, instructions only, project files, and no capabilities;
- the final source reconciliation point for each shutdown path;
- the complete removal of old repository and synchronization code;
- tests proving no stale compatibility layer remains active.
