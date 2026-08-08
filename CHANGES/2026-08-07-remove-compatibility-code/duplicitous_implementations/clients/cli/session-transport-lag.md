# CLI old session transport beside the current contract

**Architecture area:** standalone CLI session/chat client.

**Status:** Resolved in code: CLI discovery and running-session hydration use REST and session-bound sockets.

## Current contract

Session discovery is REST, and a resumed viewer should use a session-bound WebSocket plus server transcript hydration when the session is already running.

## Older implementation

- `clients/cli/src/client.mjs:83-94` connects to unbound `/api/ws` and initializes there.
- `clients/cli/src/client.mjs:133-136` loads every existing session through ACP `session/load`, including transcript mode.
- The CLI keeps sending `sessionId` in messages over the same unbound socket rather than using `/api/ws?sessionId=...` for resumed sessions.
- `clients/cli/src/commands/sessions.mjs:1-49` also uses the old WebSocket `session/list` discovery path.

## Assessment

Confirmed older client behavior. The CLI is a real supported package, so this is not dead code like the orphaned realtime classes; it is a second active way to hydrate and attach sessions and should be brought in line with the current contract.

## Cleanup decision needed

Use `GET /api/sessions` for the sessions command and transcript mode. For an existing session, fetch the normalized transcript, connect to `/api/ws?sessionId=...`, initialize, and only call `session/load` for an inactive session when runtime replay is actually required. Preserve the interactive live event reducer while removing the old unbound-resume path.

## TODOs

- [x] Migrate the sessions command to the REST endpoint.
- [x] Add a session-bound WebSocket connection path to the CLI client.
- [x] Hydrate running sessions from the normalized transcript endpoint.
- [x] Preserve inactive-session replay behavior with explicit tests.
- [x] Remove unbound resume logic once interactive and transcript modes pass.
