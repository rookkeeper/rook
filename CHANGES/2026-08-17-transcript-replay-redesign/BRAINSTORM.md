# Transcript and replay brainstorm

**Status: provisional — not an implementation decision**

## Problem

ACP runtime playback is the original transcript source, but one tool result sent to the client contained a 2.5 MB base64-encoded screenshot. The Apple client rejected the WebSocket message, which triggered retries, replay duplication, synchronous SQLite pressure, CPU saturation, and health failures.

The agreed presentation constraint is recorded separately in [DECISIONS.md](./DECISIONS.md): the server must bound oversized client-facing payloads.

## Investigation

- The source event was a Pi `read` of `/tmp/rook-sim.png`.
- The image contained 2,528,244 base64 characters.
- The corresponding persisted event was 2,528,846 bytes.
- The ACP runtime session file remains the original source history.
- Rook's transcript database is a normalized, coalesced copy used for REST hydration of running sessions and second viewers.

Relevant code paths:

- `AgentRuntimeManager` — runtime notification routing and transcript capture
- `SessionRuntime` — ACP subprocess transport
- `acpFacadeRoute` — client ACP WebSocket
- `SessionTranscriptRepository` — normalized SQLite copy
- `SessionHandle` / `AcpSocket` — client replay and reduction

### Pi ACP `session/load` behavior

`server/node_modules/pi-acp/dist/index.js` starts `pi --mode rpc --session <session-file>`, calls `getMessages()`, and translates the stored Pi messages into ACP notifications. It does not emit one ACP notification per stored streaming delta during load:

- each stored `user` message becomes one complete `user_message_chunk`;
- each stored `assistant` message becomes one complete `agent_message_chunk`;
- each stored `toolResult` becomes two notifications: `tool_call` and `tool_call_update`;
- both tool notifications currently include the complete tool-result object as `rawOutput`.

For the affected session, a direct local load measured approximately 1.14 seconds and produced 503 update notifications / 8.33 MB of ACP output: 9 user messages, 8 assistant messages, and 243 tool calls represented by 243 pairs of tool notifications. The largest individual notification was approximately 2.53 MB because it contained the base64 screenshot. This is different from the Pi TUI's local session rendering, which reads the session file directly without WebSocket serialization or Apple client frame limits.

## Option under discussion: remove server transcript persistence

Rook could temporarily rely exclusively on ACP runtime history for playback and remove `SessionTranscriptRepository`, normalized transcript capture, and REST transcript hydration until a concrete server-side need is demonstrated.

### Benefits

- ACP runtime history remains the only transcript authority.
- Removes a second representation and its merge/replay semantics.
- Removes synchronous SQLite writes, JSON scans, queue growth, lock contention, and transcript duplication.
- Simplifies `AgentRuntimeManager`, routes, clients, tests, migrations, and storage.
- Preserves runtime-native history rather than a lossy normalized copy.

### Costs and unforeseen risks

- Playback depends on the runtime process and its session store being available and compatible.
- Every client resume may require the runtime's full `session/load` operation.
- Running-session and second-viewer hydration lose the cheap REST snapshot path.
- Clients remain coupled to runtime-specific replay size, ordering, and event details.
- Server-side search, auditing, export, recovery, and cross-runtime migration lose a durable source.
- Removing the database does not eliminate large runtime-to-server frames or expensive full replay; client-bound truncation remains necessary.
- Existing CLI/client behavior and old sessions need a compatibility decision.

## Remaining questions

1. What truncation representation should fit within the agreed 10 kB client-message limit, including useful image/tool-result metadata?
2. Which specific ACP errors belong in the transient-retry versus permanent-failure categories, within the agreed rule that transient failures retry and permanent failures stop?

## Resolution

The brainstorm is resolved by [DECISIONS.md](./DECISIONS.md): ACP runtime history is the sole transcript source, server transcript persistence and REST rehydration will be removed completely, and client-facing ACP payloads will remain bounded.

Loaded session handles retain their session-bound connections while the client remains alive, including when backgrounded. Switching away and back does not reload. ACP `session/load` response completion is the replay boundary. Runtime restoration and abnormal disconnect synchronization must still avoid duplicate blocks.
