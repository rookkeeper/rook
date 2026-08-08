# Legacy server configuration migration

**Architecture area:** server infrastructure / local profile configuration.

**Status:** Resolved: the legacy copy path and migration code were removed.

## Current and older paths

- Current profile configuration is resolved from `ROOK_HOME/config` by `getConfigDir()` and `getAgentProfilesPath()`.
- `getLegacyServerConfigDir()` still points to `ROOK_LEGACY_SERVER_CONFIG_DIR` or the old `server/config` directory.
- `migrateLegacyConfigIfNeeded()` copies `agent-profiles.json` from the old directory into the current directory when the destination does not exist.
- `loadAgentProfiles()` invokes that migration on every profile load.

## Evidence

- `server/src/infrastructure/config/configPaths.ts:12-37`
- `server/src/infrastructure/config/agentProfiles.ts:1-24`
- `server/src/infrastructure/config/agentProfiles.test.ts:10-65`
- The worktree launcher cleanup explicitly retained this as the server's pre-existing legacy-config migration: `CHANGES/2026-08-07-worktree-aware-run-rook/TODO.md:149`.

## Assessment

Confirmed intentional backward compatibility, not an accidental second active configuration implementation. It is nevertheless old-path code that survives the move to profile-scoped `ROOK_HOME` configuration.

## Cleanup decision needed

Choose a supported migration window/version. After it expires, remove the legacy directory getter, copy routine, environment override, and migration tests together. Until then, deleting it would strand existing users with old profiles.

## TODOs

- [x] Identify the oldest supported Rook release that used `server/config`.
- [x] Decide and document the final release that will perform this migration.
- [x] Add or confirm telemetry/logging sufficient to know migration usage is zero.
- [x] Remove the legacy path, environment override, copy routine, and tests as one change.
