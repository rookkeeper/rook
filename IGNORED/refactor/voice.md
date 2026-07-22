# Voice removal / archival

## Scope

- [x] Remove voice + hotkey wiring from the active macOS client for now
- [x] Preserve enough context to restore the feature later

## Current responsibilities in `RookMacModel`

- [x] Configure `VoiceController`
- [x] Configure `HotKey`
- [x] Own voice auth/listening/speaking state
- [x] Route transcripts into chat
- [x] Start/stop speaking and listening
- [x] Request microphone/speech permissions

## Target component

- [x] No long-lived replacement component in this refactor

## Removal responsibilities

- [x] Remove `VoiceController` + `HotKey` wiring
- [x] Remove voice state publication from `RookMacModel`
- [x] Remove transcript routing and voice commands from the active app flow
- [x] Record restoration details in a follow-up issue

## Removal steps

- [x] Remove `setupVoice()` and related wiring from `RookMacModel`
- [x] Remove voice/hotkey lifecycle ownership from app startup/shutdown
- [x] Remove voice-specific UI/capability state from `RookMacModel`
- [x] Remove or simplify any view code that depends on voice state
- [x] File a restoration issue with commit reference, prior file locations, behavior summary, and reimplementation notes

## Restoration issue contents

- [x] Link to the removal commit
- [x] Describe push-to-talk hotkey behavior
- [x] Describe speech-to-text transcript routing behavior
- [x] Describe spoken-reply behavior and permission requirements
- [x] Note any UI affordances that would need to be rebuilt

## Risks

- [ ] Avoid leaving dead voice UI/state behind after removal
- [ ] Avoid accidentally regressing non-voice chat behavior while deleting transcript hooks
