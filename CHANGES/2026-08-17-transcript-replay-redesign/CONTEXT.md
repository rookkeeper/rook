# Transcript and replay context

**Status: factual inventory — not an implementation decision**

## Boundary

Rook currently has two session histories:

- the selected runtime's ACP session/history, replayed through `session/load`;
- a server-owned normalized transcript in SQLite, exposed through REST.

Clients use one session-bound ACP WebSocket for live interaction and REST for session discovery and, for running sessions, transcript hydration.

## Modules and APIs

### Server runtime transport

`server/src/runtime/SessionRuntime.ts`

- Owns one ACP-over-stdio subprocess for one public session.
- APIs: `initialize`, `request`, `notify`, `respond`, `onNotification`, `replacement`, `close`.
- Starts lazily, parses newline-delimited JSON-RPC, resolves responses, and emits notifications.
- It does not persist or replay transcript data itself.

### Server runtime broker

`server/src/runtime/services/AgentRuntimeManager.ts`

- Maps public session IDs to runtime-local ACP session IDs and subprocesses.
- APIs: create/list/get sessions, `requestForSession`, `notifyForSession`, `subscribe`, `respondToRuntime`, session deletion, and environment-driven replacement.
- On every runtime notification it:
  1. rewrites the runtime session ID to the public ID;
  2. routes runtime-originated requests;
  3. sends session-load replay privately when a private replay target exists;
  4. otherwise persists normalized transcript events asynchronously;
  5. broadcasts live notifications to subscribers.

### ACP WebSocket facade

`server/src/runtime/routes/acpFacadeRoute.ts`

`GET /api/ws[?sessionId=<id>]`

- Binds a socket to one session.
- Handles `initialize`, `session/new`, `session/load`, `session/prompt`, cancel, mode/config, close, and Rook environment extensions.
- `session/load` calls the runtime's `session/load` and supplies a requester-private replay listener.
- There is no explicit outbound message-size policy.

### Transcript normalization

`server/src/sessions/services/sessionTranscriptEvents.ts`

- Accepts only ACP `session/update` notifications.
- Normalizes user/agent/thought chunks, tool calls, tool updates, plans, and usage updates.
- Copies terminal output into `rawOutput`/`outputDelta`; large tool output therefore remains agent transcript payload.

### Transcript repository

`server/src/sessions/repositories/SessionTranscriptRepository.ts`

- SQLite table: `session_transcript_events(sequence, session_id, created_at, event_json)`.
- APIs: `append`, `list`, `clear`.
- Uses one promise queue per session, but the queue is unbounded and each operation executes synchronously on Node's main thread.
- Coalesces adjacent text, latest plan/usage, and tool updates by `toolCallId`.
- Finds tool calls with `json_extract(event_json, ...)`, scanning the session's JSON rows.
- Stores complete merged tool output in `event_json`.

### REST session API

`server/src/sessions/routes/sessionRoutes.ts`

- `GET /api/sessions` — discovery and activity metadata.
- Session rename, touch, unview, and delete routes.
- `GET /api/sessions/:id/transcript` — lists and returns every normalized event; includes `running` and activity status.

### Apple client networking

`clients/RookKit/Sources/RookKit/Net/RookAPI.swift`

- REST health, sessions, and transcript hydration.

`clients/RookKit/Sources/RookKit/Net/AcpSocket.swift`

- JSON-RPC WebSocket connection, request/response tracking, ACP event parsing, and `session/load`/prompt calls.

`clients/RookKit/Sources/RookKit/Net/SessionHandle.swift`

- One socket and reducer per session.
- Inactive sessions use ACP `session/load` replay.
- Running sessions use REST transcript attachment.
- Maintains replay buffers, block reduction, `isLoaded`, queued prompts, and reconnect scheduling.
- Reconnect retries failed session loads.

Android mirrors the same ACP + REST/session-handle split in its Kotlin networking and view-model modules.

## Current processes

### Live prompt

```text
client session/prompt
→ ACP facade
→ AgentRuntimeManager
→ SessionRuntime subprocess
→ runtime session/update notifications
→ normalize + asynchronously enqueue persistence
→ broadcast live notifications
→ client reducer
→ prompt response and run-completed persistence
```

### Resume an inactive session

```text
client opens session-bound WebSocket
→ initialize
→ session/load
→ server asks runtime to replay its history
→ server sends replay privately to requester
→ client reduces replay into blocks
→ client marks handle loaded
```

### Hydrate a running session

```text
client GET /api/sessions/:id/transcript
→ server lists all normalized SQLite events
→ client applies them locally
→ client opens/subscribes to the live WebSocket
```

### Failure/reconnect

```text
socket or load failure
→ SessionHandle marks connection unhealthy
→ health checks gate reconnect
→ reconnect opens a socket
→ inactive handle attempts session/load again
```

## Observed failure

The affected session `a2c077c6…` had:

- 97,001 transcript rows;
- approximately 48.8 MB of stored event JSON;
- individual tool output around 2.53 MB.

The Mac logs showed:

- `session/load` taking about 20–21 seconds;
- WebSocket failure: `Message too long`;
- repeated reconnect and reload attempts;
- health requests timing out despite successful loopback TCP connection.

During the reconnect loop, the transcript sequence advanced with repeated copies of old user/agent events roughly every few seconds. The server process reached roughly 100% CPU. A sample placed the Node main thread in synchronous SQLite `json_extract`/JSON parsing from `readLatestToolCall`. The server later exited with `database is locked` while updating a transcript row; the diagnostic read-only database inspection may have contributed to that final lock, but the persistence path has no visible lock/backpressure recovery.

## How the problems interact

1. A large runtime history produces an oversized replay message.
2. The client rejects it and retries `session/load`.
3. Replay suppression is timing-based: `privateReplayIdleTimers` uses an 80 ms quiet period rather than a protocol-complete replay boundary.
4. Some replay notifications can therefore enter normal persistence and subscriber handling.
5. `captureTranscriptEvents` is fire-and-forget, so reconnect/replay bursts can create an unbounded per-session queue.
6. Tool updates repeatedly run a synchronous JSON scan across a very large session.
7. The Node event loop becomes unavailable for health and WebSocket work.
8. Health failures trigger more reconnect behavior, reinforcing the loop.

The architecture describes the transcript as coalesced logical persistence and `session/load` replay as requester-private, but those guarantees are currently vulnerable to large payloads, replay timing, and unbounded work.

## Questions resolved since this context was written

- **Authoritative history:** ACP runtime history is authoritative; the server transcript copy is being removed.
- **Inactive-session hydration:** use ACP `session/load`.
- **Large presentation output:** truncate oversized client-facing ACP payloads; do not alter runtime history.
- **Persistence scheduling/indexing:** no longer applicable because server transcript persistence is being removed.
- **Rook ownership:** retain ACP for runtime/session playback and use the server only as the broker plus bounded client-presentation boundary; keep loaded UI state in client session handles.

## Remaining questions

- Which exact ACP errors belong in the transient-retry versus permanent-failure categories, and what backoff limits should apply?

Resolved: client-facing messages are capped at 10 kB with oversized presentation fields replaced by a marker; ACP `session/load` response is the replay boundary; loaded background session handles retain their ACP connections; genuine disconnects/suspensions reload through ACP and replace cached blocks; transcript tables are deleted but database files remain; and all clients share the same ACP-only lifecycle contract.
