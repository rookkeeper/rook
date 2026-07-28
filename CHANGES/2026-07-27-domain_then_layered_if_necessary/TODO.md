# Domain-first server refactor TODO

Goal: reorganize `server/src/server` into a domain-first structure, and inside each domain use `routes/`, `services/`, `repositories/`, and `datastores/` only where they are actually needed.

Hard constraints for every chunk of work:

- Preserve all HTTP and WebSocket API shapes exactly.
- Preserve all runtime side effects exactly.
- Preserve SQLite schema exactly.
- Preserve filesystem/environment-repository layout exactly.
- Preserve ACP behavior exactly.
- Keep changes chunked so the server is working after each chunk.
- Keep tests updated as files move.
- Run verification after every chunk before starting the next one.

## Working rules for the refactor

- Change organization first, behavior never intentionally.
- Prefer move-only / rename-only steps before any cleanup.
- If a move would create too much churn, add temporary bridge exports and remove them later.
- Keep public entrypoints stable until the final cleanup chunk.
- Do one domain chunk at a time; do not mix multiple domains unless a shared file move requires it.
- If new information changes the plan, rewrite these TODOs while keeping the hard constraints above intact.

## Target shape

- `server/src/server/<domain>/...` becomes the primary organizing principle.
- Within each domain, create layer subfolders only when the domain actually has multiple layers.
- Keep low-level shared infrastructure in a small non-domain area only where it truly is cross-domain.
- Avoid recreating the current awkward hybrid where top-level layer folders and top-level domain folders both compete.

## Refactor order

### 1. Establish target map and carve out cross-domain infrastructure
- [x] Follow [server composition and infrastructure TODO](./server-composition-and-infrastructure.TODO.md).
- [x] Decide the small set of truly cross-domain files that should not live inside a business domain.
- [x] Define the target domain list before large moves begin.
- [x] Confirm how `index.ts` will compose the new domain modules without changing behavior.
- [x] Verify with: `npm run typecheck --prefix server` and `npm run test --prefix server`.

### 2. Sessions and transcripts
- [x] Follow [sessions and transcripts TODO](./sessions-and-transcripts.TODO.md).
- [x] Move session repository, transcript storage, session routes, and related tests into a single `sessions` domain shape.
- [x] Keep session APIs and transcript persistence behavior identical.
- [x] Verify with targeted session/transcript tests, then full `npm run test --prefix server`.

### 3. Runtime and realtime session orchestration
- [x] Follow [runtime and realtime TODO](./runtime-and-realtime.TODO.md).
- [x] Move ACP facade, runtime process orchestration, websocket session routing, and realtime helpers into a domain-first runtime/session-transport organization.
- [x] Keep runtime process lifecycle and websocket behavior identical.
- [x] Verify with ACP/runtime tests, then full `npm run test --prefix server`.

### 4. Environments
- [x] Follow [environments TODO](./environments.TODO.md).
- [x] Move environment bundle resolution, decision persistence, prompt helpers, binding helpers, and environment routes into one `environments` domain.
- [x] Inside that domain, split into routes/services/repositories/datastores only where useful.
- [x] Keep environment offers, decisions, approvals, prompts, and repository-backed bundle resolution identical.
- [x] Verify with environment tests, then full `npm run test --prefix server`.

### 5. Location
- [x] Follow [location TODO](./location.TODO.md).
- [x] Keep location as its own domain while preserving its integration with environments.
- [x] Move only after environment moves settle, because the location flow depends on environment registration and auto-entry behavior.
- [x] Keep identify/register-location side effects identical.
- [x] Verify with location tests, then full `npm run test --prefix server`.

### 6. Final topology cleanup
- [x] Remove no-longer-needed top-level `routes/`, `services/`, `repositories/`, and `datastore/` folders once replacements are complete.
- [x] Remove temporary bridge exports introduced during migration.
- [x] Normalize import paths.
- [x] Confirm no behavioral diffs were introduced during cleanup.
- [x] Verify with `npm run typecheck --prefix server`, `npm run build --prefix server`, and `npm run test --prefix server`.

### 7. Documentation wrap-up
- [x] Follow [docs and wrap-up TODO](./docs-and-wrapup.TODO.md).
- [x] Update `AS-BUILT-ARCHITECTURE/server.md` heavily to match the new organization.
- [x] Update `AS-BUILT-ARCHITECTURE/README.md` and `database.md` only as needed for renamed server structure references.
- [x] Keep other as-built docs unchanged unless a server reference truly requires adjustment.
- [x] Keep `PRODUCT/` files unchanged unless the refactor exposes a real mismatch that absolutely requires minimal wording updates.
- [x] Re-run final verification and sanity-check the server before declaring the refactor complete.

## Baseline verification checklist for every chunk

- [x] `npm run typecheck --prefix server`
- [x] `npm run test --prefix server`
- [x] If routing moved: exercise route registration tests / relevant route specs.
- [x] If runtime code moved: exercise ACP facade and runtime orchestration tests.
- [x] If environment code moved: exercise all environment manager / repository / decision tests.
- [x] If location code moved: exercise all location tests, including dwell/identify/registrar coverage.
- [x] If persistence code moved: confirm no schema changes and no fixture expectation changes beyond imports/paths.

## Completion criteria

- [x] `server/src/server` is primarily organized by domain.
- [x] Each domain uses layer subfolders only where they help.
- [x] Public APIs, side effects, and datastore schemas are unchanged.
- [x] Tests pass.
- [x] `AS-BUILT-ARCHITECTURE/server.md` reflects the new as-built organization.
- [x] `PRODUCT/` remains unchanged or only minimally changed with explicit justification.
