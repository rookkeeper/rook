# Capability and skill definitions

Rook uses [Agent Skills](https://agentskills.io/home) for skill-shaped capabilities. A skill is a directory with a `SKILL.md` file and may include nested `references/`, `scripts/`, and `assets/` files.

## Repository representation

In SQLite, a skill capability retains the complete nested file map. The content hash includes the agent-visible files and paths, not the storage location. Skills use the same capability file-map representation as instructions, facts, `llms.txt`, MCP, and app content.

## Runtime representation

Resolved skills are materialized under:

```text
<session-workspace>/.agents/skills/<skill-name>/
```

The `.agents/skills/` directory follows the standard Agent Skills discovery convention, so Pi and other compatible runtimes discover it from the workspace cwd. Rook launches Pi with project approval for this generated workspace because non-interactive ACP sessions cannot answer Pi's trust prompt. Skills from personal bundles are writable through shared links and synchronize back to SQLite. Canonical and external skills are projected read-only. Duplicate skill names use naive `_2`, `_3`, etc. workspace names without changing skill frontmatter.

## Other capability types

Not everything is a skill:

- bundle instructions become generated `AGENTS.md` content
- small facts are inline; large facts become generated reference skills
- `llms.txt` becomes a generated reference skill
- MCP content is stored and projected separately, with lifecycle deferred
- project environments can read existing project skills and instructions directly

Skills should describe narrow, reviewable environment behavior. A universal environment interaction tool and capability-specific permissions remain future design work.
