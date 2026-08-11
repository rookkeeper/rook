# Apple client logs

Use this lane for Mac/iPhone networking, lifecycle, location, voice, session, environment, and performance problems. The Mac and iPhone share RookKit's networking/session layer, so logs usually identify the failing boundary before UI automation is needed.

## Source of truth

PR #136 (`2026-08-10-apple-client-logging`) replaced the old `/tmp/rook.log` foreground-provider file with Apple Unified Logging. Do not tail that file; its remaining references are historical change notes.

The shared subsystem is `com.rookery.Rook`. Stable categories are:

| Category | Main coverage |
| --- | --- |
| `app` | client model/lifecycle and health state |
| `session` | ACP WebSocket, session handles, prompts, reconnects, queues, runs |
| `network` | REST health and HTTP requests |
| `environment` | Mac foreground/provider/registration and offers |
| `location` | iPhone location and place identification |
| `voice` | speech permissions, listening, and synthesis |
| `bridge` | Mac loopback bridge routes |
| `server` | Mac-managed server supervision |
| `performance` | timed operations using the default logger |
| `ui` | shared/reserved UI logging |

## Capture commands

Mac production and iPhone shared-subsystem capture:

```zsh
log stream --style compact --level debug \
  --predicate 'subsystem == "com.rookery.Rook"'

log show --last 10m --style compact \
  --predicate 'subsystem == "com.rookery.Rook"'
```

### Mac worktree exception

`AXReader` and `MacStallWatchdog` construct loggers with `Bundle.main.bundleIdentifier`, using categories `AXReader` and `StallWatchdog`. Production records still use `com.rookery.Rook`, but a worktree uses `com.rookery.Rook.Dev.<slug>`. The exact shared-subsystem predicate can therefore miss the most important stall records.

Use this broader Mac predicate:

```zsh
log stream --style compact --level debug \
  --predicate '(process == "Rook" AND (subsystem BEGINSWITH "com.rookery.Rook" OR category == "AXReader" OR category == "StallWatchdog"))'

log show --last 1h --style compact \
  --predicate '(process == "Rook" AND (subsystem BEGINSWITH "com.rookery.Rook" OR category == "AXReader" OR category == "StallWatchdog"))'
```

### iPhone simulator

```zsh
xcrun simctl spawn booted log stream --style compact --level debug \
  --predicate 'subsystem == "com.rookery.Rook"'
xcrun simctl spawn booted log show --last 10m --style compact \
  --predicate 'subsystem == "com.rookery.Rook"'
```

For a physical iPhone, select the device in Console.app or Xcode's Devices and Simulators log view and filter for `subsystem:com.rookery.Rook`. Record the phone clock timestamp so it can be aligned with server logs.

The Mac **Rook Log** viewer shows the last ten minutes and a live stream of the shared subsystem, plus the managed server-log tail. It can omit worktree `AXReader`/`StallWatchdog` records; the broad terminal predicate is authoritative.

## Interpreting performance records

`RookPerformance` emits a completion record with `operation=<name> elapsedMs=<number>` and an `OSSignposter` interval. Fast successful operations are debug-level. Normal thresholds are:

- under 100 ms: debug/info
- 100–499.99 ms: warning
- 500 ms or more: error

Some network/session operations use 250/1,000 ms and AX/Finder operations use custom budgets. Failures are errors even when short. Treat `elapsedMs` and the watchdog's `ageMs` as milliseconds.

High-value Mac operations:

- `ax-focused-window-title`, `ax-focused-window-documents`, `ax-active-tab-url`, `ax-focused-window-text`, `ax-actionable-elements`
- `finder-observe`, `finder-environment-poll`, `generic-environment-poll`
- `mac-bridge-route`, `http-health`, `http-request`, `mac-load-sessions`, `managed-server-start`

`AXReader` also emits `slow AX call` at 100 ms with the attribute operation, target PID/bundle, AX result code, and node count. `AX traversal deadline reached` means active-tab traversal hit its 2-second deadline. AX reads have a 0.5-second messaging timeout.

## Interpreting session/network records

Follow this timeline:

1. `websocket connect start`
2. `operation=acp-connect-initialize` and connected state
3. session `load`, `attach`, or `acp-session-load`
4. `prompt send` / `session handle deliver`
5. `session handle run completed` or `run failed`
6. On failure: `websocket disconnected` → reconnect scheduled → health check → reconnect/load → queued delivery

Health checks and most RookAPI requests routed through `performData` record HTTP method/path, status, byte count, and latency. Check the source before assuming an endpoint is covered. `AcpSocket` and `SessionHandle` record session IDs, runtime IDs, connection state, queue counts, stop reasons, and error text, but not prompt bodies, image data, or auth tokens.

The iPhone adds `location ...`, `identify environments`, `place ...`, `iphone ...`, and `voice ...` records. For place activation, follow:

```text
location authorization → visit arrival/dwell gate → identify/register/preview
→ environment offer
```

The opt-in Mac chat-controller `timing ...` records require `ROOK_SESSION_TIMING_LOGS=1`. Their field is named `elapsedMs`, but the value is derived from seconds; do not combine it numerically with `RookPerformance` milliseconds without checking the source.
