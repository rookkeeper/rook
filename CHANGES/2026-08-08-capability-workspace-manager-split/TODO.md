# CapabilityWorkspaceManager split

## Context

We are going to refactor `server/src/runtime/CapabilityWorkspaceManager.ts` into a smaller set of focused modules while preserving the existing runtime/workspace behavior.

This change matters because the file is currently too broad: it mixes workspace orchestration, filesystem plumbing, aggregate `AGENTS.md` rendering, source bookkeeping, watcher logic, and write-back behavior in one place. That makes it harder to read, reason about, and safely modify.

The goal is a conservative split, not a redesign. We still want one top-level coordinator for workspace materialization; we just want fewer unrelated reasons for that coordinator to change.

## Details

Current file under discussion:

- `server/src/runtime/CapabilityWorkspaceManager.ts`

Important adjacent files reviewed so far:

- `server/src/runtime/CapabilityWorkspaceManager.test.ts`
- `server/src/runtime/services/AgentRuntimeManager.ts`
- `server/src/environments/services/EnvironmentManager.ts`
- `AS-BUILT-ARCHITECTURE/server.md`

Working split idea:

- keep `CapabilityWorkspaceManager` as the stateful coordinator for:
  - session projection lifecycle
  - source/session maps
  - watcher lifecycle and debounce scheduling
  - cross-session update fanout
- extract helper-heavy or mostly pure logic into:
  - `server/src/runtime/workspace/renderAggregateAgents.ts`
  - `server/src/runtime/workspace/workspaceFs.ts`
  - `server/src/runtime/workspace/workspaceSources.ts`
- only consider a further extraction like `projectWorkspaceReconciler.ts` if the manager still feels too large after the first pass

Expected responsibilities by target file:

- `server/src/runtime/CapabilityWorkspaceManager.ts`
  - coordinator only
  - orchestration, watchers, source persistence flow, session fanout
- `server/src/runtime/workspace/renderAggregateAgents.ts`
  - generated `AGENTS.md` rendering
  - inline fact formatting
  - rendering-only helper functions
- `server/src/runtime/workspace/workspaceFs.ts`
  - safe filesystem helpers
  - artifact read/write helpers
  - symlink/materialization helpers
  - read-only/chmod/remove-tree helpers
- `server/src/runtime/workspace/workspaceSources.ts`
  - source descriptor/key/digest helpers
  - path derivation for personal and staged sources
  - environment key/nickname helpers
  - fingerprint helpers
  - source-related shared types if that improves readability without causing circular imports

Guardrails:

- preserve the current public API of `CapabilityWorkspaceManager`
- preserve workspace layout and projected paths exactly unless we intentionally decide otherwise
- preserve current write-back behavior for personal and project-directory environments
- preserve aggregate `AGENTS.md` content semantics
- preserve watcher-driven refresh behavior
- keep existing tests passing and add tests only where the split itself creates risk
- prefer helper/pure-module extraction before inventing new service abstractions

This document can be refined as the code teaches us more, but the default should be to keep the plan stable and update the checklist honestly as work lands.

## Steps

### Discovery and boundary lock-in

- [ ] Re-read `server/src/runtime/CapabilityWorkspaceManager.ts` and group its contents by responsibility before moving code.
- [ ] Confirm current behavioral coverage in `server/src/runtime/CapabilityWorkspaceManager.test.ts` and note any gaps that would make the extraction risky.
- [ ] Decide whether `WorkspaceSource`, aggregate-rendering types, and related helpers should live in the manager file or move to `workspaceSources.ts`.
- [ ] Decide whether project-directory reconciliation stays in the manager for the first pass or is extracted immediately.
- [ ] Update this document if the planned module boundaries change materially during implementation.

### Extract aggregate rendering

- [ ] Create `server/src/runtime/workspace/renderAggregateAgents.ts`.
- [ ] Move `renderAggregateAgents` and its rendering-only helpers there.
- [ ] Keep the generated document content byte-for-byte equivalent unless we intentionally change it.
- [ ] Update imports/usages in `CapabilityWorkspaceManager.ts`.
- [ ] Verify tests that assert aggregate content still pass unchanged.

### Extract filesystem and artifact helpers

- [ ] Create `server/src/runtime/workspace/workspaceFs.ts`.
- [ ] Move low-level helpers there, including safe path handling, artifact materialization, skill file reading, symlink replacement, read-only application, and recursive deletion helpers.
- [ ] Keep helper names straightforward and avoid turning this into a generic shared filesystem library.
- [ ] Update `CapabilityWorkspaceManager.ts` to import the extracted helpers.
- [ ] Verify behavior around symlinks, chmod, and deletion inference remains unchanged.

### Extract source/path/fingerprint helpers

- [ ] Create `server/src/runtime/workspace/workspaceSources.ts`.
- [ ] Move source-descriptor, digest, path-derivation, environment-key/nickname, and fingerprint helpers there.
- [ ] Move any source-related shared types there if that improves readability without creating circular imports.
- [ ] Keep source identity semantics exactly the same so existing writable roots and manifests do not drift.
- [ ] Update the manager and tests to import the extracted helpers/types as needed.

### Simplify the manager after extraction

- [ ] Reduce `CapabilityWorkspaceManager.ts` to orchestration logic, watcher lifecycle, source persistence flow, and session fanout.
- [ ] Remove any now-dead local helpers/imports.
- [ ] Re-check that the file reads top-down as a coordinator rather than as a dump of unrelated utilities.
- [ ] If the file is still uncomfortably large, decide whether a follow-up extraction such as `projectWorkspaceReconciler.ts` is justified.

### Documentation and implementation notes

- [ ] Update this document with any important decisions or deviations discovered during implementation.
- [ ] Update `AS-BUILT-ARCHITECTURE/server.md` if the refactor meaningfully changes how the runtime workspace subsystem should be described.
- [ ] Update `PRODUCT/` if the refactor changes a documented product or architecture idea rather than being purely internal cleanup.
- [ ] Add a short completion note to this TODO once the split is done, including any deviations from the original plan.

### End-of-pass wrap-up

- [ ] Run targeted workspace tests: `npm run test --prefix server -- CapabilityWorkspaceManager` or the closest supported equivalent.
- [ ] Run the full server test suite.
- [ ] Run server typecheck.
- [ ] Run server build.
- [ ] Review the final diff specifically for accidental path/layout changes in generated workspaces.
- [ ] Review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code.
- [ ] Remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around.

## Exit criteria

- [ ] `CapabilityWorkspaceManager.ts` is materially smaller and reads primarily as a coordinator.
- [ ] Aggregate rendering, filesystem helpers, and source/path/fingerprint helpers are split into focused modules with clear boundaries.
- [ ] Runtime workspace behavior is unchanged from the user's point of view.
- [ ] Projected workspace layout, generated `AGENTS.md` semantics, and write-back behavior remain correct.
- [ ] Tests, typecheck, and build pass.
- [ ] No unnecessary backward-compatibility code, compatibility docs, fallback paths, or abandoned transition code remain from the refactor.
- [ ] Relevant `AS-BUILT-ARCHITECTURE/` and `PRODUCT/` docs are updated if needed.
