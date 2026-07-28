# Environments TODO

This chunk consolidates environment behavior under a single `environments` domain while preserving the current offer/decision/repository behavior exactly.

## Current likely inputs

- `server/src/server/routes/environmentRoutes.ts`
- `server/src/server/routes/diagnosticRoutes.ts`
- `server/src/server/environment/*`
- environment-related uses inside `AgentRuntimeManager`
- environment-related wiring in `index.ts`

## Goals

- Create a single `environments` domain.
- Inside it, use `routes/`, `services/`, `repositories/`, and `datastores/` only where those layers exist for real.
- Keep environment registration, preview, offer, decision, and diagnostic APIs identical.
- Keep bundle hash computation and repository resolution identical.
- Keep persistent decision storage identical.
- Keep prompt/binding side effects identical.

## Proposed direction

- `EnvironmentManager` becomes an environment-domain service.
- `EnvironmentRepositoryService` becomes an environment-domain service unless later folded into repository orchestration without behavior changes.
- `EnvironmentRepository` and its concrete implementations become environment-domain repositories.
- `EnvironmentDecisionStore` likely becomes an environment-domain datastore-backed repository implementation, but its SQL and schema must not change.
- `environmentRoutes.ts` and `diagnosticRoutes.ts` move into environment-domain routes if diagnostics remain environment-owned.
- Prompt/template/type helpers stay close to the environment domain rather than getting scattered into generic layer folders.

## Steps

- [x] Split environment files conceptually into routes / services / repositories / datastores / support.
- [x] Decide whether `diagnosticRoutes.ts` stays environment-owned or becomes a tiny cross-domain diagnostics area.
- [x] Move repository abstractions and concrete repository implementations together.
- [x] Move decision persistence with no SQL changes.
- [x] Move manager/service/prompt/binding helpers.
- [x] Move environment routes last in this chunk to minimize wiring churn.
- [x] Update tests as files move.

## Verification

- [x] `npm run typecheck --prefix server`
- [x] `npm run test --prefix server`
- [x] Run all environment tests:
  - [x] `EnvironmentManager.test.ts`
  - [x] `EnvironmentDecisionStore.test.ts`
  - [x] `EnvironmentRepository` implementation tests
  - [x] `SessionDecisionRegistry.test.ts`
  - [x] prompt/template/binding tests
- [x] Confirm `/api/environments/*`, `/api/session/environments`, and diagnostics behavior are unchanged.
- [x] Confirm environment decision table schema is unchanged.
- [x] Confirm environment-repository filesystem layout assumptions are unchanged.
