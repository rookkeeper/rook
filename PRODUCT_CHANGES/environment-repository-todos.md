# Environment repository redesign todos

Use this file as the working checklist while implementing the environment repository redesign.

Todo document instructions:
- Create, to the best of your abilities, a reasonable but not over-specific todo list for how to make these changes.
- Every time you get something done, mark it off the list.
- There will be times where what you thought should be done is actually a little different because the code is not shaped quite like you thought it was. In that case, modify the todo list.
- Sometimes you will find new things to do. In that case, also modify the todo list.
- Always come back and check the boxes as you finish things.
- If you run into anything scary that you do not know what you should do, and it is just a minor thing, go ahead and do your best because the code can always be undone and everything is committed.
- If it is something that drastically breaks down what we already talked about today, stop and discuss it.

Rules for maintaining this list:
- Check items off as soon as they are genuinely done.
- If implementation reveals a better sequence or a more accurate task breakdown, update this list.
- If new necessary work appears, add it here.
- If something small is ambiguous, make a reasonable call and keep moving.
- If something would materially contradict today's design decisions, stop and discuss.

## 1. Lock in core TypeScript domain shapes

- [x] Define the first-pass TypeScript types for `EnvironmentRecord`.
- [x] Define the first-pass TypeScript types for bundle-level objects.
- [x] Define the first-pass TypeScript types for bundle content groups:
  - [x] skills
  - [x] MCP servers
  - [x] apps
- [x] Define the `repository` field shape on returned bundles.
- [x] Define the first-pass error/result shape for repository reads.
- [x] Decide whether repository reads return `[]` + errors, `null`, or a result object wrapper.
- [x] Put the shared environment-repository domain types in an appropriate shared TypeScript location.

## 2. Replace the old repository abstraction

- [x] Identify all current responsibilities of `LocalEnvironmentRepository`.
- [x] Design the `EnvironmentRepository` base abstraction around bundle lookup instead of skill-path lookup.
- [x] Add `DirectoryEnvironmentRepository`.
- [x] Add `CompositeEnvironmentRepository`.
- [x] Make sure the repository layer is responsible for reading from storage and returning canonical bundle objects.
- [x] Keep service/business logic out of the repository implementations as much as possible.

## 3. Add a thin service layer for repository access

- [x] Create a service layer object for environment repository lookups.
- [x] Make the service responsible for “get environment bundles for environment id”.
- [x] Keep the initial service implementation intentionally thin.
- [x] Make the service return structured errors that higher layers can surface cleanly.

## 4. Implement directory-backed filesystem reading

- [x] Resolve environment ids like `<type>:<path>` to directory-backed repository lookups.
- [x] Teach the directory-backed repository to find `.bundles/` under an environment directory.
- [x] Teach it to enumerate bundle directories.
- [x] Teach it to detect recognized bundle content directories:
  - [x] `skills/`
  - [x] `mcp-servers/`
  - [x] `apps/`
- [x] Teach it to read bundle text files into the canonical in-memory bundle representation.
- [x] Read skill directories using the existing skill shape (`SKILL.md`, optional subdirectories).
- [x] Read MCP server bundle content as text/config artifacts.
- [x] Read app bundle content as text/instruction artifacts.
- [x] Add filesystem-structure validation on read.
- [x] Surface invalid bundle/directory structure as structured errors.

## 5. Support multiple repository roots

- [x] Wire one directory-backed repository to the monorepo root `environment-repository/`.
- [x] Wire a second directory-backed repository to `~/.rook/environment-repository/`.
- [x] Combine them through `CompositeEnvironmentRepository`.
- [x] Make sure the composite repository returns all bundles for the same environment across both roots.
- [x] Include the originating repository identifier on each returned bundle.
- [x] For now, assume there are no bundle-id collisions across repositories.

## 6. Update server wiring

- [x] Replace current `LocalEnvironmentRepository` construction in server bootstrap with the new repository stack.
- [x] Introduce the new repository service into the server wiring.
- [x] Keep the surrounding environment-manager wiring working while the repository layer changes underneath it.
- [x] Remove old assumptions that the repository returns raw skill paths as its primary abstraction.

## 7. Bridge from bundles back to today’s EnvironmentManager needs

- [x] Identify exactly where `EnvironmentManager` currently expects skill paths.
- [x] Introduce a temporary internal bridge that derives the currently needed runtime inputs from returned bundles.
- [x] Restrict that bridge to the smallest possible surface area.
- [x] Avoid reintroducing the old repository model while building the bridge.
- [x] Keep the bridge clearly marked as transitional if needed.

## 8. Update preview/inspection behavior

- [x] Identify all current preview-related code paths.
- [x] Redesign `/api/environments/preview` response to be bundle-oriented instead of skill-only.
- [x] Decide what the repository/service should return for inspection of bundle contents.
- [x] Return preview data as an environment plus an array of bundles.
- [x] For each valid bundle, return the filesystem review structure for everything inside `.bundles/<bundle-id>/`.
- [x] For each invalid bundle, also return its error(s) so the UI can show a red error box above the bundle review.
- [x] Keep invalid bundles in the preview response.
- [x] Update preview code to render bundle-organized content instead of skill-only content.
- [x] Keep in mind that preview is not a repository concept; it is a higher-layer rendering of repository contents.
- [x] Ensure the returned data is sufficient for clients/UI to show digestible bundle contents.
- [x] Ensure preview/UI affordances can grey out acceptance buttons for invalid bundles except for `ignore`.

## 9. Update tests for the new repository design

- [x] Add unit tests for `DirectoryEnvironmentRepository`.
- [x] Add unit tests for `CompositeEnvironmentRepository`.
- [x] Add tests for environment lookup with no bundles.
- [x] Add tests for hierarchical environment lookup.
- [x] Add tests for multiple repositories contributing bundles to the same environment.
- [x] Add tests for filesystem-structure validation failures.
- [x] Update server tests that currently rely on `demo:demo` or old fixture layout.
- [x] Add tests for `web:example.com` and `web:example.com/stuff` fixture behavior.

## 10. Replace fixture layout

- [x] Remove `environment-repository/demo/` fixtures.
- [x] Add `web:example.com` fixture content.
- [x] Add `web:example.com/stuff` fixture content.
- [x] Add new bundle-structured fixture directories that match the redesigned filesystem layout.
- [x] Add fixtures covering:
  - [x] skills-only bundle
  - [x] skill + MCP server bundle
  - [x] app instructions + skill bundle
  - [x] invalid bundle structure

## 11. Migrate naming from `place:` to `loc:`

- [x] Find all remaining `place:` references in code, tests, and docs.
- [x] Update iPhone code from `place:` to `loc:`.
- [x] Update server/shared docs that still say `place:` when they should now say `loc:`.
- [x] Verify current environment registration/unregistration flows still work after the rename.

## 12. Update docs that should move with the code

- [x] Update root `README.md` where the repository shape is described.
- [x] Update `server/README.md` for the new repository/service architecture.
- [x] Update relevant `PRODUCT/` docs if the as-built architecture changes materially during implementation.
- [x] Keep `PRODUCT_CHANGES/environment-repository.md` aligned with major implementation decisions if they shift.

## 13. Agent-facing local authoring follow-up

- [x] Decide whether any implementation work is needed now for the simplified Rook-facing local skill view.
- [ ] If yes, create a minimal adapter/interface for “where are the skills for this environment?”.
- [x] If no, explicitly defer it and avoid accidentally baking in a conflicting repository API.
- [x] Preserve the future option of symlink-backed local authoring without committing to the exact mechanism yet.

## 14. Validation and error handling

- [x] Define the initial repository error categories.
- [x] Make repository reads preserve enough detail for higher layers to surface errors.
- [x] Keep filesystem-structure validation narrow and practical for the first pass.
- [x] Defer deep validation of skill contents / MCP config semantics / app semantics until later.

## 15. Cleanup and removal

- [x] Remove or retire obsolete `LocalEnvironmentRepository` code once the new stack fully replaces it.
- [x] Remove obsolete tests tied to the old repository assumptions.
- [x] Remove dead helpers that only existed for skill-path-centric repository behavior.
- [ ] Commit before doing a broad simplification / cleanup pass.
- [ ] Do a quick runthrough after the commit to see whether any transitional code can now be simplified or removed.
- [x] Make sure there is no accidental transitional adapter architecture left behind beyond the smallest necessary bridge.

## 16. Final verification

- [x] Run the relevant server tests.
- [x] Run any additional targeted checks for environment registration and repository lookup.
- [x] Add/adjust test coverage for bundle-oriented preview behavior and other user-visible features (test features, not minutiae).
- [x] Confirm docs and tests are in sync with the new repository direction.
- [x] Review the todo list itself and update/check off anything that changed during implementation.

## 17. To do next

- [x] Remove or convert any remaining skill-only approval/preview code paths so offer review is bundle-oriented end to end.
- [ ] Decide whether `EnvironmentManager` / runtime loading should also move from skill-path-oriented bridging to a fully bundle-oriented contract.
- [ ] If that next step needs a design decision rather than straightforward implementation, stop and ask for input before pushing ahead.
