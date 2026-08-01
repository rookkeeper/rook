# Capability and skill definitions

Rook uses [Agent Skills](https://agentskills.io/home) for skill-shaped capabilities. A skill is a directory with a `SKILL.md` file and may include nested `references/`, `scripts/`, and `assets/` files.

## Repository representation

In SQLite, a skill revision retains the complete nested file map. The content hash includes the agent-visible files and paths, not the storage location. Directory import preserves source paths for compatibility, but runtime loading uses the per-session workspace.

## Runtime representation

Resolved skills are materialized under:

```text
<session-workspace>/.agent/skills/<skill-name>/
```

Skills from personal bundles are writable and synchronize back to SQLite. Canonical and external skills are projected read-only. Duplicate skill names in one runtime workspace are rejected rather than silently merged.

## Other capability types

Not everything is a skill:

- bundle instructions become generated `AGENTS.md` content
- small facts are inline; large facts become generated reference skills
- `llms.txt` becomes a generated reference skill
- MCP content is stored and projected separately, with lifecycle deferred
- project environments can read existing project skills and instructions directly

Skills should describe narrow, reviewable environment behavior. A universal environment interaction tool and capability-specific permissions remain future design work.
