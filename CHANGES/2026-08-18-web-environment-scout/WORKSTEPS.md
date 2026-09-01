# Development lifecycle worksteps

> As you work through the development lifecycle, make sure that you check the boxes in the following list as you finish with each item. If you've chosen to go an unusual path like skipping, and I don't hear then make an explicit note to the side of each bullet explaining the departure and the rationale.

- [x] Orient to the project
- [x] Create the change directory and lifecycle record
- [x] Brainstorm to work, or bypass because the work is simple or obvious; do not mark complete until the developer confirms the direction
- [x] Record the agreed decision and TODO after the explicit decision gate
- [x] Prepare the implementation workspace after the planning commit
- [x] Implement and test
- [x] Mark upgrade surfaces — the final design uses the unchanged main schema and needs
      no migration; the rejected discriminator-column design was never merged.
- [x] Maintain product and architecture documentation
- [x] Run final validation — original pass: server typecheck (both configs) + 220 tests,
      RookKit 69 tests, Mac build + offer-controller tests. Review-item pass: both server
      typechecks and all 68 affected repository/scout/trigger tests pass; the full suite
      passes 205 tests but the sandbox denies the ACP listener and times out three
      filesystem-watcher tests on both attempts. Round 2: both server typechecks and all
      75 publisher/scout/trigger/manager tests pass; the new read-only workspace test
      passes. The full suite passes 203 tests, while the sandbox again denies the two
      loopback integration listeners and times out the same three watcher tests.
- [x] Synchronize with main before submitting — origin/main unchanged at 0b6cdc8; branch is 0 behind. Re-synchronized with main 2026-08-21 (post PR #152 merge and transcript-store removal); conflicts were wiring/docs/tests only.
- [x] Open and validate the PR — #159, mergeable
- [x] Address review feedback round 1 (2026-08-24) — site-specific generated `llms.txt`
      skills, raw-byte digest verification, and shared personal/web repository storage
      with metadata-backed scout state are complete.
- [x] Address review feedback round 2 (2026-08-25) — one environment row per id,
      publisher-scoped scout writes, no web repository projection, and explicit
      `scoutPublished` read-only handling are complete.
- [x] Address manual checklist findings (2026-08-30) — decision requests without a
      `bundleHash` are now rejected with 400 instead of silently authorizing
      nothing; the cross-session temporary-approval leak is filed as issue #182
      (predates this branch, not fixed here).
- [ ] Merge with approval
- [ ] Record outcomes and clean up
