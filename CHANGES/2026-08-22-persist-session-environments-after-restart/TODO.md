# Persist session environments after restart

## Context

Close GitHub issue #118 by ensuring a session resumed after a Rook restart regains its explicitly entered environments and the approved/personal workspace projections associated with them.

## Decision details

Keep the existing SQLite `session_environments` membership and bundle-hash approval model. During lazy session restoration, rehydrate persisted environment IDs from the repository into the fresh in-memory environment manager before materializing the session workspace and recovering the ACP session. If an environment is unavailable, leave its durable membership intact, surface it as an unavailable entered entry, and recreate its deterministic personal authoring projection for non-directory environments. External capability bundles remain unavailable until the environment is registered again. Do not persist the transient availability cache or add client-facing API contracts.

Add hermetic regression coverage that uses temporary SQLite repositories/application state and fake or mock runtimes, verifies restart/resume with approved canonical and personal capabilities, and verifies that unavailable environments do not block restoration. Preserve existing runtime `session/load` behavior and keep unrelated working-tree changes untouched.

## Work checklist

- [x] Add repository-backed environment rehydration for persisted session memberships.
- [x] Ensure restoration materializes approved/personal bundles and waits for the resulting runtime restart before resume.
- [x] Handle missing/unavailable environments by retaining durable membership, showing an unavailable entered entry, and recreating deterministic personal authoring projections.
- [x] Add focused repository/service tests for rehydration behavior.
- [x] Add an end-to-end shutdown/restart/session-resume regression test with temporary stores and fake/mock runtime processes, including an unavailable environment's personal authoring projection.
- [x] Review changed files for compatibility surfaces; none were retained, so no compatibility annotations were needed.
- [x] Update relevant architecture/product/README documentation.
- [x] Run focused server tests, typecheck/build, and final validation; inspect the diff and complete lifecycle records.
