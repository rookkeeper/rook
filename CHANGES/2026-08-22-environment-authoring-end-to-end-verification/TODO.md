# Environment authoring end-to-end verification

## Context

`CHANGES/Remaining.md` records the remaining verification work for environment instructions, skills, aggregate workspace projection, and persistence. This change turns that conversation record into an implementation-ready lifecycle plan.

## Decision details

- Use the existing ACP facade integration-test boundary with isolated temporary state and fake runtime/process fixtures.
- Cover directory, web, and Mac app environments in one end-to-end flow: author skills and instructions, open a new session against the same environments, verify the projected workspace, edit the authored content, verify persistence in another session, and finally delete it and verify deletion in a subsequent session.
- Inspect the visible `AGENTS.md` aggregate and `.agents/skills` contents after each mutation. Do not assert on special symlinked directories, and do not instruct the agent to use those directories.
- Verify the general Rook instructions, aggregate editable-environment tags, authoring guidance, and injection of all applicable skills and agent files.
- Review `server/src/environments/support/RookIdentityPrompt.ts` as part of the work.
- Cover environments that are not rideable but still receive skills and agent files from a canonical environment repository.

## Work checklist

- [ ] Review `server/src/environments/support/RookIdentityPrompt.ts` and confirm the general Rook instructions describe the current environment-authoring behavior.
- [ ] Add or update integration coverage for creating skills and instructions in directory, web, and Mac app environments.
- [ ] Start a new session for the same environments and verify the visible aggregate `AGENTS.md` and `.agents/skills` projections.
- [ ] Modify each relevant skill and instruction through the agent-facing authoring paths, checking the visible projections after every modification.
- [ ] Start another session and verify that skill and instruction edits persist for the same environments.
- [ ] Delete the authored skills and instructions, then verify from a new session that they are actually absent.
- [ ] Verify the aggregate file has correct editable tags and that its authoring guidance is understandable.
- [ ] Verify all expected skills and agent files are injected, including canonical repository content for environments that are not rideable.
- [ ] Keep the test hermetic: use temporary repositories/workspaces and fake runtimes/listeners without touching real `~/.rook` state or stopping a developer's Rook instance.
- [ ] Update product, architecture, or README documentation only if the verified behavior exposes an inaccurate description.
- [ ] Review changed files for compatibility surfaces and annotate or document any retained behavior.
- [ ] Run focused server integration tests, typechecks, and final validation; then complete the lifecycle record.
