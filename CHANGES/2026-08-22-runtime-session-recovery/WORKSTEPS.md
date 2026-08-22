# Development lifecycle worksteps

> As you work through the development lifecycle, make sure that you check the boxes in the following list as you finish with each item. If you've chosen to go an unusual path like skipping, and I don't hear then make an explicit note to the side of each bullet explaining the departure and the rationale.

- [x] Orient to the project
- [x] Create the change directory and lifecycle record
- [x] Brainstorm bypassed because the server-side recovery direction is explicit and implementation scope is clear
- [x] Record the agreed decision and TODO after the explicit decision gate
- [x] Prepare the implementation workspace after the planning commit
- [x] Implement and test
- [x] Mark compatibility surfaces — retained PR #152 environment-restart fallback is annotated; ordinary runtime recovery does not use it
- [x] Maintain product and architecture documentation
- [x] Run final validation — focused tests, full server tests (152 passed, 5 skipped), typecheck, build, and diff check completed
- [ ] Synchronize with main before submitting
- [ ] Open and validate the PR
- [ ] Merge with approval
- [ ] Record outcomes and clean up
