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
identifiers, and remove the temporary `ROOK_DEV_ALLOW_REMOTE` gate so
worktrees honor their configured remote listener by default. Do not retain
migration or compatibility code for the old bundle IDs, Keychain service, or
persisted environment IDs; users of the old app identity must transition to
the new identity directly.

## Work checklist

- [x] Change Mac bundle IDs, development identities, internal-bundle filters,
      generated Xcode settings, launcher values, logging, Keychain service, and
      active Mac docs.
- [x] Change iPhone URL metadata, shared logging references, simulator and
      logging docs, and current architecture docs.
- [x] Rename Android application ID, namespace, Kotlin packages/directories,
      launcher force-stop/start commands, and Android docs.
- [x] Add or update focused regression tests for identity filtering and the
      new identity behavior.
- [x] Update current as-built architecture and package documentation while
      preserving historical change records.
- [x] Run Swift, Android, shell, and repository-wide identity validation.
      Swift, Xcode, shell, server typecheck, server tests, static identity
      checks, and a no-override server/Mac/iPhone launch passed. Android
      remains blocked because this machine has no Java runtime.
- [ ] Inspect the final diff and commit history, then synchronize with main.
