# Serialize Pi ACP session mapping operations

## Context

Prevent Rook-managed Pi ACP runtimes from losing session-to-transcript mappings when multiple sessions are created or recovered concurrently. Also prevent environment-driven runtime replacement from interrupting active prompts.

## Decision details

Implement the mitigation in Rook without changing the `pi-acp` dependency. Add a server-wide asynchronous gate around ACP operations that can mutate Pi ACP session mappings (`session/new` and `session/load`), while leaving ordinary prompts concurrent. Make environment-driven replacement wait for active turns to finish before retiring the current runtime. Preserve the existing replacement-before-close behavior and per-session restart queues.

This is a Rook-side mitigation, not a complete fix for independent `pi-acp` processes or interrupted adapter file writes. Do not modify production `~/.rook` state.

## Work checklist

- [ ] Add a server-wide ACP session-mutation gate covering creation, recovery, explicit load, and environment replacement.
- [ ] Make environment-driven runtime replacement wait for active prompts before swapping runtimes.
- [ ] Add regression tests for cross-session mutation serialization and prompt-safe replacement.
- [ ] Inspect changed files for compatibility surfaces and annotate retained compatibility behavior.
- [ ] Update relevant architecture/product documentation.
- [ ] Run focused tests, typechecks, and final validation.
- [ ] Synchronize with `origin/main` and prepare the pull request.
