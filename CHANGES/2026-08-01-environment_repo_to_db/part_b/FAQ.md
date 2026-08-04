# Part B FAQ

## What is the global workspace?

It is a temporary shared on-disk materialization of writable SQLite-backed capabilities. Agent workspaces symlink to it so multiple sessions see and edit the same files.

SQLite remains the durable source of truth. The global workspace can be discarded and rebuilt.

## What is the source of truth for project-directory capabilities?

The project directory itself. Project skills and instruction files are not copied into SQLite. Global workspace entries should point to the actual project files, and edits through agent-workspace links should modify those project files.

## Why use symlinks?

Symlinks prevent each session from maintaining an independent writable copy. An edit made through one agent workspace changes the shared underlying file seen by other sessions.

This reduces asynchronous whole-file overwrites, although simultaneous edits to the same file can still conflict.

## What happens to immutable external content?

External/community content does not need to enter the writable global workspace. It can be materialized directly into the agent workspace with writes disabled.

## Does the global workspace need reference counting?

Not initially. The workspace can retain small capability files for the lifetime of the Rook process and be discarded/rebuilt later. Garbage collection can be added if storage becomes significant.

## How are AGENTS files handled?

The aggregate `AGENTS.md` is generated from a template and read-only. Each writable environment receives an individual source file under `.agent/AGENTS_FILES/<environment-nickname>/AGENTS.md`, including an empty placeholder when appropriate.

The individual file is linked to its global or project source. The aggregate includes the full text, a human-readable environment name, and the relative source path the agent should edit.

## Do instruction edits require a restart?

No server restart is required. The individual source and aggregate files can update immediately. A runtime that already loaded the aggregate into its system prompt may not incorporate the new instructions until a later reload, but that is acceptable for now.

## How are new skills assigned to environments?

The agent creates new skills under the explicit source directory:

```text
.agent/editable-skills/<environment-nickname>/<skill-name>/
```

The parent directory identifies the destination, so skill frontmatter does not need to carry ownership metadata. Existing writable skills are linked into both this directory and `.agent/skills/`; a newly created skill is linked into `.agent/skills/` once `SKILL.md` exists.

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

The intended design uses the agent workspace as the runtime `cwd`, allowing ordinary runtime discovery of `AGENTS.md` and `.agent/skills`. The actual project directory is not represented inside the agent workspace in this phase; exposing it for coding tasks is future work.

## What project-directory rules apply?

Project bundles use the distinct ID `directory`. Registering a directory environment does not create an SQLite personal bundle. New project skills are created under the project’s `.agents/skills/`, and new project instructions are created in the project-root `AGENTS.md`.

## What is not being implemented yet?

MCP startup, live tool/resource discovery, authentication, lifecycle management, stronger sandboxing, multi-user conflict handling, and automatic garbage collection remain deferred.
