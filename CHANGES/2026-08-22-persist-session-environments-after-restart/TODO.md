# Persist session environments after restart

## Context

Close GitHub issue #118 by ensuring a session resumed after a Rook restart regains its explicitly entered environments and the approved/personal workspace projections associated with them.

## Decision details

Keep the existing SQLite `session_environments` membership and bundle-hash approval model. During lazy session restoration, rehydrate persisted environment IDs from the repository into the fresh in-memory environment manager before materializing the session workspace and recovering the ACP session. If an environment no longer has valid repository bundles, leave its durable membership intact but skip its active projection so the session can still resume. Do not persist the transient availability cache or add client-facing API contracts.

Add hermetic regression coverage that uses temporary SQLite repositories/application state and fake or mock runtimes, verifies restart/resume with approved canonical and personal capabilities, and verifies that unavailable environments do not block restoration. Preserve existing runtime `session/load` behavior and keep unrelated working-tree changes untouched.

## Work checklist

- [ ] Add repository-backed environment rehydration for persisted session memberships.
- [ ] Ensure restoration materializes approved/personal bundles and waits for the resulting runtime restart before resume.
- [ ] Handle missing/unavailable environments without dropping durable membership or failing session resume.
- [ ] Add focused repository/service tests for rehydration behavior.
- [ ] Add an end-to-end shutdown/restart/session-resume regression test with temporary stores and fake/mock runtime processes.
- [ ] Review changed files for compatibility surfaces and annotate or record any retained compatibility behavior.
- [ ] Update relevant architecture/product/README documentation if the implemented behavior differs from current documentation.
- [ ] Run focused server tests, typecheck/build, and final validation; inspect the diff and complete lifecycle records.
