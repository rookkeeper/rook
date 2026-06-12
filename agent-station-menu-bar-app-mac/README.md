# Agent Station Menu Bar (macOS)

A native SwiftUI menu bar client for [Agent Station](../README.md) — talk to
your Pi / Claude / Cursor agents from the macOS menu bar. The panel design
(dark translucent cards, slide-in detail views, hover affordances) follows the
Stoa Scribe menu bar app; the functionality is the full Agent Station
embeddable client, implemented natively against the server's REST + ACP
JSON-RPC WebSocket protocol.

## Features

- **Agent picker** — `GET /api/agents`, rendered as a tree (profiles indented
  under their parent agent).
- **Sessions** — per-agent session history with running/stopped state, resume
  any session, or start a named new chat (`POST /api/agent/start`).
- **Auto-resume** — on launch the app rejoins the most recent session
  (`GET /api/agent/session/recent`), like the web client.
- **Streaming chat** — `session/prompt` over `ws://127.0.0.1:3000/api/ws`;
  renders agent text, thinking (collapsible), tool calls with live
  input/output, plans, run errors, and context usage.
- **Message queueing** — messages sent while the agent is busy queue and
  auto-send after the current turn (120 ms gap), matching the web client.
- **Environment offers** — `environment_offer_available` events open a native
  approval view with skill-file preview (`GET /api/environments/preview`) and
  the four 2×2 decisions (`POST /api/environments/decision`): allow this
  visit / always allow / not now / never.
- **Server supervision** — health polling; if the server is down the panel can
  launch `npm run dev` for the repo and tail its log
  (`~/Library/Logs/AgentStationMenuBar/server.log`).

## Build

Requires Xcode and [xcodegen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`).

```zsh
cd agent-station-menu-bar-app-mac
xcodegen generate
xcodebuild -project AgentStationMenuBar.xcodeproj -scheme AgentStationMenuBar -configuration Debug build
```

## Run

```zsh
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -path '*/Build/Products/Debug/AgentStationMenuBar.app' -print -quit)
open "$APP_PATH"
```

The app appears only in the menu bar (no Dock icon) as a bird. The icon fills
and turns orange when an environment offer is pending, and tints blue while a
run is in flight.

The Agent Station server is expected at `http://127.0.0.1:3000` (start it with
`npm run dev` at the repo root, or use the panel's Start Server button). The
repo root is derived from this package's source location; override it with:

```zsh
defaults write com.rookery.AgentStationMenuBar RookeryRepoRoot /path/to/rookery
```

## Notes on the wire protocol

- The websocket carries pure ACP JSON-RPC frames; the app sends only
  `session/prompt` and treats the JSON-RPC response as end-of-turn.
- Duplicated server-synthesized updates (`user_message_chunk` echoes,
  `_rookery_run_*`, `_rookery_status_changed`) are intentionally ignored,
  mirroring the React client's dedupe strategy.
- The server replays no message history; resuming a session starts with an
  empty thread (the app notes this inline).
- Rooms idle-stop ~15 s after their last client disconnects. The app keeps its
  socket open while a session is current — including while the panel is
  closed — and transparently restarts the room (re-`POST /api/agent/start`)
  when reconnecting.
