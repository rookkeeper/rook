# Gate 6 — Add capability-specific behavior

## Demonstration

Handle one capability family at a time and review each result before starting the next. MCP gets its own design pause.

## TODO

- [x] Define and materialize instruction-like facts inline in generated instructions.
- [x] Define behavior for large facts by wrapping them as pseudo-skills.
- [x] Store, hash, and expose fetched `llms.txt` content as a generated pseudo-skill.
- [x] Materialize MCP configuration/content into a separate read-only workspace area.
- [x] Define the current MCP reviewable representation as stored configuration/content; live tool enumeration is explicitly deferred.
- [x] Defer MCP startup, authentication, permissions, sharing, and lifecycle to a later runtime-specific project.
- [x] Support directory environments that point at existing skills and instruction files.
- [x] Support existing project MCP configuration where practical.
- [x] Add tests for facts, `llms.txt`, MCP content, and project-directory sources.
- [x] Document the current filesystem read-only policy; defer stronger sandboxing.
- [x] Pause after facts, `llms.txt`, and project-directory capability families.
- [x] Pause after the MCP design decision: runtime lifecycle is deferred rather than blocking this migration.
