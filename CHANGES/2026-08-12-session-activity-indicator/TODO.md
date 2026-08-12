# Session activity indicator state

## Context

Replace the selection-derived Mac session pill with a server-authoritative activity state that remains correct for background and asynchronous work. The same semantics must be available to Mac, iPhone, and Android, including durable pending results after a runtime exits.

## Decision details

- The public session activity states are `Active`, `Ready`, `Error`, `On`, and `Off`.
- `Active` means the server has an ACP turn in progress for the session. It takes precedence over all other states.
- `Ready` means a turn completed successfully and the user has not opened the session since that result. It persists across runtime shutdown and takes precedence over `On` and `Off`.
- `Error` means a turn failed or returned an error and the user has not opened the session since that result. It persists across runtime shutdown and takes precedence over `On` and `Off`.
- Opening a session counts as looking at it. The session-open/touch operation clears pending `Ready` or `Error` state; after that, an alive runtime is `On`, and a closed runtime is `Off`.
- The server owns active-turn tracking, runtime liveness, and persisted pending-attention state. Clients do not infer status from selection. A turn that completes while the session is already open must not be incorrectly marked unread.
- The durable attention value is an enum/check-constrained database value for acknowledged/clear, `ready`, or `error`; `Active`, `On`, and `Off` are derived from live server state plus the persisted attention value.
- Mac, iPhone, and Android adopt the shared state model in this change.
- Visible session-selection screens use periodic REST polling for freshness. Push notifications are explicitly out of scope for this iteration.
- Existing session ordering, deletion, and drag-reordering follow-ups from issue #129 are not expanded here unless required by the state implementation.

## Work checklist

- [ ] Add durable session attention state and any turn/view timestamps to the session repository and SQLite schema, including migration-safe initialization and enum validation.
- [ ] Track ACP prompt turn lifecycle on the server: active at prompt start; clear active and record `ready` or `error` at completion/failure; preserve pending state when the runtime later exits.
- [ ] Make session open/touch acknowledge pending attention and return the authoritative computed activity status.
- [ ] Expose authoritative activity status in `GET /api/sessions` and session-specific responses; add focused server route/repository/runtime tests for all states and transitions, including asynchronous completion and runtime shutdown.
- [ ] Diagnose and fix stale/incorrect runtime liveness reporting around runtime creation, replacement, process exit, and detachment; add logging or tests that prevent a known-live runtime from appearing `Off`.
- [ ] Update shared RookKit status types and Mac presentation/model refresh behavior; add polling while the session-selection screen is visible and tests for labels/icons/state precedence.
- [ ] Update iPhone and Android status models, presentation, and tests for `Ready` and `Error` plus the new server-provided semantics.
- [ ] Update PRODUCT/ and AS-BUILT-ARCHITECTURE/ documentation, and relevant client/server READMEs, to describe the state machine and server authority.
- [ ] Inspect changed files for compatibility surfaces and annotate any retained legacy behavior with the required marker.
- [ ] Run focused server, RookKit, Mac, iPhone, and Android checks as available, then run final validation and inspect the diff.
