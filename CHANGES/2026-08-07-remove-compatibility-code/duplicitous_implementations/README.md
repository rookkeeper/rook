# Duplicitous implementation catalog

This catalog records places where the repository still contains an older implementation, compatibility alias, migration path, or abandoned protocol surface alongside the current as-built path. It is organized by the domains in `AS-BUILT-ARCHITECTURE/`.

This began as an audit catalog and now records the completed cleanup. Compatibility and orphaned implementations were removed without changing the canonical current paths. The complete functionality map is [architecture-inventory.md](architecture-inventory.md).

## Current architecture used as the baseline

- Session discovery is REST: `GET /api/sessions`.
- Agent interaction is one session-bound ACP WebSocket per session.
- Running-session hydration uses the server-owned transcript endpoint; ACP `session/load` is for an inactive runtime/replay path.
- The server's current runtime broker is `AgentRuntimeManager`; the current subscriber/replay behavior is implemented there.
- Current durable environment decisions are SQLite-backed; environment bundle content is still resolved from the configured repository facade.
- Apple chat state is owned by RookKit `SessionHandle`; platform models/controllers project that state into UI state.
- Mac environment detection intentionally selects one specialist or the generic fallback. iPhone and Android location implementations are intentionally platform-specific alternatives, not automatically duplicitous.

## Findings

### Server / infrastructure

- [Agent profile/runtime catalogs](server/infrastructure/agent-profile-config.md) — unused `agent-profiles.json` loader/schema was removed; `agent-runtimes.json` is the sole runtime catalog. **Resolved.**
- [Legacy server config migration](server/infrastructure/legacy-config-migration.md) — old `server/config` / override migration was removed. **Resolved.**
- [Legacy web-client option](server/infrastructure/legacy-web-client-option.md) — the no-op server option and Mac web-app affordance were removed. **Resolved.**

### Server / runtime and sessions

- [Orphaned room/realtime stack](server/runtime/orphaned-room-realtime-stack.md) — orphaned room/event classes and support types were removed. **Resolved.**
- [WebSocket session-list compatibility path](server/sessions/websocket-session-list.md) — REST session listing is now the sole discovery path. **Resolved.**
- [Load/resume protocol aliases](server/sessions/load-resume-alias.md) — `session/load` is canonical and the unused `session/resume` alias was removed. **Resolved.**
- [Android session transport lag](clients/android/session-transport-lag.md) — Android now uses session-bound sockets and transcript hydration. **Resolved in code; device verification remains.**
- [Android legacy ACP events](clients/android/legacy-acp-events.md) — obsolete `_rookery_*` event reducers were removed. **Resolved.**
- [Legacy environment registration method](server/environments/legacy-registration-method.md) — candidate registration is now the sole registration path. **Resolved.**
- [Legacy decision shape](server/environments/legacy-decision-shape.md) — permanent decisions now require known bundle hashes and the nullable legacy write path is gone. **Resolved.**
- [Orphaned location prompt renderer](server/location/orphaned-location-prompt-renderer.md) — unused direct prompt rendering was removed; product docs now describe skill-bundle delivery. **Resolved.**
- [Permissive motion compatibility](server/location/permissive-motion-compatibility.md) — missing motion data now fails closed. **Resolved.**
- [CLI session transport lag](clients/cli/session-transport-lag.md) — the CLI now uses REST discovery/transcript hydration and session-bound attach. **Resolved.**

### Client migration residue

- [iPhone chat migration residue](clients/apple/iphone-chat-migration-residue.md) — iPhone now projects handle-owned queue state and no longer retains duplicate lifecycle scaffolding. **Resolved.**
- [iPhone auth-token migration](clients/apple/iphone-auth-token-migration.md) — iPhone now uses Keychain only. **Resolved.**

### Tooling from the removed stack

- [Removed-stack remote-agent CLI](tooling/removed-stack-remote-agent-cli.md) — the stale script, modules, package commands, and documentation were deleted. **Resolved.**

## Product alignment notes

The full `PRODUCT/` set was reviewed before cleanup. These requirements change how some findings must be resolved:

- `PRODUCT/agent-client-protocol.md` previously described `_rookery/steering_prompt` and the removed `SessionRoom`/`BaseAgent` stack. It now documents the current `_com.rookkeeper` environment extensions and treats steering as a future current-runtime decision.
- `PRODUCT/location-environment-awareness.md` now documents the current generated location skill bundle path; the unused direct renderer was removed rather than reintroduced.
- `PRODUCT/relationship-between-sessions-and-environments.md` now documents the current scope: ephemeral Accept/Ignore is per session, while persistent Approve/Reject is app-wide.
- The remaining product documents describe filesystem-backed repositories, personal authoring, narrow environment bridges, and bundle/skill relationships consistently with the current catalog. No other finding requires changing those product expectations.

## Explicitly not counted as duplicitous in this pass

- `identify` versus `register-location`: the former is read-only and the latter commits/auto-enters; the split is explicitly documented in the architecture.
- Mac specialist providers versus `GenericEnvironmentProvider`: exactly one provider is selected by design.
- `CompositeEnvironmentRepository` versus its directory/location repositories: these are the configured repository composition, not old/new behavior.
- Swift/Compose model copies: they are platform implementations. Android's session lifecycle lag is cataloged separately because it contradicts the current transport/hydration contract.
- `EnvironmentDecisionStore` versus `SessionDecisionRegistry`: durable `approve/reject` and ephemeral `accept/ignore` intentionally have different lifetimes.
- `RecordingService`'s Android-version-specific storage branches and AOSP location fallback: operating-system compatibility, not refactor residue.

## TODOs

- [x] Review each finding with the owning component before deleting or consolidating code.
- [x] Assign a cleanup issue and owner for every confirmed finding.
- [x] Re-run the architecture inventory after cleanup and remove resolved entries or mark them complete.
- [x] Update affected tests, READMEs, and `AS-BUILT-ARCHITECTURE/` documents as implementations change.
