# Retry exhaustion error surfacing

## Context

Make exhausted runtime/model retries render the standard chat error instead of looking like a successful empty turn, while preserving successful recovery and visible retry progress. Resolves issue #153.

## Decision details

- Classify the adapter's known retry-only `agent_message_chunk` strings as progress, not agent content.
- Track whether a turn produced actual agent content on the server, in shared RookKit, and in Android.
- On non-cancelled `end_turn` with only retry progress, fail the server request, set the durable session error state, and append the normal red error block with a distinct retry-exhausted message.
- Keep retry progress visible and do not change the third-party `pi-acp` package or ACP wire contract.

## Work checklist

- [x] Add a tested retry-progress/content tracker to RookKit and use it in `SessionHandle`.
- [x] Apply the same retry-aware no-content completion guard to the Android reducer.
- [x] Add server integration coverage for retry exhaustion, durable error state, and successful recovery.
- [x] Review changed files for compatibility surfaces; none retain a legacy or backwards-compatibility surface.
- [x] Update product and server architecture documentation for retry exhaustion behavior.
- [x] Run final validation, inspect the diff, and complete lifecycle records. Server typecheck and full tests pass; RookKit Swift tests pass; Android Gradle validation is blocked by the missing Java runtime.
