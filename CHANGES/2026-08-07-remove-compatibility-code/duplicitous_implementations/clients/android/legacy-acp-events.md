# Android legacy `_rookery_*` event compatibility

**Architecture area:** Android ACP event reduction.

**Status:** Resolved: obsolete `_rookery_*` event reducers were removed; steering is documented as a separate future/current-runtime decision.

## Current protocol baseline

The as-built server forwards standard ACP notifications and owns only the `_com.rookkeeper/environment_*` extension. RookKit's current reducer handles standard `tool_call`, `tool_call_update`, `plan`, `usage_update`, mode/config updates, and JSON-RPC prompt completion.

## Older implementation still present

`clients/android/app/src/main/java/com/rookery/rook/net/AcpSocket.kt` still describes itself as mirroring the removed web client and parses `_rookery_tool_input_delta`, `_rookery_tool_call_ready`, `_rookery_tool_output_delta`, `_rookery_modes_state`, `_rookery_protocol_error`, and `_rookery_connection_error` in addition to standard ACP updates. Its top comment explicitly references `_rookery_run_*` and web-client behavior.

The current Swift `RookKit.AcpSocket` does not implement those `_rookery_*` update cases; it reduces the standard ACP shape directly.

## Assessment

Likely client-side compatibility residue from the removed web/room stack. Some generic “unknown runtime notification” tolerance may be harmless, but the named `_rookery_*` reducers are a second event protocol and are not represented in the current server architecture.

`PRODUCT/agent-client-protocol.md` separately names `_rookery/steering_prompt` as an intended product extension. That specific semantic method must be evaluated independently; removing obsolete event reducers must not silently remove a supported steering capability.

## Cleanup decision needed

Confirm whether any configured runtime still emits these custom messages and whether steering remains a required product feature. If only the event reducers are obsolete, delete those cases and associated Android event variants/tests while preserving or separately implementing steering. If external runtimes require the event protocol, isolate it behind a named legacy adapter and capability check rather than mixing it into the canonical reducer.

## TODOs

- [x] Search runtime fixtures, configured extensions, and external-runtime documentation for `_rookery_*` producers.
- [x] Resolve the product/architecture discrepancy around `_rookery/steering_prompt` before deleting related protocol code.
- [x] Add standard-ACP regression coverage for every event currently handled by the legacy cases.
- [x] Remove obsolete Kotlin event variants and reducers if no producer remains.
- [x] If compatibility is required, isolate it behind a named legacy adapter and capability check.
