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
- `AcpSocket` and `RookAPI` from `RookKit`
  - ACP WebSocket transport and REST client
- `ForegroundAppMonitor`
  - detects frontmost app changes and in-app title refreshes
- `AppEnvironmentProvider`
  - owns the explicit bundle-id → specialist-provider registry
  - routes each focused app to exactly one provider: a specialist or the generic fallback
- `AXReader`
  - reads Accessibility-backed window/app context
- `MacBridge`
  - loopback HTTP bridge for agent perception and control
- `ServerController`
  - starts/stops a local dev server process and tails logs
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
- hierarchical `web:<host>` and `web:<host>/<path...>` IDs from generic Accessibility web/document signals

## Core data schemas

### Top-level app state in `RookMacModel`
- server status and runtime catalog
- session list and current session
- `blocks: [ChatBlock]`
- queued chat messages
- current mode/config options
- pending permission requests
- pending environment offers and environment previews, including revision metadata and capability artifact content
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
4. if the session is already running, the handle hydrates from `GET /api/sessions/:id/transcript`; otherwise it performs ACP `session/load`
5. resumed handles open a dedicated session-bound WebSocket (`/api/ws?sessionId=...`) and run `initialize`
6. the handle reduces `AcpClientEvent`s into `ChatBlock`s, tool states, plan state, permissions, and run lifecycle
7. switching sessions changes which handle the UI observes — background sessions keep their WebSocket and continue running
8. queued messages are delivered automatically once the agent goes idle

### Foreground environment detection
1. `ForegroundAppMonitor` detects app activation or window-title change
2. `AppEnvironmentProvider` always emits the base `mac:<bundleId>` app environment after a short dwell delay
3. `AppEnvironmentProvider` activates either a bundle-id-specific specialist or the generic fallback provider
4. `GenericEnvironmentProvider` polls every 5 seconds while active, reads Accessibility document and web signals, inspects observed paths under `/Users/<username>`, and emits only project-like / agentic `dir:` candidates plus `web:` candidates when the normalized environment-id set is stable across two polls
5. Specialist providers are selected by bundle-id from an explicit registry and currently include Obsidian, Slack, OBS Studio, Descript, Discord, and Finder
6. `ObsidianEnvironmentProvider` polls local data every 5 seconds, reads `~/Library/Application Support/obsidian/obsidian.json`, emits open vault environments, and emits enabled community-plugin environments
7. `SlackEnvironmentProvider` polls every 5 seconds, parses the focused window title, and emits workspace plus channel environments when the title exposes a stable channel context
8. `OBSStudioEnvironmentProvider` polls every 5 seconds, parses the focused window title, and emits scene-collection environments with profile/collection metadata when available
9. `DescriptEnvironmentProvider` polls every 5 seconds, parses the focused window title, reads `~/Library/Application Support/Descript/config.json`, and emits project environments with route/project metadata when available
10. `DiscordEnvironmentProvider` polls every 5 seconds, parses the focused window title, and emits server plus channel environments when Discord exposes a `channel | server - Discord` title
11. `FinderEnvironmentProvider` polls every 5 seconds, uses Finder AppleScript to inspect open Finder windows, and emits `dir:/...` environments for browsed folders while setting the frontmost Finder folder as the current app environment when available
12. `EnvironmentRegistrationController` suppresses duplicate emissions of the same environment id for 1 minute
13. server may respond with environment offers, which the client presents natively

### Environment approval
1. server emits `_com.rookkeeper/environment_offer`
2. model loads preview content if needed
3. user chooses allow once / always allow / not now / never
4. client resolves through the ACP extension or REST decision endpoint

### Computer-use / bridge flow
1. agent reaches the local bridge over HTTP
2. reads `/context`, `/ax-elements`, or `/screenshot`
3. optionally performs `/applescript`, `/open-url`, or `/input`
4. mutating `/input` is gated by the in-app computer-control toggle

### Server supervision
1. health polling marks server online/offline/starting
2. if offline, the app can launch `npm run dev` via `ServerController`
3. termination resets status and triggers a new health check

## Notable architectural characteristics

- the mac app is both a client and an environment provider
- session discovery is REST; agent interaction is one ACP WebSocket per session
- `SessionHandle` isolates all session state — blocks, streaming buffers, reconnection — so switching never tears down a running session
- environment registration is layered: base app identity plus exactly one context provider for the focused bundle id
- generic environment detection is AX-based and intentionally app-agnostic; app-specific providers are selected by bundle-id lookup from an explicit registry with a generic fallback
- environment registration is local-first and derived from visible user context plus app-owned local data where needed
- the Mac bridge centralizes Accessibility, Automation, and Screen Recording permissions in one native app
- reconnect and queued-message handling are built into the client reducer
