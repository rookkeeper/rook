# Outcomes

Merged in [PR #132](https://github.com/rookkeeper/rook/pull/132).

This moved the application database default under `ROOK_HOME`, added a legacy production database migration, prevented worktree launchers from inheriting ambient production `ROOK_HOME` / `ROOK_DATABASE_PATH`, and made newly seeded development homes start without inherited sessions.

- Start commit: `a419119` (`Add user-local DB planning docs`)
- End commit: `bf7e45d` (`Merge pull request #132 from rookkeeper/user-local-db-rook-home`)
