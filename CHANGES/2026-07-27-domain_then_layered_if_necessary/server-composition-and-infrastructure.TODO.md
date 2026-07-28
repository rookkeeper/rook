# Server composition and infrastructure TODO

This chunk defines the target domain map and isolates the truly cross-domain infrastructure before business-domain moves start.

## Scope

Likely files in scope:

- `server/src/server/index.ts`
- `server/src/server/auth.ts`
- `server/src/server/paths.ts`
- `server/src/server/serverPaths.ts`
- `server/src/server/remoteProxy.ts`
- `server/src/server/config/*`
- maybe `server/src/server/extensions/*`
- maybe low-level datastore bootstrap such as `RookDatastore.ts`

## Goals

- Identify what is truly cross-domain infrastructure versus what belongs inside a business domain.
- Define the target domain tree before moving feature code.
- Keep server bootstrap behavior identical.
- Keep route registration and dependency wiring identical.

## Proposed direction

- Keep a small top-level area for cross-domain composition/infrastructure only.
- Candidate names to evaluate: `core/`, `infrastructure/`, or `platform/`.
- Keep `index.ts` as the server composition root unless there is a very strong reason to move it.
- Keep `auth`, config loading, path helpers, and remote proxy in the cross-domain area unless a clearer home emerges.
- Keep `RookDatastore` in cross-domain infrastructure if it stays a shared SQLite connection primitive rather than a domain repository.
- Current candidate business domains, based on the present code layout and wiring: `sessions`, `runtime` (or `session-transport`), `environments`, and `location`.
- Current candidate support areas, if still needed after refactor: `infrastructure`, `config`, and maybe a very small `shared/` for cross-domain types/helpers that are not domain-owned.

## Steps

- [x] Inventory bootstrap dependencies imported by `index.ts`.
- [x] Record the current `index.ts` dependency map here before moving code:
  - [x] environment wiring: `EnvironmentManager`, environment repositories, decision store, metadata capture sink
  - [x] location wiring: `EnvironmentIdentifier`, `LocationRegistrar`, POI provider, fetch-range helper
  - [x] session/runtime wiring: `SqliteSessionRepository`, `SessionTranscriptStore`, `AgentRuntimeManager`
  - [x] route wiring: environment, diagnostics, runtime, session, ACP facade
  - [x] cross-cutting wiring: auth, config, datastore, repo root/path helpers, remote proxy
- [x] Classify each dependency as domain-owned or cross-domain.
- [x] Decide the final home for `RookDatastore`.
- [x] Decide whether route registration stays centralized in `index.ts` or becomes per-domain exports gathered there.
- [x] Decide whether `extensions/parentMessageTool.ts` belongs with runtime/session orchestration or shared infrastructure.
- [x] Create the target folder map in this TODO once decided.
- [x] Perform only the minimum moves needed to establish the stable composition root.
- [x] Add temporary bridge exports only if they reduce risk for later chunks.

## Verification

- [x] `npm run typecheck --prefix server`
- [x] `npm run test --prefix server`
- [x] Confirm server startup wiring in `index.ts` is behaviorally unchanged.
- [x] Confirm route registration output is unchanged where tests cover it.
