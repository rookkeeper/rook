# Environment subsystem refactor

## Scope

- [ ] Extract current environment collection/emission from `RookMacModel` without changing behavior first
- [x] Refactor the extracted flow into an always-on `AppEnvironmentProvider`
- [x] Let `AppEnvironmentProvider` maintain a registry/array of specialized providers active for the current app context
- [x] Separate generic foreground-app watching from app-specific context providers
- [x] Make browser URL handling independent from generic app dwell handling
- [x] Make environment candidate derivation testable

## Current responsibilities in `RookMacModel`

- [x] React to foreground app changes
- [x] React to in-app context refreshes
- [x] Prime AX for focused apps
- [x] Read browser URLs
- [x] Build `mac:` and `web:` candidates
- [x] Special-case Obsidian vault environments
- [x] Manage dwell timer + episode signature state
- [x] Emit environment registrations
- [ ] Update bridge context with current environment

## Target components

- [x] `AppEnvironmentProvider`
- [x] `EnvironmentCandidate` model/helpers
- [x] `BrowserEnvironmentProvider`
- [x] `ObsidianEnvironmentProvider`

## Proposed ownership

### `AppEnvironmentProvider`
- [x] Always-on root provider for foreground-app environments
- [x] Own focus episode state
- [x] Own dwell timers
- [x] Own register API calls
- [x] Own active specialized-provider registry/array for the current app context
- [x] Ask specialized providers for extra candidates
- [ ] Decide when an app episode and a web episode are distinct
- [x] Publish current foreground app/site environment IDs

### `BrowserEnvironmentProvider`
- [x] Activate only when the frontmost app is a supported browser
- [x] Read URL via `AXReader.activeTabURL`
- [x] Build hierarchical `web:` candidates
- [x] Apply browser-specific polling/upgrade rules
- [x] Return candidates only; do not own dwell or emission

### `ObsidianEnvironmentProvider`
- [x] Activate only when the frontmost app is Obsidian
- [x] Parse vault name from title
- [x] Build Obsidian-specific `mac:<bundle>/<vault>` candidates
- [x] Return candidates only; do not own dwell or emission

### `EnvironmentCandidate`
- [x] Shared type
- [x] Shared helpers for sorting/depth/signature generation
- [x] Shared metadata helpers

## Key design decision

- [x] `AppEnvironmentProvider` is the single owner of dedupe + dwell + emission
- [x] Specialized providers only derive extra candidates; they do not emit independently
- [ ] Do not force app environments and web environments through one identical episode pipeline
- [ ] Let app-level and browser-level context be related but separable
- [x] Keep the default app-level provider always active and treat specialized providers as conditional refinements

## Extraction steps

- [ ] Add tests for current environment derivation and dwell/emission behavior before changing architecture
- [x] Move candidate types/helpers out of `RookMacModel`
- [x] Extract the current environment flow into a single `AppEnvironmentProvider` without changing behavior
- [x] Move browser bundle allowlist and URL->environment logic into `BrowserEnvironmentProvider`
- [x] Move Obsidian parsing into `ObsidianEnvironmentProvider`
- [x] Add a specialized-provider registry/array managed by `AppEnvironmentProvider`
- [x] Have `AppEnvironmentProvider` gather, dedupe, and emit combined candidates
- [x] Replace direct `RookMacModel` calls with provider callbacks/published state

## Risks

- [x] Avoid duplicate emits from default app candidates + specialized provider candidates
- [ ] Avoid losing late-arriving browser URL context
- [x] Keep provider activation/deactivation simple when the frontmost app changes
- [ ] Preserve current behavior before moving from extracted flow to provider-registry flow
- [x] Keep bridge-context dependencies isolated until bridge removal is complete
