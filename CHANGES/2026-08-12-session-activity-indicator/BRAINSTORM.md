# Session activity indicator

**Status: direction confirmed — implementation plan recorded in `TODO.md`**

## Problem

Issue #129's session-list status pill currently means `running + selected = Active`, `running = On`, and otherwise `Off`. That conflates selection with agent activity and loses asynchronous completed work. The indicator needs to communicate whether an ACP turn is in progress, whether completed output still needs the user's attention, and whether the runtime is merely alive.

## Investigation

- The current Mac and shared client model has only `active`, `on`, and `off` in `RookKit/Sources/RookKit/Models/ApiTypes.swift`; `selectionStatus` is derived from `running` and the selected session id.
- Mac session rows render that derived value in `RookView.swift`; the Mac session controller refreshes the list on entry/touch but has no session-list polling or server event subscription.
- `GET /api/sessions` serializes `running` from `AgentRuntimeManager.sessionHasRuntime`, which is an in-memory `sessionRuntimes` map. The map represents server-created/lazily recreated runtime wrappers, not a persisted runtime lifecycle state.
- `AgentRuntimeManager.requestForSession` knows when `session/prompt` completes and appends `run_completed`/`run_failed` transcript events, but there is no durable unread/pending-attention field and no endpoint to acknowledge that output was seen.
- `SessionHandle` already knows the ACP turn boundary: it sets `isRunning` on prompt delivery and clears it on `runCompleted`/`runFailed`. That state is local to the currently connected client/session handle.
- Rook's ACP product documentation says session recency is server-owned and clients touch sessions when entering them.
- The server has existing hermetic ACP integration tests and RookKit API-type tests suitable for state-transition coverage.

## Options and questions

1. **Persist attention state on the session record**
   - Add a server-owned pending/unread marker (or completion/view timestamps) to the session repository and API response.
   - Set it when a prompt turn completes/fails; clear it through an explicit view/acknowledgement operation when the user opens the session.
   - This handles asynchronous completion and runtime shutdown. Need decide whether a failed/cancelled turn also creates `Ready`.

2. **Represent active-turn state server-side**
   - Track in-progress `session/prompt` requests in `AgentRuntimeManager`, expose it as `active` in the session list, and clear it in success/failure/finally paths.
   - This avoids relying on a Mac WebSocket or selected handle for background sessions. It also makes `Active` consistent for every client.
   - Need ensure the request lifecycle covers queued prompts and runtime replacement without stale flags.

3. **Runtime liveness and list freshness**
   - Continue deriving `running` from the server's runtime manager, but add explicit lifecycle bookkeeping/logging around attach, replacement, process exit, and detach to diagnose the current `Off` bug.
   - For the visible session list, start with periodic REST refresh while the list screen is shown; later consider a server session-status event stream if polling is insufficient. Avoid assuming a client-local socket is the source of truth.

4. **Shared versus Mac-only presentation**
   - The status model is in RookKit and is also used by iPhone/Android. The first implementation should keep the API semantics shared while updating Mac presentation and tests; inspect other clients before changing their labels/icons.

## Confirmed direction

The server will be authoritative for the session-list state. The public state enum is:

`active` > `ready` > `error` > `on` > `off`

where `active` means an ACP turn is in progress, `ready` means a successful turn completed without the user having opened the session, `error` means a turn failed or returned an error without the user having opened the session, `on` means the runtime is alive with no pending result, and `off` means the runtime is not alive with no pending result. `Ready` and `Error` take precedence over runtime shutdown.

The durable database representation will use an enum/check-constrained attention state for the persisted pending result (`ready`, `error`, or acknowledged/clear); transient active-turn tracking and runtime liveness remain server-owned runtime state. Opening a session counts as looking at it and clears pending `ready`/`error` state through the existing touch/open flow. The implementation must account for a session that was already opened when its turn completes so it does not incorrectly become unread.

All three clients adopt the shared status model now. Periodic REST polling is the accepted first freshness mechanism for visible session-selection screens; a push event stream is out of scope for this iteration.
