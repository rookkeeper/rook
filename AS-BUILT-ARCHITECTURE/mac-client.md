# macOS Client

## Summary

The macOS client is a native SwiftUI menu bar app with a regular app window. It is both a chat client and a Mac environment provider. It watches the frontmost app and browser URL, registers `mac:` and `web:` environments with the server, surfaces environment offers, and exposes a loopback Mac bridge for perception and control.

## Main components

- `RookMacModel`
  - main app state and reducer
  - owns server state, sessions, chat blocks, environment offers, environment list, voice, and provider state
- `AcpSocket` and `RookAPI` from `RookKit`
  - ACP WebSocket transport and REST client
- `ForegroundAppMonitor`
  - detects frontmost app changes and in-app title refreshes
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
- `mac:<bundleId>`
- `mac:<bundleId>/<context>` for richer app-specific contexts like Obsidian vaults
- hierarchical `web:<host>` and `web:<host>/<path...>` IDs for browsers

## Core data schemas

### Top-level app state in `RookMacModel`
- server status and runtime catalog
- session list and current session
- `blocks: [ChatBlock]`
- queued chat messages
- current mode/config options
- pending permission requests
- pending environment offers and environment previews
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
1. model ensures ACP socket connection
2. user creates or resumes a session
3. `AcpSocket` emits flattened `AcpClientEvent`s
4. `RookMacModel` reduces them into `ChatBlock`s, tool states, plan state, permissions, and run lifecycle
5. queued messages are delivered automatically once the agent goes idle

### Foreground environment detection
1. `ForegroundAppMonitor` detects app activation or window-title change
2. `RookMacModel` derives `mac:` and optional `web:` candidates
3. model updates bridge context
4. after a dwell delay, the focused environments are registered with the server
5. server may respond with environment offers, which the client presents natively

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
- environment registration is local-first and derived from visible user context
- the Mac bridge centralizes Accessibility, Automation, and Screen Recording permissions in one native app
- reconnect and queued-message handling are built into the client reducer
