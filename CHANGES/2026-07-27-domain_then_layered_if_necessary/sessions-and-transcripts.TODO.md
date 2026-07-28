# Sessions and transcripts TODO

This chunk groups session persistence, session routes, and transcript persistence into a single domain-first area.

## Current likely inputs

- `server/src/server/routes/sessionRoutes.ts`
- `server/src/server/repositories/SessionRepository.ts`
- `server/src/server/datastore/SqliteSessionRepository.ts`
- `server/src/server/datastore/SqliteSessionRepository.test.ts`
- `server/src/server/services/SessionTranscriptStore.ts`
- `server/src/server/services/sessionTranscriptEvents.ts`
- session-related portions of ACP/runtime tests that rely on session records and transcript storage

## Goals

- Create a `sessions` domain as the home for session records and transcript persistence.
- Inside `sessions`, use `routes/`, `repositories/`, and `datastores/` only where they add clarity.
- Keep session REST APIs identical.
- Keep transcript event persistence and normalization behavior identical.
- Keep SQLite schema identical.

## Proposed direction

- Move `SessionRepository.ts` into the `sessions` domain as the repository contract.
- Move `SqliteSessionRepository.ts` into `sessions/datastores/` or `sessions/repositories/` depending on the final convention.
- Move `SessionTranscriptStore.ts` into the `sessions` domain, likely `services/` or `datastores/` depending on whether it remains orchestration versus persistence.
- Move `sessionTranscriptEvents.ts` alongside transcript storage and transcript route consumers.
- Move `sessionRoutes.ts` into `sessions/routes/`.

## Steps

- [x] Confirm full dependency graph for sessions and transcripts.
- [x] Move types/contracts first.
- [x] Move concrete SQLite-backed session persistence next.
- [x] Move transcript storage and helpers.
- [x] Move session routes.
- [x] Update imports after each sub-step.
- [x] Keep test files moving with their subjects where that improves locality.

## Verification

- [x] `npm run typecheck --prefix server`
- [x] `npm run test --prefix server`
- [x] Run targeted session repository tests.
- [x] Run targeted transcript/session route tests if isolated invocation is useful.
- [x] Confirm `sessions` and `session_environments` tables are unchanged.
- [x] Confirm transcript table usage is unchanged.
