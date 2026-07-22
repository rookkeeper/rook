# Restore bridge / computer-control support removed during `RookMacModel` refactor

## Removal commit

- `bfbe2cd0ff476b7201f505a6722846d8617acd4b`

## Prior implementation locations

- `clients/mac/Sources/Models/RookMacModel.swift`
- `clients/mac/Sources/Views/CapabilitiesView.swift`
- `clients/mac/Sources/Services/MacBridge.swift`
- `clients/mac/Sources/Services/InputSynthesizer.swift`

## Behavior before removal

- Loopback HTTP bridge for local perception/control
- Handshake file with port/token in the user home directory
- Current-context payload for the frontmost app/environment
- Optional computer-control toggle for input synthesis
- Screen/window/AX perception routes and app-driving routes

## Why it was removed

- Reduce Mac client scope during refactor
- Remove non-core computer-control features while stabilizing environment flow
- Keep restoration possible later via archived code and issue notes

## Reimplementation notes

- Reintroduce the bridge behind a dedicated controller rather than putting lifecycle back into the main model
- Reconfirm which routes are still needed before restoring the old surface area
- Re-evaluate permission, handshake, and safety requirements before shipping again

## Tracking issue

- GitHub issue: `#95` — Restore bridge / computer-control support removed during RookMacModel refactor
