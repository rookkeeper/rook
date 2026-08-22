# Brainstorm

**Status: direction confirmed — implementation may begin after the planning checkpoint**

## Problem

GitHub issue #118 asks Rook to preserve explicitly entered environments across a server restart and restore their approved/personal capability projections when the session is resumed. The issue remains open even though the current branch contains an initial persistence and lazy-restore implementation.

## Investigation

- `PRODUCT/relationship-between-sessions-and-environments.md` and `PRODUCT/environment-state.md` define session membership as durable, bundle decisions as hash-based, and workspace projections as disposable.
- `AS-BUILT-ARCHITECTURE/server.md` and `database.md` describe `session_environments`, lazy runtime recovery, and per-session workspace materialization.
- `SqliteSessionRepository` already creates and persists `session_environments`, exposes `environmentIds()` and `replaceEnvironmentIds()`, and cascades membership deletion with a session.
- `AgentRuntimeManager.applyEnvironmentChange()` updates the environment manager, waits for the environment restart queue, then persists the resulting entered IDs.
- `AgentRuntimeManager.restoreEnvironmentMembership()` reads persisted IDs on the first request for a session, subscribes the session, enters each remembered environment, waits for workspace/runtime restart work, and then continues with runtime recovery.
- `EnvironmentManager` keeps its available/remembered environments in memory. After a process restart, `enterEnvironment()` currently returns early when the persisted environment ID has not been re-registered in the new manager, even if the repository still contains valid bundles.
- Existing tests cover repository membership storage, environment materialization during a live environment restart, and runtime `session/load` recovery. There is no regression test that creates a session, shuts down the server, builds a fresh server over the same durable stores, and resumes the session with its environment workspace restored.

## Options and questions

1. **Only add an integration test.** This would document the current behavior, but it would expose that a fresh `EnvironmentManager` has no remembered environment entries unless a client registers the environment again.
2. **Rehydrate persisted environments from the repository during session restore.** This preserves the existing in-memory availability model while allowing known repository-backed environments to be restored without a new client registration. Environments whose bundles are no longer available can be skipped without failing session resume.
3. **Persist the complete remembered environment cache.** This would duplicate repository-derived state and complicate freshness/availability semantics; it is not needed for the issue.

Important behavior to verify:

- durable approve/reject decisions remain keyed by the exact bundle hash across the restart;
- personal bundles and generated per-session links/`AGENTS.md` are restored, not just environment IDs;
- unavailable environments do not prevent the session or other available environments from resuming;
- membership changes remain explicit and do not make environment availability imply entry;
- runtime ACP history continues to be recovered through `session/load` rather than being replaced by a new session.

## Direction

Use the existing durable membership and workspace architecture. Add a repository-backed rehydration path for persisted environment IDs during session restoration, keep unavailable memberships durable but inactive, and add hermetic integration coverage for restart/resume plus unavailable-environment handling. Avoid new API contracts and avoid persisting the transient availability cache.
