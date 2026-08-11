# Bundle identity migration

## Context

Align all shipped client identities with the already-established
`com.rookkeeper` namespace. This prevents the Mac app from presenting itself
as a `com.rookery` environment and keeps Mac, iPhone, Android, launcher,
logging, and documentation surfaces consistent.

## Decision details

Change active product identity surfaces only; do not rewrite historical
CHANGES records or unrelated names containing “rookery.” Use stable
`com.rookkeeper` identities for Mac and Android, preserve the existing iPhone
identifiers, and provide a one-time legacy Keychain read/migration so existing
Apple auth tokens survive the service rename. Treat already-persisted old
environment IDs as historical data rather than silently rewriting them.

## Work checklist

- [x] Change Mac bundle IDs, development identities, internal-bundle filters,
      generated Xcode settings, launcher values, logging, Keychain service, and
      active Mac docs.
- [x] Change iPhone URL metadata, shared logging references, simulator and
      logging docs, and current architecture docs.
- [x] Rename Android application ID, namespace, Kotlin packages/directories,
      launcher force-stop/start commands, and Android docs.
- [x] Add or update focused regression tests for identity filtering and
      compatibility behavior.
- [x] Update current as-built architecture and package documentation while
      preserving historical change records.
- [ ] Run Swift, Android, shell, and repository-wide identity validation.
      Android validation is currently blocked because this machine has no Java
      runtime; server typecheck is blocked because worktree dependencies are
      not installed.
- [ ] Inspect the final diff and commit history, then synchronize with main.
