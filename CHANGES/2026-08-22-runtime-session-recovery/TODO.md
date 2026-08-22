# Recover persisted ACP sessions after runtime replacement

## Context

A public Rook session can outlive its ACP subprocess. After a timeout, process exit, or server restart, the server currently starts a replacement runtime and sends the persisted runtime-local session ID directly in `session/prompt`. A fresh ACP process does not know that in-memory session ID, so it returns `Unknown sessionId` / `Invalid params` before reaching the model.

## Decision details

- Implement the recovery in the server; no individual client changes are required.
- Continue prompting directly when the existing runtime process is alive.
- When the server creates a replacement runtime, internally adopt the persisted ACP session with `session/load` before forwarding the user prompt.
- Keep session-load replay private/discarded during recovery so the visible chat does not repaint the existing transcript.
- Preserve the existing conversation when load succeeds.
- Ordinary runtime-replacement recovery must not silently replace a historical session with an empty `session/new` session when `session/load` fails; it surfaces the recovery failure instead. The existing environment-restart fallback remains a compatibility path from PR #152 and is kept separate from ordinary runtime recovery.
- Add server regression coverage for recovery after runtime loss, direct prompting on a live runtime, replay suppression, and load failure behavior.
- Update the server/product/architecture documentation so it describes server-side recovery rather than requiring a client-issued load after runtime collection.

## Work checklist

- [x] Refactor runtime creation/replacement so a fresh runtime adopts the persisted ACP session before it is used for prompts or attached to normal subscribers.
- [x] Keep direct prompt behavior unchanged for a live runtime.
- [x] Suppress or privately route session-load replay during internal recovery.
- [x] Define and implement safe handling for session-load failures without discarding historical context during ordinary runtime recovery.
- [x] Add focused AgentRuntimeManager regression tests, including a fake runtime that rejects direct prompt until `session/load` occurs.
- [x] Update ACP, server architecture, and session/environment restart documentation.
- [x] Review changed files for compatibility surfaces and annotate or document any retained behavior.
- [x] Run server typecheck/tests and the relevant launcher/client validation.
- [ ] Inspect the final diff and complete the lifecycle record.
