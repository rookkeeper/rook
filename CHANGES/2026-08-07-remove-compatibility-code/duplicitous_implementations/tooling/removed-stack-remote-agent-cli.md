# Remote-agent CLI from the removed server stack

**Architecture area:** developer tooling / ACP client.

**Status:** Resolved: the removed-stack CLI and its package/documentation entry points were deleted.

## Current implementation

`clients/cli` is the current standalone CLI and uses `/api/agent_runtimes`, `/api/sessions`, and the current ACP facade.

## Older implementation still shipped and documented

- `scripts/interact-with-remote-agent.sh` and `scripts/lib/interact-with-remote-agent/interact-with-remote-agent.ts` remain exposed as `npm run agent:cli` and are documented in `scripts/README.md:76-88`.
- `remoteAgent.ts:16-35` calls removed `/api/agents`, `/api/agent/sessions`, and `/api/agent/session/recent` endpoints.
- `interact-with-remote-agent.ts:320-330` and `:450-490` call removed `/api/agent/start` and construct the old agent-start/session model.
- The script uses `_rookery_*` status/mode/steering/environment message conventions, while the current facade owns standard ACP methods plus `_com.rookkeeper/environment_*` extensions.
- `server/src/shared/agent.ts` is used only by this script's re-export/import chain, another sign that the old stack's types survived after the server rewrite.

## Assessment

Confirmed orphaned duplicate CLI implementation. It is not just an alternate UI: its primary endpoints no longer exist in the current server route catalog, so the advertised command is a stale copy of the removed room/agent architecture. `clients/cli` already supplies the replacement capability.

`PRODUCT/agent-client-protocol.md` still documents `_rookery/steering_prompt` as a desired product extension. Removing this stale CLI must not be interpreted as removing that semantic feature; preserve it only in a current ACP client/server implementation if the product decision remains active.

## Cleanup decision needed

Retire the script and its `agent`, `acpClientTypes`, `environment`, `remoteAgent`, and ACP helper modules, or rewrite the script on top of `clients/cli`/the current ACP facade. Update root/server package scripts and `scripts/README.md` in the same change; do not leave both CLIs advertised. Resolve the steering extension separately before removing any code that is still its only implementation.

## TODOs

- [x] Decide whether `npm run agent:cli` should be retired or become a wrapper around `clients/cli`.
- [x] Remove or port the obsolete `/api/agent/*` startup and session model.
- [x] Resolve the product/architecture decision for `_rookery/steering_prompt`.
- [x] Replace stale event assumptions with the current ACP contract if retaining any tool behavior.
- [x] Remove stale shared agent types and helper modules after callers are gone.
- [x] Update root, server, and scripts documentation and add a smoke test for the chosen CLI.
