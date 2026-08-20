# Brainstorm

**Status: provisional — direction approved by the request to investigate and complete the fix.**

## Problem

Issue #153 reports that `pi-acp` emits automatic retry progress as ordinary `agent_message_chunk` events. When every model retry fails, the adapter still returns a normal `end_turn`; clients therefore treat the retry text as a successful response and do not render the standard error block.

## Investigation

- `server/node_modules/pi-acp/dist/index.js` maps `auto_retry_start` to `agent_message_chunk` text such as `Retrying (attempt 1/3, waiting 2s)...` and maps `auto_retry_end` to `Retry finished, resuming.`.
- Android already has a general no-content-on-`RunCompleted` guard from commit `387fad5`, but it currently counts every agent message chunk as content, including these retry-only messages.
- Shared `clients/RookKit/Sources/RookKit/Net/SessionHandle.swift` (used by the Mac and iPhone clients) has no equivalent no-content guard, so both native clients can silently complete the same failure.
- The standard red error treatment already exists in RookKit and Android; this is a run-state classification problem, not a new UI component problem.

## Options and questions

1. **Detect retry-only messages in each client and exclude them from the actual-content count.** This preserves the existing visible retry progress and works with the current ACP adapter without changing a third-party dependency or protocol shape.
2. **Change the server or `pi-acp` adapter to add a retry metadata extension.** This would be more explicit, but requires protocol/client plumbing and cannot be changed in the checked-in third-party package as part of this focused bug fix.
3. **Treat every zero-content `end_turn` as an error.** This catches the bug but risks false positives for runtimes that legitimately produce no visible content.

The preferred direction is (1), with a shared RookKit turn-content tracker and the equivalent Android reducer logic. Retry-only completion gets a distinct `retry-exhausted` error message and an error-level diagnostic log; genuine agent text, thinking, tools, or plans still count as successful content, and cancellation remains non-error.

## Direction

Proceed with the preferred client-side classification. Add focused regression tests for retry-only completion and successful content completion. Keep the existing retry status messages visible. No changes to the external `pi-acp` dependency or ACP wire contract are needed.
