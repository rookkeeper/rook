# Development lifecycle worksteps

> As you work through the development lifecycle, make sure that you check the boxes in the following list as you finish with each item. If you've chosen to go an unusual path like skipping, and I don't hear then make an explicit note to the side of each bullet explaining the departure and the rationale.

- [x] Orient to the project
- [x] Create the change directory and lifecycle record
- [x] Brainstorm to work, or bypass because the work is simple or obvious; do not mark complete until the developer confirms the direction — bypassed: root cause was fully diagnosed in issue #151 and the developer approved the fix approach directly
- [x] Record the agreed decision and TODO after the explicit decision gate
- [ ] Prepare the implementation workspace after the planning commit
- [x] Implement and test
- [x] Mark compatibility surfaces — none retained; obsolete server-transcript recovery code was removed during the merge with current main
- [x] Maintain product and architecture documentation
- [x] Run final validation
- [x] Synchronize with main before submitting — merged origin/main after resolving the transcript-replay redesign conflict
- [ ] Open and validate the PR — update existing PR #152 after checks
- [ ] Merge with approval
- [ ] Record outcomes and clean up
