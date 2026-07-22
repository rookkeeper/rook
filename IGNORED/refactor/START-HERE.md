# Refactor start here

## Goal

Refactor `clients/mac/Sources/Models/RookMacModel.swift` into smaller pieces while keeping Mac and iPhone behavior stable.

## Read first

- `IGNORED/refactor/TODO.md`
- `IGNORED/refactor/server-state.md`
- `IGNORED/refactor/environment-subsystem.md`
- `IGNORED/refactor/chat-session.md`
- `IGNORED/refactor/environment-offers.md`
- `IGNORED/refactor/permissions.md`
- `IGNORED/refactor/voice.md`
- `IGNORED/refactor/bridge.md`
- `IGNORED/refactor/mac-manual-verification.md`
- `IGNORED/refactor/iphone-manual-regression.md`
- `IGNORED/refactor/restoration-issue-template.md`

## Important decisions already made

- `AppEnvironmentProvider` is the always-on root environment provider.
- Specialized providers (such as browser/Obsidian) only derive extra candidates.
- Specialized providers do not emit independently.
- Voice/hotkey is being removed for now.
- Bridge/computer control is being removed for now, except for any temporary environment-flow dependency during migration.
- If voice/bridge/permissions features are removed, create restoration issues with commit references and behavior summaries.
- Keep iPhone behavior working as it does today.

## First tasks

- [x] Read all files in `IGNORED/refactor/`
- [x] Identify current Mac view/state dependencies on voice, bridge, and permissions
- [x] Review the Mac manual verification checklist
- [x] Review the iPhone manual regression checklist
- [ ] Add pure tests for environment derivation helpers
- [x] Extract `ServerStateController` before touching chat/session extraction

## Suggested execution order

1. Add pre-refactor tests/checklists
2. Extract server lifecycle/health polling
3. Remove voice/hotkey
4. Remove bridge/computer-control pieces not needed for environment flow
5. Re-evaluate remaining permissions
6. Extract current environment flow without changing behavior
7. Convert environment flow to `AppEnvironmentProvider` + specialized providers registry
8. Extract environment offers/list ownership
9. Extract chat/session/socket state management last

## Files most likely to change first

- `clients/mac/Sources/Models/RookMacModel.swift`
- `clients/mac/Sources/Views/`
- `clients/mac/Sources/Services/ForegroundAppMonitor.swift`
- `clients/mac/Sources/Services/ServerController.swift`
- new files under something like `clients/mac/Sources/Controllers/`

## Success criteria

- Mac client still works for chat, sessions, environment flow, offers, and environment list
- iPhone client still works for chat, sessions, offers, and environment list
- `RookMacModel` is smaller and more clearly a composition root/view model
- Removed features have restoration issues or issue-ready notes with commit references
