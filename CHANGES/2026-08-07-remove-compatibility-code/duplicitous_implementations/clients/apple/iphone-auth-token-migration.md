# iPhone UserDefaults token versus Keychain token

**Architecture area:** iPhone local authentication state.

**Status:** Resolved: iPhone no longer reads or writes the legacy UserDefaults token location.

## Current and older paths

- Keychain is the current secure storage path through `RookKit.KeychainStore`.
- `clients/iphone/Sources/RookModel.swift:109-116` still reads `UserDefaults.standard` key `RookAuthToken` as `legacyStoredToken`, falls back to it when Keychain is empty, copies it into Keychain, and removes the old value.
- `setServerConnection` also removes the old UserDefaults key and writes the new Keychain value (`RookModel.swift:777-786`).

## Assessment

Confirmed backward-compatibility data migration, not two long-term live stores: the old value is only read to migrate and is removed after a successful write. It remains duplicate implementation until the supported upgrade population is known to be migrated.

## Cleanup decision needed

After the migration window is intentionally closed, remove the UserDefaults read/fallback and migration branch, retaining only Keychain reads/writes. Keep a one-time migration test or release note only if the product still supports upgrades from versions that stored the token in UserDefaults.

## TODOs

- [x] Determine the minimum supported iPhone app version and migration population.
- [x] Decide when the UserDefaults fallback can be retired.
- [x] Add or retain a one-time migration test covering Keychain promotion and cleanup.
- [x] Remove the legacy read and UserDefaults writes after the cutoff.
