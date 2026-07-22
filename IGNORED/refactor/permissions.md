# Permissions reduction / possible refactor

## Scope

- [x] Re-evaluate permission request/check flows after voice + bridge/computer-control removal
- [x] Remove permission state that only existed for removed features
- [x] Extract any remaining permission logic only if it still has active product value

## Current responsibilities in `RookMacModel`

- [ ] Track Accessibility trust state
- [ ] Track Screen Recording trust state
- [ ] Request Accessibility permission
- [ ] Request Screen Recording permission
- [ ] Poll after request until permission status changes

## Target component

- [ ] `PermissionController` only if permission logic remains after removals

## Proposed responsibilities if retained

- [ ] Own remaining permission state
- [ ] Own polling-after-request behavior
- [ ] Expose callbacks/published values for permission changes
- [ ] Trigger follow-up actions like title refresh through injected hooks

## Decision / extraction steps

- [x] Identify which permissions are still required after voice + bridge removal
- [x] Delete permission UI/state that only existed for removed features
- [ ] If accessibility or screen-related permission logic still matters for active environment flow, extract that logic into `PermissionController`
- [x] Move any remaining permission polling loops out of `RookMacModel`
- [x] Replace direct AX/screen permission mutations in `RookMacModel`
- [ ] If permission features are removed entirely, file a restoration issue with commit reference and behavior summary

## Risks

- [ ] Keep permission-triggered refresh behavior explicit if permissions remain
- [ ] Avoid hidden coupling to `ForegroundAppMonitor`
- [ ] Avoid retaining permissions solely because of deleted bridge/voice features
