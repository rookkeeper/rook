# macOS Client

## Summary

The macOS client is a native SwiftUI menu bar app with a regular app window. It is both a chat client and a Mac environment provider. It watches the frontmost app, registers `mac:` application environments plus richer generic/specialized candidate environments with the server, surfaces environment offers, and exposes a loopback Mac bridge for perception and control.

## Main components

- `RookMacModel`
  - main app state and reducer
  - owns server state, sessions, chat blocks, environment offers, environment list, voice, and provider state
- `SessionHandle`
  - per-session state container: owns a dedicated `AcpSocket` (one WebSocket per session), blocks, run state, streaming/replay buffers, queued messages, mode/config state
  - handles all ACP event reduction and reconnection for its session
  - multiple handles coexist; switching sessions is a pointer change
- `ChatSessionController`
  - registry of `SessionHandle`s keyed by session ID
  - loads session list via REST (`GET /api/sessions`)
  - proxies current-session UI state from the active handle
- `EnvironmentsDetailView`
  - renders the environment-memory list
- `BundleContentPreviewCard`
  - shows the offered bundle's actual content (`AGENTS.md`, `llms.txt`, each skill's `SKILL.md`, MCP/app files, repository read errors) inside the offer detail before the decision buttons
- `AcpSocket` and `RookAPI` from `RookKit`
  - ACP WebSocket transport and REST client
- `ForegroundAppMonitor`
  - detects frontmost app changes and in-app title refreshes
- `AppEnvironmentProvider`
  - owns the explicit bundle-id → specialist-provider registry
  - routes each focused app to exactly one provider: a specialist or the generic fallback
- `AXReader`
  - reads Accessibility-backed window/app context
- `MacStallWatchdog`
  - local-only background watchdog for detecting stalled main-run-loop progress
- `MacBridge`
  - loopback HTTP bridge for agent perception and control
- `ServerController`
  - starts/stops a local dev server process and tails logs
  - inherits the launcher-selected server profile when launched from the Mac client
- `MacImageAttachmentFactory`
  - normalizes pasted/dropped images into bounded ACP-ready PNG attachments
- voice/control services
  - `VoiceController`, `HotKey`, `InputSynthesizer`, `ScreenCapturer`, `ScreenOCR`

## Main interfaces

### Server-facing
Uses the shared server contract:
- WebSocket ACP at `/api/ws`
- REST routes for health, runtimes, environment preview/list, environment registration, and environment decisions

### MacBridge loopback API
Bound to `127.0.0.1` and bearer-token protected:
- `GET /health`
- `GET /context`
- `GET /window-text`
- `GET /screen-text`
- `GET /ax-elements`
- `GET /screenshot`
- `POST /applescript`
- `POST /open-url`
- `POST /input`

### Environment provider surface
The client derives and registers:
- `mac:<bundleId>` for the foreground application
- `mac:<bundleId>/<context>` for richer app-specific contexts like Obsidian vaults, Slack workspaces/channels, OBS scene collections, Descript projects, and Discord servers/channels
- exact `dir:/absolute/path` environments from Finder specialist detection of browsed folders
- `mac:<bundleId>/_plugin/<plugin-id>` for app-specific plugin capabilities such as enabled Obsidian community plugins
- meaningful `dir:/absolute/path` project-like or agentic directory environments derived from generic Accessibility document signals
- hierarchical `web:<host>` and `web:<host>/<path...>` IDs from top-level generic Accessibility document signals and browser-specialist nested web-area signals

## Core data schemas

### Top-level app state in `RookMacModel`
- server status and runtime catalog
- session list and current session
- `blocks: [ChatBlock]`
- queued chat messages containing ordered text/image prompt content
- current mode/config options
- pending permission requests
- pending environment offers and environment previews, including derived bundle hashes and capability content
- entered environment IDs and environment list items
- foreground app/context state
- voice and bridge capability state

### Chat presentation model
Via `RookKit`:
- `ChatBlock`
  - user
  - assistant text
  - thinking
  - tool
  - error
  - system
  - plan
  - environment banner
- `ToolBlockState`
  - `toolCallId`, `title`, `kindLabel`, `status`, `arguments`, `output`

### Mac bridge context payload
`/context` is maintained as a JSON snapshot containing the current frontmost app, bundle id, window title, environment id, and permission-related flags.

## Main processes

### App startup
1. `RookApp` creates `RookMacModel`
2. model loads base URL and auth token from env/defaults/keychain
3. model starts bridge, foreground monitor, voice, and health polling
4. on server availability it loads runtimes/sessions and auto-resumes the most recent session

### Chat flow
1. session list is fetched via REST, not the WebSocket
2. starting a new session opens an unbound WebSocket, sends ACP `session/new`, then keeps that same socket as the new session's `SessionHandle`
3. resuming an existing session creates or retrieves a `SessionHandle`
4. the handle performs ACP `session/load` when it is new or recovering; an already-loaded background handle reuses its in-memory blocks
5. after a successful resume/open, the client calls `POST /api/sessions/:id/touch` so the shared recents list reflects viewed sessions even without a prompt
6. resumed handles open a dedicated session-bound WebSocket (`/api/ws?sessionId=...`) and run `initialize`
7. the handle reduces `AcpClientEvent`s into `ChatBlock`s, tool states, plan state, permissions, and run lifecycle
8. switching sessions changes which handle the UI observes — background sessions keep their WebSocket and continue running
9. session rows expose rename/delete management actions that call the REST session-management routes without stealing the primary click-to-resume interaction
10. queued messages, including image attachments, are delivered automatically once the agent goes idle

### Foreground environment detection
1. `ForegroundAppMonitor` detects app activation or window-title change, but ignores all internal Rook bundle identities (`com.rookkeeper.Rook` and `com.rookkeeper.Rook.Dev.*`); when Rook becomes frontmost it clears the active external target and provider
2. `AppEnvironmentProvider` always emits the base `mac:<bundleId>` app environment after a short dwell delay
3. `AppEnvironmentProvider` activates either a bundle-id-specific specialist or the generic fallback provider
4. `GenericEnvironmentProvider` polls every 5 seconds while active, reads only focused-window Accessibility document values, inspects observed paths under `/Users/<username>`, and emits only project-like / agentic `dir:` candidates plus top-level-document `web:` candidates when the normalized environment-id set is stable across two polls
5. Specialist providers are selected by bundle-id from an explicit registry and currently include Safari/Firefox browser URL detection, Obsidian, Slack, OBS Studio, Descript, Discord, and Finder; internal Rook bundle IDs never reach either the specialist registry or generic fallback
6. `ObsidianEnvironmentProvider` polls local data every 5 seconds, reads `~/Library/Application Support/obsidian/obsidian.json`, emits open vault environments, and emits enabled community-plugin environments
7. `SlackEnvironmentProvider` polls every 5 seconds, parses the focused window title, and emits workspace plus channel environments when the title exposes a stable channel context
8. `OBSStudioEnvironmentProvider` polls every 5 seconds, parses the focused window title, and emits scene-collection environments with profile/collection metadata when available
9. `DescriptEnvironmentProvider` polls every 5 seconds, parses the focused window title, reads `~/Library/Application Support/Descript/config.json`, and emits project environments with route/project metadata when available
10. `DiscordEnvironmentProvider` polls every 5 seconds, parses the focused window title, and emits server plus channel environments when Discord exposes a `channel | server - Discord` title
11. `FinderEnvironmentProvider` polls every 5 seconds, uses Finder AppleScript to inspect open Finder windows, and emits `dir:/...` environments for browsed folders while setting the frontmost Finder folder as the current app environment when available
12. `BrowserEnvironmentProvider` handles Safari (`com.apple.Safari`) and Firefox (`org.mozilla.firefox`) only, walking the focused window's `AXWebArea` for the active page URL and emitting a host-level `web:` environment; generic and Electron paths do not perform this walk
13. Environment-path AX calls apply a 500 ms messaging timeout, log slow operation metadata without content, bound browser-tree traversal at 2 seconds, and run title/document/browser reads off the main actor; bridge text/action perception remains a separate path
14. `EnvironmentRegistrationController` suppresses duplicate emissions of the same environment id for 1 minute
15. server may respond with environment offers, which the client presents natively

### Environment approval
1. server emits `_com.rookkeeper/environment_offer`
2. model loads `GET /api/environments/preview` for the offered environment and selects the bundle by `bundleHash`
3. the offer detail shows the bundle's `AGENTS.md`, `llms.txt`, skill `SKILL.md` contents, and any issues in collapsible monospaced sections, with loading and failure states
4. user chooses allow once / always allow / not now / never
5. client resolves through the ACP extension or REST decision endpoint

### Computer-use / bridge flow
1. agent reaches the local bridge over HTTP
2. reads `/context`, `/ax-elements`, or `/screenshot`
3. optionally performs `/applescript`, `/open-url`, or `/input`
4. mutating `/input` is gated by the in-app computer-control toggle

### Server supervision
1. health polling marks server online/offline/starting
2. if offline, the app can launch `npm run dev` via `ServerController`, inheriting the selected `ROOK_HOME`, database path, port, and profile
3. termination resets status and triggers a new health check

### Worktree development profile
When launched from a Git worktree through `scripts/run-rook.sh`, the Mac app is built with a distinct development bundle identity and display name. It connects to the worktree's deterministic development port and can run beside the production-like app from the main checkout without sharing app preferences or server state.

## Client logging and hang diagnostics

Apple-client logging is centralized in `RookKit/Logging/RookLog.swift` and uses
Unified Logging with subsystem `com.rookkeeper.Rook`. The Mac app uses categories
for app, session, network, environment, bridge, server, and performance work.
`RookPerformance` records elapsed milliseconds and emits `OSSignposter` intervals;
fast successful operations are debug-level, 100 ms is the slow-operation threshold,
and 500 ms is the hang-warning threshold. `ROOK_VERBOSE_LOGGING=1` enables
additional polling and raw foreground-context details for a short diagnostic run;
otherwise window titles, document paths, and URLs are summarized rather than
logged.

The Mac instruments the beachball-adjacent paths: Accessibility title/document,
web-tree, text, and actionable-element reads; Finder AppleScript observation;
foreground/provider polling and registration; bridge routes; server supervision;
REST health/session/environment calls; WebSocket initialization/reconnect; and
ACP replay and prompt lifecycle. The in-app Rook Log viewer
shows recent unified logs for `com.rookkeeper.Rook`, tails them live, and includes
the managed server log as context. Unified Logging is authoritative for client
diagnostics.

## Notable architectural characteristics

- the mac app is both a client and an environment provider
- a local-only background watchdog records main-run-loop stalls without sending telemetry or collecting user content
- session discovery is REST; agent interaction is one ACP WebSocket per session
- `SessionHandle` isolates all session state — blocks, streaming buffers, reconnection — so switching never tears down a running session
- environment registration is layered: base app identity plus exactly one context provider for the focused bundle id
- generic environment detection is AX-based and intentionally app-agnostic; app-specific providers are selected by bundle-id lookup from an explicit registry with a generic fallback
- environment registration is local-first and derived from visible user context plus app-owned local data where needed
- the Mac bridge centralizes Accessibility, Automation, and Screen Recording permissions in one native app
- reconnect and queued-message handling are built into the client reducer
- Mac image paste/drop is normalized locally, inserted inline in the composer, and sent in order as standard ACP image content; it is never coupled to the runtime `cwd`
