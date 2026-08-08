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
- [x] Add SQLite server wiring and later cut over the live default; directory storage remains import compatibility.
- [x] Add and update automated tests; the full server suite and typecheck pass at this save point.

## Historical limitations resolved by later gates

- [x] The materializer is connected to actual session startup/restart.
- [x] Personal write-back covers SQLite-backed skills and instructions.
- [x] The SQLite schema has revision, content-hash, source, and provenance fields.
- [x] The default live repository has been cut over to SQLite.
