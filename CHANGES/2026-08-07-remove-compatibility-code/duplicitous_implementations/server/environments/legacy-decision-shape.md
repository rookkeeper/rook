# Bundle-level decisions versus legacy environment-level decision shape

**Architecture area:** environment decisions and SQLite persistence.

**Status:** Resolved: permanent decisions require known bundle hashes and the schema migration removes nullable legacy rows.

## Current model

The as-built model is bundle-oriented: offer and decision APIs carry `bundleHash` and clients resolve a specific environment bundle. Durable decisions are keyed by bundle hash, with `approve`/`reject` in SQLite; `accept`/`ignore` remain session-scoped in memory.

## Compatibility residue

- `server/src/environments/datastores/EnvironmentDecisionStore.ts:31-37` keeps `bundle_id` nullable.
- `EnvironmentDecisionStore.setDecision()` accepts `bundleId: string | null` (`:49-56`).
- `SessionDecisionRegistry.setPermanent()` preserves the nullable shape.
- `EnvironmentManager.decideEnvironment()` passes `null` when a permanent decision arrives without a matching remembered bundle.
- The only explicit test is named `allows null bundle_id for legacy environment-level decisions` (`EnvironmentDecisionStore.test.ts:36-43`).

## Assessment

Confirmed persisted-schema compatibility with the former environment-level decision model. It is not a second lookup algorithm—the current lookup still uses the bundle hash—but it keeps old rows/API calls representable and allows permanent decisions without a resolved bundle.

## Cleanup decision needed

Decide whether existing SQLite databases must remain readable. If not, make `bundle_id` required, reject decisions without a bundle hash, remove nullable parameters, and replace the legacy test with bundle-only invariants. If old databases remain supported, retain this as documented migration compatibility rather than treating it as current bundle behavior.

## TODOs

- [x] Determine whether existing decision databases with null `bundle_id` are still supported.
- [x] Audit all decision API callers for missing bundle hashes.
- [x] If safe, make the schema and TypeScript signatures bundle-required.
- [x] Add a migration or explicit rejection test for legacy rows.
