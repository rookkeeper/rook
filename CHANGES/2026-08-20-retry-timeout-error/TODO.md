# Retry exhaustion error surfacing

## Context

Make exhausted runtime/model retries render the standard chat error instead of looking like a successful empty turn, while preserving successful recovery and visible retry progress. Resolves issue #153.

## Decision details

- Classify the adapter's known retry-only `agent_message_chunk` strings as progress, not agent content.
- Track whether a turn produced actual agent content in shared RookKit and Android.
- On non-cancelled `end_turn` with only retry progress, append the normal red error block with a distinct retry-exhausted message and log the condition diagnostically.
- Keep retry progress visible and do not change the third-party `pi-acp` package or ACP wire contract.

## Work checklist

- [ ] Add a tested retry-progress/content tracker to RookKit and use it in `SessionHandle`.
- [ ] Apply the same retry-aware no-content completion guard to the Android reducer.
- [ ] Add regression tests for retry-only exhaustion, successful content, and cancellation behavior.
- [ ] Review changed files for compatibility surfaces and update product/architecture documentation if behavior documentation requires it.
- [ ] Run focused and final validation, inspect the diff, and complete lifecycle records.
