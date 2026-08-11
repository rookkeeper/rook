# Persist logical transcript messages instead of ACP chunks

## Context

Rook currently persists every ACP `session/update` text chunk as its own row in `session_transcript_events`. Pi can emit assistant text in very small chunks, so one response can produce thousands of database rows. When a second Apple client hydrates a running session, those rows were also rendered as one chat block per chunk; the shared RookKit hydration path now coalesces them, but the durable transcript should have the right logical granularity too.

This work affects server transcript capture/persistence, REST transcript hydration, and the shared Apple client reducer. Live ACP streaming remains chunk-based on the wire. The database should represent the logical transcript while retaining enough in-progress state for another client to attach during an active turn.

Non-goals: changing ACP wire semantics, changing runtime behavior, or removing live streaming updates.

## Details

Current relevant boundaries:

- `server/src/sessions/services/sessionTranscriptEvents.ts` normalizes ACP notifications.
- `server/src/runtime/services/AgentRuntimeManager.ts` captures every normalized notification.
- `server/src/sessions/repositories/SessionTranscriptRepository.ts` stores append-only JSON events.
- `GET /api/sessions/:sessionId/transcript` returns those events to running-session hydrators.
- `clients/RookKit/Sources/RookKit/Net/SessionHandle.swift` reduces transcript events into chat blocks.

Desired durable transcript shape:

- one logical user message per prompt
- one logical assistant message per contiguous assistant-message section
- one logical thought section per contiguous thought section
- one logical tool record per `toolCallId`, with arguments, status, and accumulated output
- preserve ordering between user, thought, assistant, tool, plan, and run-boundary records
- keep the current in-progress logical record available to a second client; do not wait until the whole run finishes if that would make running-session hydration stale

The server must distinguish output snapshots from output deltas when merging tool updates, and must serialize per-session transcript updates so concurrent runtime notifications cannot reorder or overwrite one another. <!-- THIS IS FOR BACKWARDS COMPATIBILITY: existing chunked rows will be discarded by a one-time transcript-only migration; sessions and all non-transcript application data must remain intact. -->

The Apple-side REST hydration fix is already present in the working tree: `SessionHandle.attach(transcript:)` uses the replay buffers used by `session/load` instead of appending one block per chunk. Carry that change into the implementation worktree and add focused regression coverage if practical.

## Steps

- [x] Reproduce the problem from the running-session transcript and confirm that assistant chunks are stored individually.
- [x] Coalesce transcript chunks during Apple REST hydration so existing chunked transcripts do not render one block per chunk.
- [x] Choose and document the logical transcript persistence representation while preserving the existing REST contract where practical.
- [x] Add per-session transcript aggregation/serialization in the server capture path.
- [x] Merge contiguous user, assistant, and thought chunks into logical records with correct boundaries.
- [x] Merge tool-call updates by `toolCallId`, handling snapshots, deltas, final statuses, and output ordering correctly.
- [x] Persist an in-progress logical record as a current snapshot, with finalization at run/message boundaries.
- [x] Add a one-time transcript-only migration that discards legacy chunk rows while preserving sessions and other application data.
- [x] Add server tests for aggregation, ordering, tool updates, active-turn snapshots, and legacy transcript reads.
- [ ] Add or extend RookKit tests for transcript hydration and block counts/content.
- [x] Run the appropriate server, RookKit, and Apple build/test checks and confirm they pass.
- [ ] Review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code.
- [ ] Remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around.
- [x] Update `AS-BUILT-ARCHITECTURE/` as needed.
- [x] Update `PRODUCT/` as needed.

## Exit criteria

- [ ] A normal assistant response is represented by logical transcript records rather than one database row per transport chunk.
- [ ] A second Mac/iPhone client can attach during a running turn and receive a coherent partial transcript without token-sized chat blocks.
- [ ] Tool calls and outputs remain ordered, identifiable, and correctly accumulated.
- [ ] Existing sessions remain available after the one-time transcript reset, with their old transcript history intentionally discarded.
- [ ] Tests cover the new persistence and hydration behavior.
- [ ] Architecture/product documentation matches the final design.
