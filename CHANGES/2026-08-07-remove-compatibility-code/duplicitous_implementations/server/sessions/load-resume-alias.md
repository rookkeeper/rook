# `session/load` versus `session/resume`

**Architecture area:** server ACP session lifecycle.

**Status:** Resolved: `session/load` is canonical and the `session/resume` alias was removed.

## Evidence

- `server/src/runtime/routes/acpFacadeRoute.ts:126-145` sends both `session/load` and `session/resume` through the same branch, adds the same private replay listener, and adds the same prompt capability result.
- `server/src/runtime/services/AgentRuntimeManager.ts:109-117` gives both methods the same runtime-local session-id rewrite and private-replay setup.
- Current Apple, Android, CLI, and environment-restart code send `session/load`; repository-wide searches found no current client sending `session/resume`.
- The server advertises both in `initialize` as `sessionCapabilities: { list: {}, resume: {}, close: {} }`.

## Assessment

Likely a compatibility alias left after standardizing on `session/load`. It is not proven safe to delete solely from this repository because an external ACP client may rely on `session/resume`. The duplicate behavior is real, but the compatibility requirement is an open protocol decision.

## Cleanup decision needed

Confirm the supported ACP method set. If `session/load` is canonical, remove the `session/resume` facade branch, manager special case, and advertised `resume` capability together; otherwise isolate the alias in a clearly named compatibility adapter and test it separately from the canonical load path.

## TODOs

- [x] Verify ACP specification requirements and external-client compatibility for `session/resume`.
- [x] Choose `session/load` as the sole path or define an explicit compatibility adapter.
- [x] Update initialization capabilities and runtime-manager branching consistently.
- [x] Add regression coverage for the chosen canonical and compatibility behavior.
