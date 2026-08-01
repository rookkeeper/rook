# Project 4: Create SQLite storage and import existing repositories

## Demonstration

Import the current repository, then compare filesystem and SQLite bundle previews, content, and hashes.

## Pause point

Stop for review after parity tests pass and personal content can be read and written through SQLite.

Only start this after the materialization and authoring seams work against the current repository.

- [x] Define the initial SQLite schema for bundles, capabilities, and membership.
- [x] Create the repository datastore abstraction for canonical or personal database locations.
- [x] Import the existing filesystem repository data.
- [x] Preserve complete skill file trees and other approval-relevant content.
- [x] Add database-backed bundle reads and writes.
- [x] Add repository tests against imported and directly stored data.
- [ ] Add full parity tests between imported content and the existing repository.
