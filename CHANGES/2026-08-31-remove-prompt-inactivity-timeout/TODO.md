# Remove prompt inactivity timeout

## Context

Remove the one-minute prompt inactivity deadline because it is not useful for the current runtime behavior, while preserving bounded non-prompt lifecycle waits, cancellation cleanup, and idle-runtime collection.

## Decision details

- Remove the prompt-specific inactivity timeout rather than reverting the broader runtime-liveness work from `c55bfaa`.
- `session/prompt` will no longer be automatically hard-stopped solely because no runtime notification arrives for 60 seconds.
- Preserve the general 30-second timeout for startup/load/close and other non-prompt runtime requests, plus explicit cancellation, shutdown, deletion, and idle-runtime cleanup behavior.
- Replace the inactivity-specific timeout test with coverage proving a quiet prompt can complete; retain coverage for cancellation-based cleanup and other runtime liveness behavior.
- Update current product and architecture documentation. Historical change notes remain historical unless they describe current behavior rather than the completed implementation record.

## Work checklist

- [x] Remove prompt inactivity timeout state, configuration, timer, and listener bookkeeping.
- [x] Update tests and mock fixtures for the changed prompt behavior.
- [x] Update current product and architecture documentation.
- [x] Review compatibility surfaces and record that no compatibility shim is needed; removal is intentional and no fallback is retained.
- [x] Run focused and full server validation.
- [x] Inspect the final diff and complete the lifecycle record.
