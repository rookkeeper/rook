# Environment-local authoring

Rook can learn environment-specific skills and instructions from the user. Personal content is writable and is stored in the personal environment-repository SQLite database.

## Personal bundle

Each environment has one user-owned `personal` bundle in the personal repository. It is created or imported as needed. Personal content bypasses approval while it remains user-owned; it is still revisioned and hashed when stored.

The old directory-shaped personal repository can be imported for migration. It is not the live source of truth after SQLite cutover.

## Session authoring workspace

When a session enters an environment, Rook materializes capabilities into:

```text
.var/rook/agent-workspaces/<session-id>/
├── AGENTS.md
└── .agent/
    ├── skills/
    └── mcp-servers/
```

The runtime prompt receives the actual session workspace paths. A personal skill is edited at:

```text
<workspace>/.agent/skills/<skill-name>/SKILL.md
```

The generated `<workspace>/AGENTS.md` contains readable environment and bundle sections. The personal section is marked so its contents can be written back to the personal bundle. The aggregate file itself is derived output and is recreated on materialization.

MCP content is exposed for review in the read-only `.agent/mcp-servers/` area. MCP execution and authentication are deliberately deferred.

## Write-back behavior

At an environment restart or other workspace synchronization point:

1. writable skill files are read from the session workspace
2. the matching personal bundle artifact is updated in SQLite and gets a new revision/hash
3. the marked personal instruction section is written to the bundle instruction field
4. the next materialization sees the updated content

Project-directory environments are a separate direct-source case. Their existing `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and `.mcp.json` files remain the source of truth, and writable mappings update those files where supported.

Canonical and external content is projected read-only. The current permission boundary is not a strong defense against an agent that can execute arbitrary commands as the same OS user; stronger sandboxing is future work.

## Agent guidance

The environment prompt tells Rook:

- which environment it is in
- where personal skills can be written
- where the editable personal instruction section lives
- which skills already exist
- where read-only external/MCP content can be reviewed

Because several environments can be entered, Rook should clarify the intended environment before creating or changing a personal capability.

## Authoring lifecycle

A typical cycle is:

1. enter an environment
2. use the environment's existing capabilities
3. ask Rook to remember a repeatable procedure or preference
4. Rook edits a personal skill or instruction section
5. the server writes the change back to SQLite
6. the next session entry loads the new revision

Concurrent-session conflict merging, publishing personal capabilities, and sharing are not part of the current implementation.
