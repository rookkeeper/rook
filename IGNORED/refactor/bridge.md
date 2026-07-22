# Bridge removal / archival

## Scope

- [x] Remove local bridge lifecycle and computer-control features from the active macOS client for now
- [x] Preserve enough context to restore the feature later
- [x] Keep only the minimum code temporarily required to avoid breaking environment flow during refactor

## Current responsibilities in `RookMacModel`

- [x] Start/stop local bridge
- [x] Configure bridge handlers
- [x] Write bridge handshake file
- [x] Push current context into bridge
- [x] Toggle computer control enablement

## Target component

- [x] No long-lived replacement component in this refactor unless temporarily needed to isolate environment dependencies

## Proposed responsibilities during removal

- [x] Isolate any remaining environment-flow dependency on bridge context updates
- [x] Delete bridge lifecycle, handshake, and computer-control wiring once no longer needed
- [x] Record restoration details in a follow-up issue

## Removal steps

- [ ] Identify bridge code that is independent from environment flow and remove it first
- [x] Isolate `updateBridgeContext(...)` or equivalent environment dependency until the environment subsystem no longer needs it
- [x] Remove bridge startup, handshake-file writing, and computer-control toggle/state
- [x] Remove bridge-specific UI/capability state from `RookMacModel`
- [x] File a restoration issue with commit reference, prior file locations, behavior summary, and reimplementation notes

## Restoration issue contents

- [x] Link to the removal commit
- [x] Describe the loopback bridge routes and their purpose
- [x] Describe handshake-file behavior and why it existed
- [x] Describe computer-control gating behavior
- [x] Note any environment-context integration points that would need to be rebuilt

## Risks

- [ ] Avoid breaking environment flow while removing bridge-adjacent code
- [ ] Avoid leaving partial bridge state/UI behind after feature removal
