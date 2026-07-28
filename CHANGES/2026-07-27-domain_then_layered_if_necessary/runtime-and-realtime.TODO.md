# Runtime and realtime TODO

This chunk groups ACP websocket handling, runtime subprocess management, and realtime session event fanout into a domain-first organization.

## Current likely inputs

- `server/src/server/routes/acpFacadeRoute.ts`
- `server/src/server/routes/runtimeRoutes.ts`
- `server/src/server/runtime/SessionRuntime.ts`
- `server/src/server/runtime/runtimeLaunchPlan.ts`
- `server/src/server/services/AgentRuntimeManager.ts`
- `server/src/server/realtime/*`
- `server/src/server/extensions/parentMessageTool.ts`
- `server/src/server/acpFacade.test.ts`

## Goals

- Create a coherent domain for runtime/session transport behavior.
- Keep websocket ACP behavior identical.
- Keep runtime subprocess lifecycle identical.
- Keep session notification fanout identical.
- Avoid accidental changes to session/environment interaction while moving files.

## Proposed direction

- Evaluate whether `realtime` remains a nested part of a runtime/session-transport domain or a small standalone support domain.
- Move `AgentRuntimeManager` and `SessionRuntime` into the same domain neighborhood.
- Move ACP facade and runtime routes into that domain's `routes/` area.
- Keep explicit seams to `sessions` and `environments` domains rather than re-inlining their logic.

## Steps

- [x] Confirm all imports from runtime orchestration into sessions, environments, and shared infrastructure.
- [x] Move `SessionRuntime` and launch-plan helpers.
- [x] Move `AgentRuntimeManager`.
- [x] Move websocket ACP facade route.
- [x] Move runtime REST routes.
- [x] Move/rename realtime helper files only after the owning domain is clear.
- [x] Reassess whether `parentMessageTool` belongs here.

## Verification

- [x] `npm run typecheck --prefix server`
- [x] `npm run test --prefix server`
- [x] Run `server/src/server/acpFacade.test.ts`.
- [x] Run targeted runtime/orchestration tests if more are added during the refactor.
- [x] Confirm websocket session binding semantics are unchanged.
- [x] Confirm runtime restart / replacement behavior is unchanged.
