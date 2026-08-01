# Environment repository to database

This change explores moving environment-repository storage from a filesystem-shaped bundle tree into SQLite while preserving Rook's working behavior.

Bundles remain the atomic publication, review, approval, and runtime-loading unit. Capabilities inside them may include skills, MCP servers, instructions, `llms.txt`, and other content. The database becomes the source of truth, while each runtime receives a materialized working directory.

The most important constraint is that user-authored skills and instructions must continue to work end-to-end: the agent must be able to read them, edit them when appropriate, and have edits written back to their source. We should remove the old live filesystem implementation as soon as the replacement supports that behavior; temporary import/migration code is acceptable, but permanent dual paths are not.

## Files

- [`brainstorming.md`](./brainstorming.md) — research, open questions, and design exploration.
- [`DECISIONS.md`](./DECISIONS.md) — decisions and working agreements reached so far.
- [`FAQ.md`](./FAQ.md) — concise answers to recurring questions and reminders about scope.

This directory is a design log, not yet an implementation plan or commitment to every future feature.
