# `agent-profiles.json` versus `agent-runtimes.json`

**Architecture area:** server infrastructure / runtime catalog.

**Status:** Resolved: the legacy loader and schema were removed; only `agent-runtimes.json` remains active.

## Current implementation

`server/src/infrastructure/config/agentRuntimes.ts` loads the active configured runtime catalog from `ROOK_AGENT_RUNTIMES_PATH` or `ROOK_HOME/config/agent-runtimes.json`. `server/src/index.ts:26,101` passes that result to `AgentRuntimeManager`, and `/api/agent_runtimes` exposes it.

## Older implementation still present

`server/src/infrastructure/config/agentProfiles.ts` defines a second `AgentProfile` schema, reads `agent-profiles.json`, exports `loadAgentProfiles()` and eagerly initializes `AGENT_PROFILES`. It is imported nowhere by the server and is only exercised by its own tests. `configPaths.ts` and `migrateLegacyConfigIfNeeded()` also exist solely to preserve this old filename/path.

The schemas overlap heavily: runtime/profile IDs, types, commands, args, env, cwd, skill paths, extensions, timeouts, MCP servers, and parent IDs all represent the same runtime configuration concept. The new runtime schema additionally owns prompt capabilities and is the one used at runtime.

## Assessment

Confirmed duplicate old/new configuration implementations. The old loader is dead as a runtime path; only its migration support remains potentially valuable.

## Cleanup decision needed

Retain only a narrowly scoped import/migration reader if existing `agent-profiles.json` files must be upgraded. Remove the exported `AgentProfile` loader, `AGENT_PROFILES`, and old validation tests after migration is complete. Do not keep two independently validated schemas or imply that `agent-profiles.json` is a supported active catalog.

## TODOs

- [x] Confirm whether any deployed profile still uses `agent-profiles.json`.
- [x] Define the migration cutoff and conversion behavior to `agent-runtimes.json`.
- [x] Remove the old loader/schema and tests after the cutoff.
- [x] Verify `/api/agent_runtimes` and launcher profile tests still pass.
