# WebSocket `session/list` versus REST session discovery

**Architecture area:** sessions and ACP facade.

**Status:** Resolved: REST is canonical and the WebSocket compatibility path was removed.

## Current implementation

The as-built contract uses `GET /api/sessions`. RookKit, Mac, and iPhone call `RookAPI.sessions()`, and Android calls `RookApi.sessions()`.

## Older/compatibility implementation still present

- `server/src/runtime/routes/acpFacadeRoute.ts:107-110` handles unbound ACP `session/list` and explicitly says REST is preferred.
- `clients/RookKit/Sources/RookKit/Net/AcpSocket.swift:71-82` exposes `sessionList()` and sends `session/list`; no production caller uses this method.
- `clients/android/app/src/main/java/com/rookery/rook/net/AcpSocket.kt:197-200` exposes the same unused method.
- `clients/cli/src/commands/sessions.mjs:1-49` uses the legacy WebSocket command instead of `GET /api/sessions`.
- The mock ACP server also implements `session/list` for fixture compatibility.

## Assessment

Confirmed duplicate protocol paths. The server path may be intentional ACP compatibility, but the unused Apple/Android methods and CLI command keep the old discovery approach alive. This is exactly the old/new split called out by the architecture docs.

## Cleanup decision needed

Migrate `clients/cli`'s sessions command to REST first. Then remove unused `sessionList()` methods and decide whether the server/mock `session/list` alias remains for external ACP clients. If it remains, document it as a bounded compatibility endpoint rather than treating it as a current client API.

## TODOs

- [x] Change `clients/cli/src/commands/sessions.mjs` to call `GET /api/sessions`.
- [x] Remove unused Swift and Kotlin `sessionList()` methods.
- [x] Decide whether external ACP compatibility requires server `session/list` support.
- [x] Update the mock ACP fixture and tests according to that decision.
