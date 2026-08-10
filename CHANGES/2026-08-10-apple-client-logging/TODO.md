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

- [ ] Add a shared Apple-client logging utility in `clients/RookKit/` that standardizes subsystem/category names and provides reusable performance/timing helpers for both apps.
- [ ] Replace mac-only ad-hoc provider file logging with standard unified logging, and update the mac log-viewing path so it can still inspect the relevant logs after the change.
- [ ] Instrument mac environment/provider code with structured logs and timing around foreground activation, AX reads, Finder observation, environment registration, bridge activity, and managed-server lifecycle events.
- [ ] Instrument shared session/network code in `RookKit` with structured logs around REST requests, WebSocket connect/disconnect, session load/hydration, reconnects, queued prompts, and run lifecycle transitions.
- [ ] Instrument the iPhone client and location provider with structured logs around health refresh, session resume/start, place monitoring, visit arrivals, environment identification, and voice/location state changes where useful.
- [ ] Add or update focused tests for any new shared logging/performance helpers and keep existing Apple-client tests/builds passing.
- [ ] Update Apple-client docs (`clients/mac/README.md`, `clients/iphone/README.md`, and any other touched README/docs) to describe the logging approach and how to capture logs for hang investigation.
- [ ] Review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code.
- [ ] Remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around.
- [ ] Update `AS-BUILT-ARCHITECTURE/` as needed.
- [ ] Update `PRODUCT/` as needed.
- [ ] Run the appropriate Apple-client tests/builds and confirm they pass.

## Exit criteria

- [ ] The mac and iPhone clients use one coherent unified-logging approach instead of mixing ad-hoc logging styles.
- [ ] High-value beachball-adjacent paths in the mac client emit structured timing/performance logs that are practical to inspect after a hang.
- [ ] Shared `RookKit` session/network code emits enough logs to reconstruct connection, session, and prompt lifecycle behavior on both Apple clients.
- [ ] The mac log-viewing/documentation story reflects the new authoritative logging path.
- [ ] Tests/builds relevant to the Apple-client changes pass.
- [ ] Architecture/docs reflect the final logging design, and no unnecessary compatibility shims remain.
