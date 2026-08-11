# Bundle identity migration

## Problem

The protocol namespace is already `com.rookkeeper`, and iPhone bundle IDs use
that namespace, but the Mac and Android clients still ship as `com.rookery.*`.
The Mac foreground provider can therefore register Rook itself as an
environment such as `mac:com.rookery.Rook`, while launcher, logging, Keychain,
and documentation identities disagree.

## Investigation

- Pickaxe showed no Mac transition from `com.rookkeeper` back to `com.rookery`.
  Mac was introduced under `com.rookery` and retained it through the Rook rename.
- `clients/mac/project.yml`, generated Xcode settings, launcher profiles,
  `RookBundleIdentity`, logging, Keychain, and Mac documentation use the old
  namespace.
- `clients/iphone/project.yml` already uses `com.rookkeeper`, but its URL
  metadata, simulator instructions, logging documentation, and shared RookKit
  fallback still contain the old namespace.
- Android uses `com.rookery.rook` as its Gradle application ID, namespace, and
  Kotlin package/directory tree; the launcher still force-stops that ID.
- Current architecture documentation describes the old Mac bundle identity.
- Existing Apple Keychain auth tokens are stored under the old service name;
  changing the service without a one-time fallback would make an otherwise
  working client appear logged out.
- Existing persisted environment records may contain old `mac:com.rookery.*`
  IDs. The server's environment model treats IDs as durable identities, so the
  migration should not rewrite arbitrary historical records automatically.

## Options and questions

1. **Only change Mac:** fixes the reported environment but leaves Android and
   shared Apple identity surfaces inconsistent.
2. **Replace every textual `com.rookery` occurrence:** risks rewriting
   historical change records and unrelated package/project names such as
   `rookery-server` and `@rookery/cli`.
3. **Migrate active product identity surfaces, preserve intentional compatibility
   references:** changes shipped identifiers, code, launchers, tests, current
   architecture docs, and READMEs; leaves historical CHANGES evidence and
   non-namespace project names untouched. Retain a narrowly scoped legacy
   Keychain read/migration path.

## Direction

Use option 3. Canonical shipped identities become:

- Mac: `com.rookkeeper.Rook`, `com.rookkeeper.Rook.Dev.*`
- iPhone: existing `com.rookkeeper.Rook*` identifiers, including URL/logging
  metadata
- Android: `com.rookkeeper.rook`, including Gradle namespace and Kotlin
  packages/directories
- Apple shared logging and Keychain service: `com.rookkeeper.Rook`

Add focused tests for Mac internal-bundle filtering and the Android package/
launcher identity where practical. Validate generated Apple projects, Swift
build/tests, Android unit tests, and repository-wide active references.
