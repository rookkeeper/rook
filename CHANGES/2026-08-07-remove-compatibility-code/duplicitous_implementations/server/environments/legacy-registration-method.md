# `registerAvailableEnvironment` versus candidate registration

**Architecture area:** environment availability and registration.

**Status:** Resolved: tests and callers use candidate registration; the old method was removed.

## Current implementation

The public route accepts a `CandidateEnvironmentRecord` and calls `EnvironmentManager.registerCandidateEnvironment()`. That path finalizes the candidate, checks implied path/URL environments, captures metadata, resolves bundles, and remembers the resulting environments.

## Older implementation still present

`EnvironmentManager.registerAvailableEnvironment(env, info)` remains in `server/src/environments/services/EnvironmentManager.ts:170-184`. It directly calls `rememberAvailableEnvironment()` with an older `EnvironmentRecord` plus `EnvironmentOfferInfo` shape.

Repository-wide usage shows it is only called by `EnvironmentManager.test.ts`; production routes and `LocationRegistrar` use `registerCandidateEnvironment()`.

## Assessment

Confirmed old internal registration API with no production caller. It preserves the pre-candidate behavior in tests and maintains a second entry point into the same memory/offer machinery.

## Cleanup decision needed

Move any still-useful direct-registration test cases onto candidate registration, then delete `registerAvailableEnvironment`, `EnvironmentOfferInfo` if unused, and the old test-only contract. Keep the finalization behavior centralized in `registerCandidateEnvironment`.

## TODOs

- [x] Rewrite the direct-registration tests around `registerCandidateEnvironment`.
- [x] Confirm `EnvironmentOfferInfo` has no remaining production or test consumers.
- [x] Delete the old method and obsolete type after the tests move.
- [x] Verify environment offer, registration, and location tests.
