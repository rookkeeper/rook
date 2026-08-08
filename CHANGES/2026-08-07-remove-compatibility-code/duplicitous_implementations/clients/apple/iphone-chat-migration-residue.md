# iPhone chat migration residue after `SessionHandle`

**Architecture area:** iPhone client / RookKit shared chat lifecycle.

**Status:** Resolved in code: iPhone projects handle-backed queue state and no longer owns duplicate lifecycle scaffolding.

## Current implementation

`RookKit.SessionHandle` owns one socket, blocks, queued messages, replay state, reconnection, and event reduction. `RookModel` should project that state and retain only iPhone-specific location, voice, and Live Activity behavior.

## Residue in `RookModel`

- `clients/iphone/Sources/RookModel.swift:474-476` retains a private `ensureSocketConnected()` whose body is deliberately empty because `SessionHandle` owns the socket.
- `RookModel.swift:641-666` retains `pendingSocketResume` lifecycle scaffolding even though the comment says reconnection is handled by `SessionHandle`; the flag only gates another handle load/attach call.
- `RookModel.swift:38` declares `queuedMessages: [String]`, but `syncChatState()` only copies blocks/run/socket/usage state (`RookModel.swift:624-638`) and never projects `handle.queuedMessages`. The iPhone chat view still renders this old queue property (`clients/iphone/Sources/Views/ChatScreen.swift:23-30`).
- `RookModel.swift:724-734` retains a model-local block counter/error appender while the handle owns chat block reduction. These are still used for voice/location/offer system messages, so they are not automatically removable; they need a deliberate split between app-owned notices and session-owned blocks.

## Assessment

Confirmed migration residue, with one visibly stale queue implementation. The no-op helper is dead. The lifecycle flag may be a thin app lifecycle adapter rather than a duplicate, but its behavior overlaps the handle and should be simplified. The local block helper is partly legitimate and is cataloged for boundary review rather than marked dead.

## Cleanup decision needed

Project `SessionHandle.queuedMessages` into iPhone state or move queue rendering to the handle-backed type. Remove `ensureSocketConnected()`. Decide whether scene activation should call a small explicit handle reconnect method instead of retaining a duplicate resume state machine. Keep only a clearly named app-notice append path if iPhone-specific notices still need to enter the chat.

## TODOs

- [x] Add a state projection for `SessionHandle.queuedMessages` and update the iPhone queue UI type.
- [x] Remove the no-op `ensureSocketConnected()` helper.
- [x] Simplify `pendingSocketResume` around an explicit SessionHandle lifecycle API.
- [x] Separate app-owned notices from session-owned chat blocks.
- [x] Add iPhone tests for queue updates and scene reconnect behavior.
