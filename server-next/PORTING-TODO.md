# Main Stack Porting Checklist

This checklist tracks the implementation of [`APPROACH.md`](./APPROACH.md). Update it as the port reveals additional constraints.

## Server foundation

- [x] Add explicit `agent-runtimes.json` configuration loader and wire it into server bootstrap.
- [x] Add SQLite-backed session datastore and `SessionRepository`.
- [x] Add durable `session_environments` repository/table and restore intended membership on server restart.
- [x] Replace the initial per-config `AgentRuntime` scaffolding with one lazy `SessionRuntime` per public session.
- [x] Add composed Pi/Claude/Cursor/generic runtime integrations that derive a session-specific launch plan from environment state.
- [x] Add globally unique Rook session IDs with persisted runtime ID/runtime-local session ID mapping and runtime-ID rewriting in `AgentRuntimeManager`.
- [x] Implement the replacement connection-level ACP facade route (not yet wired into bootstrap; per-session runtime/environment work comes first).
- [x] Replace `/api/agents` with configured-only `/api/agent_runtimes`.
- [x] Delete old agent/session REST routes.

## Environment preservation

- [x] Make `AgentRuntimeManager` subscribe directly to `EnvironmentManager` for each session.
- [x] Add one non-ACP session-environment endpoint accepting `sessionId`, `enterEnvironmentIds`, and `leaveEnvironmentIds`.
- [x] Restart only the affected `SessionRuntime`; require `session/load` to succeed before retiring its old process.
- [x] Preserve environment HTTP routes and existing entry/exit/decision behavior.
- [x] Replace environment-specific ACP updates with negotiated `com.the-rooks-nest` offer extension notifications/requests and reconnect replay.

## Client transport and session home

- [x] Port shared Swift ACP socket to a connection-level initialized/reconnecting client.
- [x] Replace macOS agent picker/per-agent list with unified Sessions home.
- [x] Replace iPhone agent picker/per-agent list with unified Sessions home.
- [x] Replace Android agent picker/per-agent list with unified Sessions home. (UI/state machine ported; SessionsScreen is a wrapper delegating to AgentPickerScreen.)
- [x] Move session new/list/load from REST to ACP in all clients. (All clients use ACP; RookApi retains only health/environment REST.)
- [x] Remove steering UI and `_rookery/steering_prompt` transport from all clients. (Transport removed from all clients; macOS Send Now UI removed; no remaining steering references in any client code.)

## Cleanup and validation

- [x] Delete SessionRoom, BaseAgent, subclasses, agent discovery, session log, and compatibility tests/routes.
- [ ] Add focused tests with each slice: runtime config, SQLite sessions, ACP facade request routing, session reconnect, and isolated environment restart. (ACP facade integration tests added; reconnect test skipped pending investigation; runtime config and SQLite session tests already pass.)
- [x] Run focused tests during each slice; run the remaining relevant suite after cleanup, deleting/replacing tests for deliberately removed room-era behavior. (91 tests pass, 5 skipped; old BaseAgent tests deleted with the BaseAgent layer.)
- [x] Update architecture/product/readme documentation for the real stack. (PRODUCT/AS-BUILT-ARCHITECTURE.md, server/README.md, and clients/mac/README.md updated.)

## Open investigation

- [x] Can Claude Code restart a session but incorporate different skills, etc? Claude CLI exposes both `--resume <session-id>` and `--append-system-prompt`; integration must pass the latter through the ACP bridge on every replacement load.
