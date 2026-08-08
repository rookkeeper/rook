# Legacy web-client compatibility surface

**Architecture area:** server composition and Mac client supervision.

**Status:** Resolved: the no-op server option and Mac web-app affordance were removed.

## Current and older paths

- `server/src/index.ts:40-41` still exposes `BuildServerOptions.enableClient`, explicitly labeled a `legacy no-op`; `buildServer()` never uses it.
- The server architecture and README state that the server no longer hosts a web client.
- `clients/mac/Sources/Models/RookMacModel.swift:344-346` still exposes `openWebApp()`, which opens the server base URL as though it were a web app.
- `scripts/lib/interact-with-remote-agent/interact-with-remote-agent.ts:450-455` still passes `enableClient: false`, showing the old option survived in tooling as well.

## Assessment

Confirmed stale compatibility API. The option is not a second implementation anymore—it is a no-op—but it preserves the old web-client contract and an affordance that can point users at a server with no hosted client.

## Cleanup decision needed

Remove `enableClient` from `BuildServerOptions`, update callers, and either remove/rename the Mac `openWebApp` action to an explicitly external-client action or delete it. Update tests/docs that still describe the old web surface.

## TODOs

- [x] Search all build-server callers and remove the `enableClient` argument.
- [x] Decide whether `openWebApp` should be deleted or renamed to clarify its destination.
- [x] Remove stale web-client references from scripts, comments, and README files.
- [x] Run server and Mac build validation after the API cleanup.
