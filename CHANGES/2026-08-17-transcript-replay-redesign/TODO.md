# Transcript and replay redesign

## Context

Rook's normalized SQLite transcript copy amplified replay failures and was not needed to establish ACP as the original session source. Pi ACP `session/load` is fast enough for the affected session when client-facing payloads are bounded. The current reconnect path can replay into an already-loaded handle and duplicate every UI block.

## Decision details

- ACP runtime history is the only transcript source.
- Remove server transcript persistence and REST transcript rehydration completely.
- Remove compatibility paths, fallbacks, and the old normalized transcript representation.
- Populate a new client session handle through ACP `session/load`.
- Keep loaded blocks and the session-bound ACP connection in the in-memory session handle while the client remains alive, including when the session is backgrounded.
- Switching away/back on a live handle must not reload.
- Use the completed ACP `session/load` response as the replay boundary; remove the 80 ms quiet timer.
- After a genuine WebSocket disconnect or platform suspension, reconnect and use ACP `session/load` to resynchronize.
- Apply recovery replay by replacing cached session blocks, never appending to them.
- Truncate oversized client-facing ACP presentation payloads to a maximum serialized notification size of 10 kB in both live delivery and replay. Do not alter the runtime's source history.
- Retry transient ACP load failures with backoff; stop on permanent session/configuration/protocol/history failures.
- Physically delete obsolete transcript tables and rows from existing application databases without retaining application compatibility code.
- Apply the same lifecycle contract to Mac, iPhone, Android, and CLI; platform UI differences are allowed.

## Work checklist

- [x] Remove `SessionTranscriptRepository`, transcript normalization, schema creation, manager capture/append/clear calls, and related tests.
- [x] Remove the REST transcript route and all server/client/CLI transcript hydration APIs and branches.
- [x] Make initial session population use ACP `session/load` for all clients and runtimes.
- [x] Preserve one session handle and session-bound socket per loaded session while the client is alive.
- [x] Fix reconnect handling so a genuine disconnect/suspension reloads through ACP and atomically replaces cached blocks.
- [x] Ensure ordinary session switching never reloads or resets a live handle.
- [x] Replace the 80 ms replay quiet timer with the completed `session/load` request boundary.
- [x] Add server-side bounded serialization/truncation for oversized live and replay presentation payloads, enforcing the 10 kB serialized-notification limit.
- [ ] Define and test transient/permanent ACP load-error classification and bounded backoff.
- [x] Physically delete obsolete transcript tables and rows without leaving application compatibility code.
- [ ] Add focused regression tests for replay shape, message bounds, handle reuse, background sessions, disconnect recovery, runtime restoration, retry classification, table cleanup, and absence of transcript persistence.
- [x] Update architecture docs, package READMEs, and protocol documentation to describe ACP-only playback.
- [ ] Inspect compatibility surfaces and remove obsolete compatibility code and documentation.
- [ ] Run focused tests, builds, and final validation.
