# Apple client logging overhaul

## Context

We need better logging in the Apple clients before we try to diagnose the recurring macOS beachballing. Today the mac app mixes ad-hoc `/tmp/rook.log` file appends with a small amount of `Logger` usage, and the iPhone client has almost no structured operational logging. This work standardizes client-side logging for the mac and iPhone apps, adds high-value timing/performance instrumentation around likely UI-blocking paths, and updates the client docs so we can reliably capture evidence from future hangs. The server is explicitly out of scope for this change.

## Details

The main affected surfaces are `clients/mac/`, `clients/iphone/`, and shared Apple-client code in `clients/RookKit/`.

Current behavior and constraints:

- mac foreground/environment tracing currently writes directly to `/tmp/rook.log` via `providerLog(...)`
- some mac chat/session code already uses `Logger`, but categories are inconsistent and logging coverage is thin
- the iPhone app shares `RookKit` networking/session code with the mac app, so a shared logging layer there gives us better coverage on both clients without duplicating code
- the likely beachball-adjacent paths are synchronous main-actor work such as Accessibility reads, Finder AppleScript observation, foreground polling, transcript/session hydration, and connection / environment refresh orchestration
- we want standard Apple unified logging, but the mac app still needs an inspectable log viewer story after the `/tmp/rook.log` path stops being authoritative
- avoid changing server logging as part of this pass

Important files/modules inspected up front:

- `clients/mac/Sources/Services/ForegroundAppMonitor.swift`
- `clients/mac/Sources/Services/AXReader.swift`
- `clients/mac/Sources/Services/MacBridge.swift`
- `clients/mac/Sources/Services/ServerController.swift`
- `clients/mac/Sources/Models/RookMacModel.swift`
- `clients/mac/Sources/Models/RookMacChatSessionController.swift`
- `clients/mac/Sources/Models/RookMacSupport.swift`
- `clients/mac/Sources/Models/EnvironmentProviders/*`
- `clients/iphone/Sources/RookModel.swift`
- `clients/iphone/Sources/Location/LocationProvider.swift`
- `clients/RookKit/Sources/RookKit/Net/AcpSocket.swift`
- `clients/RookKit/Sources/RookKit/Net/SessionHandle.swift`
- `clients/RookKit/Sources/RookKit/Net/RookAPI.swift`

## Steps

- [x] Add a shared Apple-client logging utility in `clients/RookKit/` that standardizes subsystem/category names and provides reusable performance/timing helpers for both apps.
- [x] Replace mac-only ad-hoc provider file logging with standard unified logging, and update the mac log-viewing path so it can still inspect the relevant logs after the change.
- [x] Instrument mac environment/provider code with structured logs and timing around foreground activation, AX reads, Finder observation, environment registration, bridge activity, and managed-server lifecycle events.
- [x] Instrument shared session/network code in `RookKit` with structured logs around REST requests, WebSocket connect/disconnect, session load/hydration, reconnects, queued prompts, and run lifecycle transitions.
- [x] Instrument the iPhone client and location provider with structured logs around health refresh, session resume/start, place monitoring, visit arrivals, environment identification, and voice/location state changes where useful.
- [x] Add or update focused tests for any new shared logging/performance helpers and keep existing Apple-client tests/builds passing.
- [x] Update Apple-client docs (`clients/mac/README.md`, `clients/iphone/README.md`, and any other touched README/docs) to describe the logging approach and how to capture logs for hang investigation.
- [x] Reduce default log noise by moving fast timing/polling details to debug level and gate raw foreground context behind `ROOK_VERBOSE_LOGGING=1`.
- [x] Review the final diff for temporary scaffolding, abandoned experiments, and other no-longer-needed transitional code.
- [x] Remove unnecessary temporary scaffolding and abandoned experiments.
- [x] Update `AS-BUILT-ARCHITECTURE/` as needed.
- [x] Update `PRODUCT/` as needed.
- [x] Run the appropriate Apple-client tests/builds and confirm they pass; the iPhone app build passes, while the existing `ArrivalGateTests` target contains unrelated stale `RookModel` test references and does not compile on the starting revision.

## Exit criteria

- [x] The mac and iPhone clients use one coherent unified-logging approach instead of mixing ad-hoc logging styles.
- [x] High-value beachball-adjacent paths in the mac client emit structured timing/performance logs that are practical to inspect after a hang.
- [x] Shared `RookKit` session/network code emits enough logs to reconstruct connection, session, and prompt lifecycle behavior on both Apple clients.
- [x] The mac log-viewing/documentation story reflects the new authoritative logging path.
- [x] Tests/builds relevant to the Apple-client changes pass, with the pre-existing stale iPhone test-target issue recorded above.
- [x] Architecture/docs reflect the final logging design, and no unnecessary temporary shims remain.
