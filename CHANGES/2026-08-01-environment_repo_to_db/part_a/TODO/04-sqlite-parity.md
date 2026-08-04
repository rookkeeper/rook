# Gate 4 — Finish SQLite parity

## Demonstration

Import the current repository and compare filesystem and SQLite environments, bundles, artifacts, errors, hashes, previews, and search results. Confirm personal content can be read and written through SQLite.

## TODO

- [x] Add the initial separate SQLite datastore.
- [x] Add initial environment, bundle, and artifact tables.
- [x] Add direct bundle reads/writes and filesystem import.
- [x] Add compatibility filesystem projection for path-based consumers.
- [x] Add tests for round-tripping, import, search, and projection.
- [x] Add initial bundle revision/content-hash/provenance/source fields.
- [x] Preserve the available repository bundle metadata and source paths during import.
- [x] Add filesystem-versus-SQLite parity coverage for artifacts and canonical hashes.
- [x] Add canonical and personal databases to one logical repository view in server wiring.
- [x] Add database-backed personal artifact write-back through the workspace materializer.
- [x] Keep the first migration cache-local; defer remote revalidation until a remote source adapter exists.
- [x] Add a migration test against a canonical and personal database pair.
- [x] Pause point reached: SQLite parity foundation is ready for controlled cutover.
