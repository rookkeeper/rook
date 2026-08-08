# Permissive no-motion location registration compatibility

**Architecture area:** location identification and registration.

**Status:** Resolved: missing motion signals now fail closed.

## Current behavior

The current arrival contract is intended to reject drive-by observations: stationary, sufficient dwell, or a settled speed should be present before `LocationRegistrar` registers/auto-enters a location set.

## Compatibility branch

`server/src/location/LocationRegistrar.ts:29-43` explicitly returns `true` when no usable motion signal is supplied. The branch is documented as `(back-compat)` and covered by `LocationRegistrar.test.ts:121`.

The client flows normally send motion/dwell fields, but older callers of `register-location` may omit them and still get registration.

## Assessment

Confirmed behavioral backward-compatibility branch. It is not a duplicate function, but it preserves the old permissive registration semantics alongside the newer dwell gate and therefore belongs in this audit.

## Cleanup decision needed

After all callers provide a motion contract, make missing motion data fail closed or require an explicit source/override. Update the route contract, clients, replay tooling, and test before removing the permissive return path.

## TODOs

- [x] Inventory external and internal `register-location` callers that omit motion fields.
- [x] Define the required motion payload and any explicit legacy override.
- [x] Update clients, replay scripts, route validation, and API documentation.
- [x] Change the missing-signal test from permissive compatibility to the chosen contract.
