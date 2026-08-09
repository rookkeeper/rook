# Move the production application database under ROOK_HOME

## Context

Rook's profile model already treats `ROOK_HOME` as the root of user-local mutable state, but the production application database still defaults to repo-local `.var/rook/rook.sqlite`. That makes production inconsistent with development worktree profiles, which already place the application database under their profile-specific `ROOK_HOME`.

This chunk only moves the production/default application database into `ROOK_HOME` so user-local application state follows the same root as other profile-local state. It does **not** yet merge the application database with the personal environment repository database, and it does **not** change the canonical checked-in `environment-repository.db`.

## Details

Current behavior:

- production `ROOK_HOME` defaults to `~/.rook`
- development `ROOK_HOME` defaults to `~/.rook-<worktree-slug>`
- development already defaults the application DB to `ROOK_HOME/rook.sqlite`
- production still forces the application DB to `REPO_ROOT/.var/rook/rook.sqlite`
- `RookDatastore` itself already honors `ROOK_DATABASE_PATH`; the main mismatch is launcher/default-path policy and the documented architecture
- `run-rook.sh` must not accidentally inherit ambient `ROOK_HOME` / `ROOK_DATABASE_PATH` from another profile; launcher-specific overrides should be explicit

Desired behavior after this chunk:

- production default application DB path becomes `ROOK_HOME/rook.sqlite`
- development keeps using `ROOK_HOME/rook.sqlite`
- direct server startup keeps `ROOK_DATABASE_PATH` as the override escape hatch
- launcher-specific overrides use `RUN_ROOK_HOME` and `RUN_ROOK_DATABASE_PATH`
- docs and tests describe the new default consistently
- we decide and implement an explicit migration strategy for users who already have production data in `.var/rook/rook.sqlite`

Constraints / boundaries:

- do not merge the app DB with the personal environment repository DB in this chunk
- do not change the canonical checked-in repository database
- do not redesign the `environment_decisions` schema yet
- keep worktree/dev isolation intact
- keep launcher tests hermetic

Important files/modules:

- `scripts/lib/run-rook/profile.sh`
- `scripts/lib/run-rook/profile.test.sh`
- `server/src/infrastructure/datastores/RookDatastore.ts`
- `server/src/infrastructure/datastores/RookDatastore.test.ts`
- `server/README.md`
- `README.md`
- `AS-BUILT-ARCHITECTURE/database.md`
- `AS-BUILT-ARCHITECTURE/server.md`
- `CHANGES/2026-08-08-user-local-db-unification/BRAINSTORM.md`

Migration questions to settle while implementing:

- If `ROOK_DATABASE_PATH` is unset and `ROOK_HOME/rook.sqlite` does not exist but `REPO_ROOT/.var/rook/rook.sqlite` does exist, should we copy it, move it, or keep a one-time fallback read-and-copy behavior?
- How do we avoid repeatedly copying stale repo-local state after the first migration?
- Do we want migration to happen in the launcher, in the datastore layer, or in a narrowly scoped startup helper?

## Steps

- [x] Decide the exact migration behavior from legacy production `.var/rook/rook.sqlite` to `ROOK_HOME/rook.sqlite`.
- [x] Update the production launcher/default profile behavior so the default application database path is `ROOK_HOME/rook.sqlite` instead of repo-local `.var/rook/rook.sqlite`.
- [x] Implement the selected migration behavior for existing production databases without breaking explicit direct-server `ROOK_DATABASE_PATH` overrides or launcher `RUN_ROOK_DATABASE_PATH` overrides.
- [x] Confirm `RookDatastore` and any server startup path assumptions still behave correctly once production defaults move under `ROOK_HOME`.
- [x] Update hermetic launcher tests in `scripts/lib/run-rook/profile.test.sh` to reflect the new production default and cover the intended migration behavior if the launcher owns it.
- [x] Update server-side tests around application database path selection if needed.
- [x] Verify this chunk does not change development/worktree database isolation behavior.
- [x] Verify this chunk does not change personal environment repository behavior or canonical repository behavior.
- [x] Update `README.md` if the local-state story described there changes materially.
- [x] Update `server/README.md` to describe the new production default database location and any migration behavior.
- [x] Update `AS-BUILT-ARCHITECTURE/database.md` to describe the new default application database location.
- [x] Update `AS-BUILT-ARCHITECTURE/server.md` anywhere it still describes repo-local production application DB storage.
- [x] Run tests/build/typecheck appropriate to the change and confirm they pass.
- [x] Review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code.
- [x] Remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around.
- [x] Update `AS-BUILT-ARCHITECTURE/` as needed.
- [x] Decide no `PRODUCT/` updates are needed for this storage-default change.

## Exit criteria

- [x] Production Rook defaults its application database to `ROOK_HOME/rook.sqlite`.
- [x] Development/worktree Rook still uses isolated `ROOK_HOME/rook.sqlite` paths as before.
- [x] Existing production users with a repo-local `.var/rook/rook.sqlite` have a clear, implemented migration path.
- [x] Explicit direct-server `ROOK_DATABASE_PATH` overrides still work, and launcher-specific path overrides use `RUN_ROOK_DATABASE_PATH`.
- [x] No changes were made to canonical repository storage semantics.
- [x] No changes were made to personal environment repository storage semantics in this chunk.
- [x] Tests cover the intended default-path behavior and pass.
- [x] Docs and architecture notes describe the final behavior accurately.
