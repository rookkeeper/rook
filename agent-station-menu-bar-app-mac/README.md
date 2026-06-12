# Agent Station Menu Bar (macOS)

A native SwiftUI menu bar client for [Agent Station](../README.md) — talk to
your Pi / Claude / Cursor agents from the macOS menu bar. The panel layout and
interaction model (slide-in detail views, hover affordances) follow the Stoa
Scribe menu bar app; the visual design tokens are lifted from the Agent
Station web client (`agent-server-client/src/client/styles/tokens.css`) so the
two clients share one look. Functionality is the full Agent Station embeddable
client, implemented natively against the server's REST + ACP JSON-RPC
WebSocket protocol.

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
- **Foreground-app environment provider** — the app is a third environment
  provider alongside the Chrome extension and Obsidian plugin: it watches
  which Mac app is frontmost (NSWorkspace activation notifications — no
  Accessibility permission needed) and registers/unregisters `app:<slug>`
  environments as you switch apps.

## Foreground-app environments

The on-disk repository is the registry: a foreground app maps to environment
`app:<slug>` iff `environment-repository/app/<slug>/` exists at the repo root.
Directory names are matched against the slugified app name ("Visual Studio
Code" → `visual-studio-code`) and the app's bundle id (full, or its last
component). To make a new app contextual, just add a skill bundle:

```
environment-repository/app/cursor/cursor-companion/SKILL.md
```

Switching to that app registers the environment (`POST
/api/environments/register`); switching away ends the episode (`POST
/api/environments/unavailable`), so "Allow this visit" naturally means "while
this app stays in the foreground area of my work". Activations are debounced
(700 ms) so ⌘-Tab flicker doesn't churn registrations, the app ignores its own
activations (opening the panel doesn't end the episode), and the current
environment is re-announced if the server restarts. Offers arrive over the
session websocket like any other environment — the menu bar bird fills amber
and the native approval view shows the skill files before anything loads.

Provider activity is traced to `/tmp/agent-station-menubar.log` for debugging.

## Getting it running — exact steps

Prerequisites: Xcode, [xcodegen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`), and Node (for the Agent Station server).

```zsh
# 1. Start the Agent Station server (skip if it's already running)
cd <path-to-rookery>   # the repo root
npm run dev
# verify: curl http://127.0.0.1:3000/api/health  ->  {"ok":true,...}

# 2. Generate the Xcode project and build the app
cd agent-station-menu-bar-app-mac
xcodegen generate
xcodebuild -project AgentStationMenuBar.xcodeproj \
  -scheme AgentStationMenuBar -configuration Debug build

# 3. Launch it
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData \
  -path '*/Build/Products/Debug/AgentStationMenuBar.app' -print -quit)
open "$APP_PATH"
```

Look for the **bird icon** in the menu bar (no Dock icon — it's an
`LSUIElement` app). The icon fills and turns amber when an environment offer
is pending, and tints violet while a run is in flight. If you don't see it,
read the troubleshooting section below — on a crowded menu bar this is
expected, not a bug.

To kill and relaunch (e.g. after a rebuild):

```zsh
pkill -f AgentStationMenuBar; sleep 1; open "$(find \
  ~/Library/Developer/Xcode/DerivedData \
  -path '*/Build/Products/Debug/AgentStationMenuBar.app' -print -quit)"
```

The repo root (used by the panel's Start Server button) is derived from this
package's source location; override it with:

```zsh
defaults write com.rookery.AgentStationMenuBar RookeryRepoRoot /path/to/rookery
```

## Troubleshooting: the icon isn't in the menu bar

On notch Macs, macOS silently hides status items that don't fit — there is no
overflow indicator; they just vanish. Worse, each item's position is
*persisted* (distance from the right screen edge) in the app's defaults, so if
the app's first launch lands it in the hidden zone, it stays hidden on every
relaunch. Diagnose and fix:

```zsh
# Is a position stored, and where? (~870+ on a 1512pt display = hidden zone)
defaults read com.rookery.AgentStationMenuBar "NSStatusItem Preferred Position Item-0"

# Fix: quit the app, then pin the item into the visible right-hand cluster
pkill -f AgentStationMenuBar
defaults write com.rookery.AgentStationMenuBar \
  "NSStatusItem Preferred Position Item-0" -float 400
open "$APP_PATH"
```

Once visible you can ⌘-drag the icon and macOS persists wherever you drop it.
Long-term, a menu bar manager (e.g. Ice: `brew install --cask
jordanbaird-ice`, or Bartender) avoids the overflow cull entirely.

**Window-mode escape hatch** — run the panel as a regular floating window
(works regardless of menu bar space; re-running `open` on the app brings the
window back after closing it):

```zsh
defaults write com.rookery.AgentStationMenuBar ShowPanelWindow -bool true   # on
defaults write com.rookery.AgentStationMenuBar ShowPanelWindow -bool false  # off
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
- Intentional socket teardowns (switching sessions) are silent; only genuine
  transport failures trigger the reconnect path, and a successful connection
  cancels any armed reconnect.
