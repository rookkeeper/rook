# Brainstorm

**Status: provisional — direction confirmed by developer**

## Problem

Rook can start or replace many ACP runtimes concurrently. The Pi ACP adapter persists its ACP-session-to-transcript mapping in a shared JSON file using an unlocked read-modify-write. Rook-managed concurrent runtime operations can therefore cause mappings to disappear, leaving durable Rook sessions and Pi transcripts present but difficult to recover.

Environment-driven runtime replacement can also close an active runtime while a prompt is still in flight.

## Investigation

- `AgentRuntimeManager` serializes runtime creation per public session, but not across sessions.
- Runtime session adoption and public session creation call ACP `session/load` and `session/new`, which are the adapter operations that update the shared mapping.
- Environment restart work is queued per session, allowing replacements for many sessions to run concurrently.
- Existing active-turn tracking and `waitForTurnsIdle()` can support prompt-safe replacement.
- The upstream `pi-acp` map implementation is outside this repository and remains unsafe for unrelated ACP writers.

## Options and questions

1. **Rook global ACP mutation gate** — serialize Rook-managed `session/new`/`session/load` operations across public sessions. This directly prevents concurrent writes from this Rook server, with modest scope and no dependency fork.
2. **Rook environment restart throttling only** — reduces the burst but does not cover ordinary concurrent session creation or recovery.
3. **Upstream adapter fix** — the complete solution for all writers, but outside the immediate Rook change.
4. **Rook-owned transcript/mapping recovery** — more invasive and cannot fully bypass an adapter that requires its own map.

The Rook gate should cover all Rook paths that can cause mapping writes, including initial session creation, lazy runtime recovery, explicit `session/load`, and environment replacement. It should not serialize ordinary prompts. Environment replacement should wait for active turns before retiring the old runtime, while retaining the existing per-session restart queue and replacement-before-close behavior.

## Direction

Proceed with a Rook-only mitigation:

- Add a server-wide asynchronous gate around ACP session mapping mutations.
- Add regression coverage proving independent sessions cannot overlap mapping-mutating ACP requests.
- Defer environment-driven runtime replacement until active prompts are idle.
- Update architecture/product documentation to describe the new lifecycle guarantee.

This does not claim to fix `pi-acp` for external processes; issue #181 remains the upstream correctness follow-up.
