# Development lifecycle worksteps

> As you work through the development lifecycle, make sure that you check the boxes in the following list as you finish with each item. If you've chosen to go an unusual path like skipping, and I don't hear then make an explicit note to the side of each bullet explaining the departure and the rationale.

- [x] Orient to the project
- [x] Create the change directory and lifecycle record
- [x] Brainstorm to work, or bypass because the work is simple or obvious; do not mark complete until the developer confirms the direction
- [x] Record the agreed decision and TODO after the explicit decision gate
- [x] Prepare the implementation workspace after the planning commit
- [x] Implement and test
- [x] Mark compatibility surfaces — none retained: all additions (new repository, new tables, new optional API fields); the only pre-existing type widened is `SQLiteEnvironmentRepository` (`db`, `writeBundle`, `upsertEnvironment`, `deleteOrphanedCapabilities` → `protected`) with no behavior change
- [x] Maintain product and architecture documentation
- [x] Run final validation — server typecheck (both configs) + 220 tests, RookKit 69 tests, Mac build + offer-controller tests; one pre-existing acpFacade flake reproduces on origin/main
- [x] Synchronize with main before submitting — origin/main unchanged at 0b6cdc8; branch is 0 behind
- [x] Open and validate the PR — #159, mergeable
- [ ] Merge with approval
- [ ] Record outcomes and clean up
