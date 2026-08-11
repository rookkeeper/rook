# Flatten `server/src/server` to `server/src` TODO

Goal: remove the extra `server/` path segment so the package app code lives directly under `server/src/`, while preserving behavior, APIs, schemas, side effects, and build output semantics.

Constraints:
- Preserve HTTP and WebSocket API behavior exactly.
- Preserve runtime side effects exactly.
- Preserve SQLite schema exactly.
- Preserve filesystem layout expectations exactly.
- Keep tests green before and after.

## Steps

- [x] Move app code from `server/src/server/*` to `server/src/*`.
- [x] Update imports to the new relative paths.
- [x] Update package scripts (`dev`, `start`, test path references) to the new entrypoint/output path.
- [x] Update `tsconfig.server.json` includes/output expectations if needed.
- [x] Update docs that mention `src/server/...` paths.
- [x] Audit scripts under `server/scripts/` and adjacent helper scripts for old `src/server/...` path assumptions.
- [x] Verify the affected scripts still work after the refactor, or update them without changing their behavior.
- [x] Run `npm run typecheck --prefix server`.
- [x] Run `npm run build --prefix server`.
- [x] Run `npm run test --prefix server`.

## Completion criteria

- [x] Server app code lives under `server/src/` instead of `server/src/server/`.
- [x] `server/src/shared/` remains separate.
- [x] APIs/side effects/schema remain unchanged.
- [x] Build, typecheck, and tests pass.
