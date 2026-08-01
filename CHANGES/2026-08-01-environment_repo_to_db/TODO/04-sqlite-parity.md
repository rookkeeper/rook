# Gate 4 — Finish SQLite parity

## Demonstration

Import the current repository and compare filesystem and SQLite environments, bundles, artifacts, errors, hashes, previews, and search results. Confirm personal content can be read and written through SQLite.

## TODO

- [x] Add the initial separate SQLite datastore.
- [x] Add initial environment, bundle, and artifact tables.
- [x] Add direct bundle reads/writes and filesystem import.
- [x] Add compatibility filesystem projection for path-based consumers.
- [x] Add tests for round-tripping, import, search, and projection.
- [ ] Add finalized bundle revision/version/provenance/source fields.
- [ ] Preserve all repository/environment metadata during import.
- [ ] Add complete filesystem-versus-SQLite parity tests.
- [ ] Add canonical and personal databases to one logical repository view.
- [ ] Add database-backed personal content write-back.
- [ ] Add cache-first fetching and the agreed revalidation boundary.
- [ ] Pause before changing the default live repository.
