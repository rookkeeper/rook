# Gate 5 — Cut over live storage

## Demonstration

Run the server with SQLite as the normal repository, then verify registration, discovery, entry, offers, all four decisions, skill loading, restart behavior, and personal authoring.

## TODO

- [x] Add controlled opt-in SQLite server wiring.
- [x] Make SQLite the default live repository implementation.
- [x] Include canonical and personal repositories in the live logical view.
- [x] Keep the directory reader behind the migration/import path rather than live repository wiring.
- [x] Verify environment discovery and bundle previews.
- [x] Verify accept/approve/ignore/reject behavior against canonical content hashes.
- [x] Verify runtime loading and personal authoring after cutover.
- [x] Remove obsolete live filesystem repository wiring from server bootstrap.
- [x] Pause point reached: compatibility importer/projections remain intentionally for migration and path-based runtime consumers.
