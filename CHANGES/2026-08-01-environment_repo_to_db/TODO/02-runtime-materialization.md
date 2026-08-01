# Gate 2 — Integrate runtime materialization

## Demonstration

Start or restart a real session with entered bundle content, inspect its working directory and generated instructions, and confirm the runtime still behaves as before.

## TODO

- [x] Prototype materialization of nested skills.
- [x] Prototype generated readable environment/bundle instructions.
- [x] Test duplicate skill names, nested files, and external read-only projections.
- [ ] Connect the materializer to `AgentRuntimeManager` session startup.
- [ ] Connect it to environment-driven runtime restarts.
- [ ] Choose a stable per-session workspace location without breaking project `cwd`.
- [ ] Make actual runtime skill paths come from the materialized workspace.
- [ ] Make generated instructions reach the actual runtime prompt path.
- [ ] Add a real session integration test.
- [ ] Decide and implement startup/restart reinjection rather than trusting stale files.
- [ ] Pause for manual runtime review.
