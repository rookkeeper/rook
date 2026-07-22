# Restore voice / hotkey support removed during `RookMacModel` refactor

## Removal commit

- `bfbe2cd0ff476b7201f505a6722846d8617acd4b`

## Prior implementation locations

- `clients/mac/Sources/Models/RookMacModel.swift`
- `clients/mac/Sources/Views/CapabilitiesView.swift`
- `clients/mac/Sources/Services/HotKey.swift`
- `clients/RookKit/Sources/RookKit/Voice/VoiceController.swift`

## Behavior before removal

- Optional voice mode toggle in the Mac client
- Push-to-talk via UI button and global hotkey
- Speech-to-text transcript routing into chat
- Spoken assistant replies
- Microphone + speech-recognition permission prompts

## Why it was removed

- Reduce `RookMacModel` scope during refactor
- Remove non-core behavior while stabilizing chat/session/environment boundaries
- Keep restoration possible later via archived code and issue notes

## Reimplementation notes

- Reintroduce a Mac-specific voice adapter/controller rather than putting voice state back into the main model
- Restore UI affordances intentionally instead of re-adding old toggles piecemeal
- Reconfirm permission copy and onboarding text before shipping again

## Tracking issue

- GitHub issue: `#96` — Restore voice / hotkey support removed during RookMacModel refactor
