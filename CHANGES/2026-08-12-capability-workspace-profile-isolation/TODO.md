# Isolate capability workspaces by Rook profile

## Context

Development and production Rook servers currently share `~/.rook/global-workspace` and `~/.rook/agent-workspaces`, even when the launcher gives them different `ROOK_HOME` directories. Starting a development server can therefore clear or mutate the production server's live capability workspace and surface `RUN FAILED` during persistence.

## Decision details

Use the active `ROOK_HOME` as the default parent for capability workspace state. Preserve explicit `CapabilityWorkspaceManager` workspace/session-root options for tests and callers that need them. Ensure simultaneous production and development profiles cannot clear, watch, or persist one another's capability workspace files. Do not change session semantics or capability write-back behavior beyond fixing profile isolation.

## Work checklist

- [x] Make `CapabilityWorkspaceManager` derive its default global and session workspace paths from `ROOK_HOME`.
- [x] Add regression coverage proving separate profile homes use separate capability workspace roots and cannot interfere during startup, materialization, watching, or shutdown.
- [x] Verify direct server startup and `run-rook.sh` profile startup both pass the intended `ROOK_HOME` through to capability workspace management.
- [x] Update relevant architecture, launcher, and README documentation to describe the profile-scoped workspace paths and prevent recurrence.
- [x] Run focused server tests/typecheck and launcher tests, then inspect the final diff for accidental changes to shared user state.
