# Serialize Pi ACP session mapping operations

## Context

Prevent Rook-managed Pi ACP runtimes from losing session-to-transcript mappings when multiple sessions are created or recovered concurrently. Also prevent environment-driven runtime replacement from interrupting active prompts.

## Decision details

Implement the mitigation in Rook without changing the `pi-acp` dependency. Add a server-wide asynchronous gate around ACP operations that can mutate Pi ACP session mappings (`session/new` and `session/load`), while leaving ordinary prompts concurrent. Make environment-driven replacement wait for active turns to finish before retiring the current runtime. Preserve the existing replacement-before-close behavior and per-session restart queues.

This is a Rook-side mitigation, not a complete fix for independent `pi-acp` processes or interrupted adapter file writes. Do not modify production `~/.rook` state.

## Work checklist

- [x] Add a server-wide ACP session-mutation gate covering creation, recovery, explicit load, and environment replacement.
- [x] Make environment-driven runtime replacement wait for active prompts before swapping runtimes.
- [x] Add regression tests for cross-session mutation serialization and prompt-safe replacement.
- [x] Inspect changed files for compatibility surfaces; retain the pre-existing fallback without adding a new compatibility marker rejected by repository CI.
- [x] Update relevant architecture/product documentation.
- [x] Run focused tests and typecheck; run final build validation before submission.
- [x] Synchronize with `origin/main` and prepare the pull request.
