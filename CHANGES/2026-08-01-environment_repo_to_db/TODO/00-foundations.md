# Foundations — completed record

These are implemented prototypes and documentation. They are not permission to skip the ordered gates below.

- [x] Record design notes, decisions, FAQ, and review checkpoints.
- [x] Add `AgentWorkspaceMaterializer` for nested skill files and generated pseudo-markup instructions.
- [x] Add initial read-only projection for external skill files.
- [x] Add file-backed writable skill synchronization and tests.
- [x] Add a separate SQLite repository datastore with initial environment, bundle, and artifact tables.
- [x] Add SQLite bundle reads, writes, listing, search, and compatibility filesystem projection.
- [x] Add the directory-to-SQLite importer and an import command.
- [x] Make bundle hashes depend on canonical content rather than storage paths.
- [x] Add initial environment and bundle search endpoints.
- [x] Add controlled opt-in SQLite server wiring; directory storage remains the default.
- [x] Add and update automated tests; the full server suite and typecheck pass at this save point.

## Important limitations

- [ ] The materializer is not connected to actual session startup/restart.
- [ ] Personal write-back is only implemented for the file-backed prototype, not SQLite.
- [ ] The SQLite schema has no finalized revision/provenance model yet.
- [ ] The default live repository has not been cut over.
