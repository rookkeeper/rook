# RookMacModel refactor TODO

## Urgent blockers to fix before continuing

- [ ] Browser web environments are not currently being derived/emitted correctly
- [ ] Obsidian-derived environments are not currently being derived/emitted correctly

## Goals

- [x] Split `RookMacModel` into smaller controllers with clear ownership
- [ ] Keep behavior stable while refactoring structure
- [ ] Make environment collection/emission independently testable
- [x] Reduce direct coupling between UI state, socket state, server state, bridge state, and environment state
- [ ] Leave `RookMacModel` as a thin composition root + published view model

## Refactor order

- [x] Add pre-refactor tests and manual verification checklists for Mac + iPhone
- [x] Extract server lifecycle and health polling
- [x] Remove voice/hotkey integration and file a restoration issue with commit reference
- [x] Remove bridge/computer-control pieces not required for environment flow and file a restoration issue with commit reference
- [x] Remove permissions/capability state only if no longer needed after voice/bridge removal; otherwise defer
- [ ] Extract current environment collection/emission flow without changing behavior
- [x] Refactor environment collection into `AppEnvironmentProvider` + specialized providers registry
- [x] Extract environment offers and environment list actions
- [x] Extract chat/session/socket state management
- [ ] Reduce `RookMacModel` to wiring + published state only

## Target components

- [x] `ServerStateController`
- [x] `AppEnvironmentProvider`
- [x] `BrowserEnvironmentProvider`
- [x] `ObsidianEnvironmentProvider`
- [x] `EnvironmentCandidate` shared model/helpers
- [ ] `PermissionController` only if permissions remain in scope after removals
- [x] `EnvironmentOfferController`
- [x] `EnvironmentListController`
- [x] `ChatSessionController`

## Execution notes

- [ ] Keep refactors incremental and buildable after each step
- [ ] Keep Mac and iPhone clients working at current behavior throughout the refactor
- [x] Prefer extraction over behavior changes except for explicit removal of voice/bridge/computer-control features
- [ ] Add/update focused tests where logic becomes independently testable
- [x] Add manual verification checklists where automation is not practical
- [ ] Avoid pushing more responsibility into `RookMacModel` during refactor
- [x] When removing voice/bridge/permissions code, create restoration issues documenting behavior, prior file locations, commit reference, and reimplementation notes

## Pre-refactor coverage

- [ ] Add pure tests for app environment derivation
- [ ] Add pure tests for browser URL → hierarchical `web:` IDs
- [ ] Add pure tests for Obsidian title → vault environment derivation
- [ ] Add tests for dwell/emission dedupe behavior
- [ ] Add chat/session smoke coverage where practical
- [x] Review and maintain `mac-manual-verification.md`
- [x] Review and maintain `iphone-manual-regression.md`
- [x] Use `restoration-issue-template.md` when removing issue-worthy features

## Detail files

- [x] Review [server-state.md](zed://file/Users/johnberryman/projects/github/rookkeeper/rook/IGNORED/refactor/server-state.md)
- [x] Review [environment-subsystem.md](zed://file/Users/johnberryman/projects/github/rookkeeper/rook/IGNORED/refactor/environment-subsystem.md)
- [x] Review [chat-session.md](zed://file/Users/johnberryman/projects/github/rookkeeper/rook/IGNORED/refactor/chat-session.md)
- [x] Review [bridge.md](zed://file/Users/johnberryman/projects/github/rookkeeper/rook/IGNORED/refactor/bridge.md)
- [x] Review [permissions.md](zed://file/Users/johnberryman/projects/github/rookkeeper/rook/IGNORED/refactor/permissions.md)
- [x] Review [voice.md](zed://file/Users/johnberryman/projects/github/rookkeeper/rook/IGNORED/refactor/voice.md)
- [x] Review [environment-offers.md](zed://file/Users/johnberryman/projects/github/rookkeeper/rook/IGNORED/refactor/environment-offers.md)
