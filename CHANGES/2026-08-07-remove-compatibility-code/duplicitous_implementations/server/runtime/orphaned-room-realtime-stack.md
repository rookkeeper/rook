# Orphaned room/realtime stack

**Architecture area:** server runtime realtime routing.

**Status:** Resolved: the orphaned realtime classes and support types were removed.

## Older implementation

- `server/src/runtime/realtime/RoomEventStream.ts` implements a room-style subscriber set, serialized publish queue, and replay cache for selected session updates.
- `server/src/runtime/realtime/EnvironmentEventStub.ts` implements an unused future environment-event publisher.
- `server/src/runtime/realtime/types.ts` and `server/src/shared/realtime.ts` only carry the types needed by those classes.

## Current implementation

`server/src/runtime/services/AgentRuntimeManager.ts` owns session subscribers, notification routing, private replay targets, replay waiters, environment offers, and runtime lifecycle. `server/src/runtime/routes/acpFacadeRoute.ts` subscribes directly to that manager.

## Evidence

- The realtime classes have no imports outside their own files (`git grep` found no live consumers).
- `RoomEventStream.ts:21-66` contains the old room abstraction.
- `EnvironmentEventStub.ts:7-15` calls itself a future stub.
- The old-room removal commit is `011394a` (“Delete old room/agent stack, add ACP facade tests”), but these files survived the cleanup.

## Assessment

Confirmed orphaned implementation, not a valid alternate backend. Keeping it makes the repository appear to support a room/realtime architecture that the as-built server no longer uses.

## Cleanup decision needed

Delete the two classes, the re-export `runtime/realtime/types.ts`, and `shared/realtime.ts` after confirming no external consumers import them. Remove any now-empty realtime directory and update architecture wording only if it currently promises these helpers as live components.

## TODOs

- [x] Confirm no external package imports the orphaned realtime modules.
- [x] Remove `RoomEventStream`, `EnvironmentEventStub`, and their type-only support files.
- [x] Remove obsolete `_rookery_modes_state` replay assumptions that are only supported by this stack.
- [x] Run TypeScript diagnostics and the full server test suite.
