# Location TODO

This chunk preserves location behavior while relocating it into a clean domain-first organization with explicit seams to environments.

## Current likely inputs

- `server/src/server/location/*`
- location-related wiring in `index.ts`
- location-facing routes in `server/src/server/routes/environmentRoutes.ts`
- `server/src/server/environment/LocationContextRepository.ts`

## Goals

- Keep location identify/register flows identical.
- Keep POI lookup behavior identical.
- Keep dwell gating identical.
- Keep synthesized location-context bundle behavior identical.
- Preserve the same interaction contract with the environments domain.

## Proposed direction

- Keep `location` as its own domain.
- Move location routes into `location/routes/` only if they remain substantial enough; otherwise keep route handlers near environment registration routes while making ownership explicit.
- Keep POI providers and ptiles logic within the location domain.
- Re-evaluate whether `LocationContextRepository` is truly location-owned or environment-owned; choose based on the actual responsibility, not current placement.
- Keep the bridge between location and environments explicit rather than hidden in mixed folders.

## Steps

- [x] Inventory files that are pure location logic versus files that are actually environment-support code for location.
- [x] Decide the final home for `LocationContextRepository`.
- [x] Move pure location logic first: identifier, providers, dwell helpers, GPX/trace helpers if they remain server-runtime code.
- [x] Move route ownership once the environment/location boundary is clear.
- [x] Update tests as files move.

## Verification

- [x] `npm run typecheck --prefix server`
- [x] `npm run test --prefix server`
- [x] Run all location tests, especially:
  - [x] `EnvironmentIdentifier.test.ts`
  - [x] `LocationRegistrar.test.ts`
  - [x] `LocationContextSkill.test.ts`
  - [x] location helper/provider tests
- [x] Confirm `/api/environments/identify` and `/api/environments/register-location` behavior is unchanged.
- [x] Confirm location-triggered environment auto-entry side effects are unchanged.
