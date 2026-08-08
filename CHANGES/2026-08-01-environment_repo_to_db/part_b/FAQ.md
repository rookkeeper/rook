# Part B FAQ

## What is the global workspace?

It is a shared on-disk materialization of writable SQLite-backed capabilities at `~/.rook/global-workspace/`. Agent workspaces symlink to it so multiple sessions see and edit the same files.

Rook clears its contents when the server starts and retains the directory after shutdown for inspection. Passive registration does not create an empty personal bundle; explicit entry creates the personal authoring bundle when needed. SQLite remains the durable source of truth.

## What is the source of truth for project-directory capabilities?

The project directory itself. Project skills and instruction files are not copied into SQLite or placed in the writable global workspace. Agent workspaces link directly to actual project files, so edits modify the project files.

## Why use symlinks?

Symlinks prevent each session from maintaining an independent writable copy. An edit made through one agent workspace changes the shared underlying file seen by other sessions.

This reduces asynchronous whole-file overwrites, although simultaneous edits to the same file can still conflict.

## What happens to immutable external content?

External/community content does not need to enter the writable global workspace. It can be materialized directly into the agent workspace with writes disabled.

## Does the global workspace need reference counting?

Not initially. The workspace is one process-wide shared tree, retained after shutdown for inspection and cleared at the next startup. Garbage collection is unnecessary under this lifecycle.

## How are AGENTS files handled?

The aggregate `AGENTS.md` is generated from a template and read-only. Each writable environment receives an individual source file under `.agents/AGENTS_FILES/<environment-nickname>/AGENTS.md`, including a generated default message when appropriate.

The individual file is linked to its global or project source. The default message establishes the baseline and is not persisted until the user changes the file. The aggregate includes the full text, a human-readable environment name, and the relative source path the agent should edit.

## Do instruction edits require a restart?

No. Watchers update the source and regenerate the aggregate file. The runtime discovers workspace instructions rather than receiving a duplicate environment prompt, although runtime-specific instruction caching can still affect immediate behavior.

## How are new skills assigned to environments?

The agent creates new skills under the explicit source directory:

```text
.agents/editable-skills/<environment-nickname>/<skill-name>/
```

The parent directory identifies the destination, so skill frontmatter does not need to carry ownership metadata. Existing writable skills are linked into both this directory and `.agents/skills/`; a newly created skill is linked into `.agents/skills/` once `SKILL.md` exists.

An empty placeholder does not become a real skill or SQLite artifact until `SKILL.md` is written.

## How does the watcher work?

A global watcher observes shared writable SQLite files, debounces events, waits for writes to settle, and serializes changes as new revisions. Project-backed files are watched directly at their project source paths rather than copied into the global workspace.

The watchers must handle additions, edits, renames, deletions, temporary files, symlink validation, feedback-loop prevention, retries, and startup reconciliation.

## What if persistence fails?

The dirty global file remains available to the runtime and is retried. The system should not discard the agent’s edit merely because SQLite is temporarily unavailable.

## How are concurrent edits handled?

For the initial implementation, shared files and simple last-write-wins behavior are acceptable. Locks and revision/hash conflict detection are deferred until team-scale shared editing becomes important.

## Is this a security sandbox?

No. Same-user filesystem permissions can be bypassed by an agent with arbitrary shell access. Stronger OS-level isolation is intentionally deferred.

## What is the runtime working directory?

The agent workspace is the runtime subprocess and ACP-session `cwd`, allowing ordinary discovery of `AGENTS.md` and `.agents/skills`. The actual project directory is not represented inside the workspace in this phase; exposing it for coding tasks is future work.

## What project-directory rules apply?

Project bundles use the distinct ID `directory`. Registering a directory environment does not create an SQLite personal bundle. New project skills are created under the project’s `.agents/skills/`, and new project instructions are created in the project-root `AGENTS.md`.

## What is not being implemented yet?

MCP startup, live tool/resource discovery, authentication, lifecycle management, stronger sandboxing, multi-user conflict handling, and automatic garbage collection remain deferred.
