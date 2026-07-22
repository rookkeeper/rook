# Environment offers and environment list refactor

## Scope

- [x] Extract environment-offer handling and environment-list actions from `RookMacModel`
- [x] Separate offer queue state from environment detection/emission
- [ ] Keep current Mac behavior stable while preserving iPhone behavior in the corresponding offer/list flows

## Current responsibilities in `RookMacModel`

- [x] Track pending offers
- [x] Load offer previews/bundles
- [x] Resolve environment offers
- [x] Track environment list items
- [x] Auto-refresh environment list
- [x] Join/leave environments

## Target components

- [x] `EnvironmentOfferController`
- [x] `EnvironmentListController`

## Proposed responsibilities

### `EnvironmentOfferController`
- [x] Own pending-offer queue
- [x] Own offer preview loading
- [x] Own offer resolution calls
- [x] Publish current offer state
- [ ] Keep boundaries compatible with the simpler iPhone offer flow where practical

### `EnvironmentListController`
- [x] Own environment list loading state
- [x] Own auto-refresh lifecycle
- [x] Own join/leave actions
- [x] Own socket-driven entered/exited state updates
- [x] Publish entered environment IDs and list items
- [ ] Keep boundaries compatible with the iPhone environment-list flow where practical

## Extraction steps

- [x] Add Mac manual verification for offer queueing, approve/reject flow, and environment join/leave behavior
- [x] Add iPhone regression verification for offer handling and environment list behavior
- [x] Move pending-offer queue logic out of `RookMacModel`
- [x] Move environment preview loading out of `RookMacModel`
- [x] Move environment list loading/auto-refresh out of `RookMacModel`
- [x] Move join/leave methods out of `RookMacModel`
- [x] Move socket-driven entered/exited handling under the same list-state owner

## Risks

- [x] Keep socket-driven entered/exited event handling coordinated with list state
- [x] Avoid split ownership of entered environment IDs
- [ ] Avoid letting Mac extraction drift too far from iPhone semantics in shared offer/list behavior
