# Gate 5 — Cut over live storage

## Demonstration

Run the server with SQLite as the normal repository, then verify registration, discovery, entry, offers, all four decisions, skill loading, restart behavior, and personal authoring.

## TODO

- [x] Add controlled opt-in SQLite server wiring.
- [ ] Make SQLite the default live repository implementation.
- [ ] Include canonical and personal repositories in the live logical view.
- [ ] Keep the directory reader only as an explicit migration/import utility.
- [ ] Verify environment discovery and bundle previews.
- [ ] Verify accept/approve/ignore/reject behavior against canonical content hashes.
- [ ] Verify runtime loading and personal authoring after cutover.
- [ ] Remove obsolete live filesystem repository wiring.
- [ ] Pause before deleting compatibility code.
