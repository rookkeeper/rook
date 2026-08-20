# Runtime liveness and cleanup

## Problem

A runtime can remain alive while an ACP prompt request is no longer making progress. The server can leave the session marked Active indefinitely, Stop can acknowledge only that a cancel notification was written, and Rook shutdown may kill only the adapter parent while leaving a provider child behind. Concurrent requests can also race runtime creation and produce duplicate subprocesses for one public session.

## Investigation

- `AgentRuntimeManager.activityStatus()` gives `activeTurns` precedence over runtime liveness.
- `requestForSession()` increments the turn count and clears it only in the prompt request's `finally` block.
- `SessionRuntime.isAlive` means only that its direct child reference is non-null; it is not a responsiveness test.
- `session/cancel` forwards a notification but has no acknowledgement/grace timeout or forced runtime termination.
- `SessionRuntime.close()` calls `child.kill()` without owning a process group, while the Pi launcher spawns another provider child with inherited stdio.
- `runtimeFor()` has no per-session startup lock, so concurrent load/prompt requests can race runtime creation.
- A live probe through the server ACP socket and the thin CLI successfully used the affected runtime, while the original prompt remained reflected as Active. This demonstrates a stale broker turn/request state rather than a dead provider process.

## Options and questions

1. Add only a UI timeout. This would hide the symptom but leave server resources and subprocesses alive.
2. Add request and cancellation deadlines in the server, terminate the entire runtime process group on timeout, and make the next request lazily create one replacement. This avoids replaying a possibly side-effecting prompt.
3. Add automatic prompt replay after restart. This risks duplicate tool calls and file changes and should not be done implicitly.
4. Add a background process watchdog. It is useful for orphan cleanup, but request ownership and shutdown must be fixed first.

## Direction

Implement server-authoritative runtime ownership and liveness:

- one serialized runtime lifecycle per public session;
- per-request deadlines and cancellation grace periods;
- forced process-tree termination when a prompt or cancel cannot settle;
- explicit error/ready state instead of permanent Active;
- lazy replacement on the next load/prompt, without automatic prompt replay;
- process-group ownership and shutdown tests so Rook closes every runtime it started;
- diagnostics and tests for duplicate startup, hung prompts, cancellation, child exit, and server shutdown.
