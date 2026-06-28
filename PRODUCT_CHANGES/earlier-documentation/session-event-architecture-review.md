---
resolved: 2026-06-03
---

# Session event architecture review

This document describes the **implemented final architecture** after callback-runtime removal.

---

## Final mental model

Rook is now **event-native end to end**.

- agents emit `SessionEvent`
- `SessionRoom` sequences, persists, replays, and broadcasts `SessionEvent`
- clients consume `SessionEvent` directly
- websocket transport uses `session_event`
- older callback-era logs are only a **read-compatibility concern**

There is no callback-based runtime path in normal operation.

---

## Core event model

`src/shared/realtime.ts` defines the shared session event vocabulary.

Examples:

- `status_changed`
- `user_message`
- `assistant_message_started`
- `assistant_message_completed`
- `text_delta`
- `thinking_delta`
- `tool_call_started`
- `tool_input_delta`
- `tool_running`
- `tool_completed`
- `tool_error`
- `run_completed`
- `run_failed`
- `protocol_error`
- `connection_error`
- `environment_event`

These events are used for:

1. live websocket fan-out
2. persisted JSONL session logs
3. HTTP replay payloads from `/api/agent/start`
4. client-side transcript/state reduction

---

## End-to-end flow

```text
ChatPanel / App
    │
    │  user submits text
    ▼
RemoteAgent
    │  websocket: user_event { kind: "text_message", text }
    ▼
Server websocket handler
    │  ack → room.run(text)
    ▼
SessionRoom
    │  agent.run(text)
    ▼
PiAgent / MockAgent
    │  emitSessionEvent(...)
    ▼
SessionRoom publish sink
    │  sequence + persist + fan-out
    ▼
WebSocket / HTTP replay
    │  session_event
    ▼
RemoteAgent
    │  onSessionEvent(event)
    ▼
ChatPanel reducer
```

---

## Runtime responsibilities

### Agents

`BaseAgent`, `MockAgent`, and `PiAgent` are event emitters.

- `MockAgent` emits deterministic `SessionEvent`s for tests/UI flows
- `PiAgent` translates Pi RPC/JSONL traffic into `SessionEvent`s
- `BaseAgent` owns lifecycle concerns like start/restart/run/stop and event-sink attachment

### SessionRoom

`SessionRoom` is the per-session orchestration boundary.

It is responsible for:

- attaching the runtime event sink
- assigning monotonically increasing sequence numbers
- persisting `session_event` JSONL records
- replaying persisted events during subscribe/reconnect
- broadcasting live events to all subscribers
- preserving ordering between replay and live publication

### RemoteAgent

`RemoteAgent` is the client transport wrapper.

It is responsible for:

- starting/reusing/restarting a session over HTTP
- connecting to websocket replay/live streams
- sending `user_event` messages
- surfacing inbound `SessionEvent`s through `onSessionEvent`
- synthesizing local `protocol_error` / `connection_error` / `run_failed` events when transport issues occur locally

### ChatPanel

`ChatPanel` applies one event stream for both replay and live updates.

It reduces `SessionEvent` directly into UI state for:

- transcript blocks
- tool lifecycle rendering
- queued message handling
- run completion/failure state
- reconnect/replay hydration

---

## Replay and reconnect

Replay is event-native.

### HTTP replay

`POST /api/agent/start` can return prior `SessionEvent[]` when:

- resuming a session
- `includeReplayEvents` is requested
- restarting an existing session in place

### WebSocket replay

`GET /api/ws?sessionId=...&fromSequence=...`:

1. reads persisted `session_event` records after `fromSequence`
2. sends them in order
3. subscribes the client to live events

This keeps reconnect behavior consistent for:

- refresh/reload
- multi-tab fan-out
- active-session restart
- idle room reuse

---

## Error handling

Error handling is also event-native.

### Provider/runtime-originated

Agents emit:

- `run_failed`
- `protocol_error`
- `connection_error`

Examples:

- Pi malformed tool/protocol events
- Pi process exit/connection issues
- provider-side run failures

### Transport-local

`RemoteAgent` emits local synthetic events when problems happen before a server event exists, such as:

- websocket payload parse failures
- websocket connection failure/closure
- websocket-not-open run attempts
- start HTTP failures

This preserves one client reducer path.

---

## Environment events

`environment_event` remains a first-class session event.

It shares the same:

- sequencing
- persistence
- replay
- websocket fan-out
- client reduction path

Current production use is still light, but the architecture is ready for future environment/runtime features without introducing a second model.

---

## Backward compatibility

The system still supports reading older callback-era persisted logs.

That compatibility is limited to:

- parsing legacy `agent_event` / `environment_event` log entries from disk
- converting them to modern `session_event` records on read

It is **not** part of the active runtime architecture.

---

## Why this architecture is better

Compared with the callback-era design, the final model:

- removes duplicate dispatch layers
- keeps replay and live updates on one vocabulary
- makes transport errors and runtime errors visible through the same reducer path
- keeps reconnect/replay semantics explicit
- leaves `SessionRoom` as the single orchestration boundary
- gives future environment work a natural home

---

## Key files

| File | Role |
|------|------|
| `agent-server-client/src/shared/agent.ts` | Shared metadata and event payload types |
| `agent-server-client/src/shared/realtime.ts` | `SessionEvent` and realtime wire contracts |
| `agent-server-client/src/server/agents/BaseAgent.ts` | Event-emitting server runtime base |
| `agent-server-client/src/server/agents/MockAgent.ts` | Event-native mock runtime |
| `agent-server-client/src/server/agents/PiAgent.ts` | Pi RPC → `SessionEvent` adapter |
| `agent-server-client/src/server/realtime/SessionRoom.ts` | Sequence/persist/replay/fan-out |
| `agent-server-client/src/server/sessionEvents.ts` | JSONL session-event persistence + legacy log upgrade |
| `agent-server-client/src/client/remoteAgent.ts` | Event-first client transport |
| `agent-server-client/src/client/components/ChatPanel.tsx` | Replay/live event reducer into UI state |

---

## Bottom line

The implemented architecture is now:

- **event-native on the server**
- **event-native on the wire**
- **event-native in replay**
- **event-native in the client**

Callback-era transport/runtime plumbing has been removed; only legacy log-read compatibility remains.
