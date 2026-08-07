# Android old session transport beside the current contract

**Architecture area:** Android client session/chat flow.

**Status:** Resolved in code: Android uses session-bound sockets and transcript hydration; device/build verification remains part of final validation.

## Current contract

The common architecture is one session-bound ACP WebSocket per public session. A running session is hydrated from `GET /api/sessions/:id/transcript`; inactive sessions use ACP `session/load` when replay is needed.

## Android implementation still following the older path

- `clients/android/app/src/main/java/com/rookery/rook/net/AcpSocket.kt:197-223` keeps a mutable `sessionId`, an unbound `sessionList()`, and `loadSession(... includeSessionId = false)`.
- `RookViewModel.resumeSession()` always loads runtime replay before entering chat (`RookViewModel.kt:321-329`).
- `RookViewModel.scheduleReconnect()` always calls `socket.loadSession(session.id)` (`RookViewModel.kt:414-425`).
- `enterChat()` clears visible blocks and inserts a “earlier messages aren't replayed” banner (`RookViewModel.kt:341-355`) rather than attaching server transcript history for running sessions.
- The Apple implementation already branches on `session.running` and uses `SessionHandle.attach(transcript:)`.

## Assessment

Confirmed implementation lag and a second session lifecycle implementation, not merely a platform-language duplicate. The Android architecture note acknowledges that “some implementation details still lag the server contract.” It can cause Android to request runtime replay where the current contract expects transcript hydration and does not provide the same session-isolation behavior as the Apple handles.

## Cleanup decision needed

Port the SessionHandle lifecycle concepts to Android (or create an Android equivalent): session-bound socket per handle/session, transcript attachment for running sessions, and no replay on simple reopen. Then remove the mutable shared-session load path and its old resume banner once tests cover reconnect and running-session hydration.

## TODOs

- [x] Design an Android per-session handle/state container matching the current architecture.
- [x] Add REST transcript hydration for running sessions.
- [x] Connect resumed sessions with `?sessionId=` and isolate background session sockets.
- [x] Add tests for resume, reconnect, transcript hydration, and session switching.
- [x] Remove the mutable socket session selection and old replay banner after migration.
