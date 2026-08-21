# Runtime session environment restart recovery

## Context

Environment changes replace a session's runtime. A runtime can reject `session/load` even though the public Rook session still exists. The replacement must recover without making provider-specific assumptions in the runtime manager.

## Decision details

- Keep the normal `session/load` path unchanged.
- If the actual ACP `session/load` request returns a response-level error, retry with `session/new` and persist a changed runtime session id.
- Do not retry startup, transport, timeout, or malformed-load-response failures.
- Preserve ACP error code and data for diagnostics, but do not branch on provider-specific codes.
- Runtime-owned ACP history remains authoritative; no server transcript mirror or prompted flag is added.

## Work checklist

- [x] Retry an ACP response-level `session/load` error with `session/new`.
- [x] Persist a changed runtime session id.
- [x] Keep startup, transport, timeout, and malformed-response failures on the abort path.
- [x] Preserve structured ACP response errors at the runtime transport boundary.
- [x] Add focused restart and transport error tests.
- [x] Update product and architecture documentation for the current ACP-only history model.
