# Canonical runtime paths

## Goal

Make every runtime, client, launcher, and project-environment surface use one clear current contract. Reduce branching and keep durable state, workspace discovery, session summaries, and environment decisions centered on their canonical representations.

## Inventory

- `scripts/lib/run-rook/profile.sh` and its shell tests define profile-local database setup.
- `server/src/environments/repositories/ProjectDirectoryEnvironmentRepository.ts` and its tests define project instruction and skill discovery.
- `server/src/runtime/CapabilityWorkspaceManager.ts` and its tests materialize the standard agent workspace.
- `server/src/environments/repositories/EnvironmentDecisionRepository.ts`, `SessionDecisionRegistry.ts`, and tests define durable decision shape.
- `server/src/runtime/services/AgentRuntimeManager.ts` and `acpFacadeRoute.ts` define session lifecycle ownership.
- `server/src/sessions/routes/sessionRoutes.ts` defines the session-list response.
- `clients/RookKit` session summaries and tests consume that response.
- Root, server, scripts, architecture, product, workflow, skill, and change documentation describe these contracts.

## Final contract

- Every selected profile uses its computed `ROOK_HOME/rook.sqlite` database.
- Project environments read `AGENTS.md`, `.agents/skills`, and `.mcp.json`.
- Generated workspaces contain `AGENTS.md` and `.agents/skills` as their discovery surface.
- Durable environment decisions always identify a bundle.
- Session lifecycle requests use the manager's public deletion operation.
- Clients consume the server's `sessionId`, `title`, `updatedAt`, `running`, and `_meta` fields.
- Documentation describes only these contracts.

## Simplification opportunities

- Remove conditionals, aliases, duplicate discovery roots, unused cleanup, and tests that exist only for alternate representations.
- Keep focused tests for the canonical path and add assertions where a narrower invariant makes the contract explicit.
- Update architecture and package READMEs to state the resulting shape directly.
