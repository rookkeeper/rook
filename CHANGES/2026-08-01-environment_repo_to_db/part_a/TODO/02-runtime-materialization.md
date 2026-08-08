# Gate 2 — Integrate runtime materialization

## Demonstration

Start or restart a real session with entered bundle content, inspect its working directory and generated instructions, and confirm the runtime still behaves as before.

## TODO

- [x] Prototype materialization of nested skills.
- [x] Prototype generated readable environment/bundle instructions.
- [x] Test duplicate skill names, nested files, and external read-only projections.
- [x] Connect the materializer to `AgentRuntimeManager` environment restart handling.
- [x] Choose a per-session capability workspace under `.var/rook/agent-workspaces/` without changing project `cwd`.
- [x] Make environment runtime skill paths come from the materialized workspace.
- [x] Make generated instructions reach the runtime prompt path.
- [x] Add `EnvironmentManager` coverage for approved runtime bundle resolution.
- [x] Add a real ACP session integration test using materialized content.
- [x] Decide and implement startup/restart reinjection rather than trusting stale files.
- [x] Pause for runtime review through the ACP end-to-end integration test; manual external-runtime review remains optional.
