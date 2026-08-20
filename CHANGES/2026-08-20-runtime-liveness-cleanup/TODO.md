# Runtime liveness and cleanup

## Context

Ensure an ACP runtime cannot leave a session permanently Active or remain as an orphan after Rook closes. Runtime communication must have bounded waits, cancellation must eventually hard-stop an unresponsive process, concurrent requests must not create duplicate runtimes, and recovery must be safe for prompts that may have side effects.

## Decision details

- The server owns the complete runtime process tree and terminates it during runtime close, forced timeout, session deletion, and Rook shutdown.
- Runtime lifecycle operations are serialized per public session so concurrent load/prompt/recovery paths share one runtime rather than spawning duplicates.
- Prompt, load, startup, and cancellation waits are bounded by configurable server timeouts with safe defaults.
- A timed-out or unresponsive prompt is failed and its runtime is forcibly terminated. The server does not automatically replay the prompt; the next client request lazily starts one replacement runtime and resumes the persisted ACP session where supported.
- Cancellation has a grace period and then force-closes the runtime, clears the turn state, and reports a non-Active terminal status.
- Activity status is derived from owned turn state that is reconciled on completion, cancellation, timeout, runtime exit, and shutdown; a live child process alone is not evidence of an active turn.
- Add diagnostics sufficient to distinguish runtime process exit, request timeout, cancellation timeout, and duplicate-start prevention without logging prompt contents.

## Work checklist

- [ ] Add serialized per-session runtime lifecycle ownership and prevent duplicate subprocess creation.
- [ ] Add bounded ACP request/startup/load/prompt/cancel handling and forced process-tree termination.
- [ ] Reconcile turn/activity state on every terminal path, including runtime exit and timeout.
- [ ] Ensure Rook shutdown closes all owned runtime process trees and session deletion does the same.
- [ ] Add mock/runtime regression tests for hung requests, cancellation, runtime exit, duplicate startup, and cleanup.
- [ ] Update server architecture, ACP product documentation, and relevant README guidance.
- [ ] Run focused and full validation; review compatibility surfaces and complete the lifecycle record.
