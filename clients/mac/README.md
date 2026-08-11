# Rook Menu Bar (macOS)

A native SwiftUI menu bar client for [Rook](../../README.md) - talk to
your Pi / Claude / Cursor agents from the macOS menu bar. The panel layout and
interaction model (slide-in detail views, hover affordances) follow the Stoa
Scribe menu bar app; the visual design tokens are mirrored in the shared Swift
layer so the native clients share one look. Functionality
is the full Rook embeddable
client, implemented natively against the server's REST + ACP JSON-RPC
WebSocket protocol. For repo-level setup, `.env`, binding, and auth, start with
[docs/setup.md](../../docs/setup.md).

## Features

- **Sessions home** - unified session-selection screen listing all sessions across runtimes, with a New Chat form that selects a configured runtime.
- **Sessions** - session history ordered by most recently viewed/updated; resume any session by clicking it, rename it from the row action menu, or delete it with confirmation. Discovery is REST (`GET /api/sessions`), management uses `PATCH/DELETE /api/sessions/:id`, and opening/resuming a session records a REST touch so it moves to the top even without a new prompt. New chats start on one unbound WebSocket that becomes session-bound after `session/new`; thereafter live interaction is one session WebSocket per session.
- **Auto-resume** - on launch the app rejoins the most recent session; if it is already running, it hydrates from `GET /api/sessions/:id/transcript` instead of reloading the runtime.
- **Streaming chat** — `session/prompt` over `ws://127.0.0.1:7665/api/ws?sessionId=...`;
  renders agent text, thinking (collapsible), tool calls with normalized raw
  input/output (including auto-rendering well-formed JSON tool arguments as
  human-readable YAML), and assistant markdown with native drag-selection,
  standard copy/paste behavior, a copy-source button, and progressive
  render-as-it-streams for stabilized markdown prefixes. The composer accepts
  pasted or dragged images, inserts thumbnails inline with text, preserves their
  order, and sends them as standard ACP image blocks; it also renders plans,
  run errors, stop/cancel semantics, context usage, and optional usage cost.
- **ACP controls** — native support for permission requests
  (`session/request_permission`), session mode changes (`session/set_mode` /
  `current_mode_update`), and config options
  (`session/set_config_option` / `config_option_update`).
- **Message queueing** — messages sent while the agent is busy queue and
  auto-send after the current turn (120 ms gap). Queued messages can be edited or deleted.
- **Environment offers** - `environment_offer_available` events open a native
  bundle-level approval view showing the offered bundle name plus the names of
  any bundled skills, MCP servers, and apps, with the four 2×2 decisions
  (`POST /api/environments/decision`): allow this visit / always allow /
  not now / never.
- **Server supervision** - health polling; if the server is down the panel can
  launch `npm run dev` for the repo and tail its log
  (`~/Library/Logs/Rook/server.log`).
- **Main-thread stall watchdog** - a local background watchdog records a
  unified-log warning when the Mac app's main run loop stops advancing for
  several seconds. Records include a client instance ID, the last known
  diagnostic operation, safe process/lifecycle context, and recovery duration;
  they do not include window contents or transcript text.
- **Mac environment provider** - the app immediately registers newly seen
  user-visible environments, keeps them alive with periodic re-registration,
  and forgets them locally after 4m45s without renewed user-visible focus. Generic path-derived registration is now conservative: it only emits project-like or agentic `dir:/...` environments under `/Users/<username>` rather than every observed path segment.

## Voice (hands-free)

Talk to your agent and hear it reply, without the input box. The loop runs
locally in the menu bar app and reuses the existing agent websocket:

1. **Speech → text** - Apple Speech (`SFSpeechRecognizer`), on-device on Apple
   Silicon. Press-to-talk; a ~1.4 s pause ends your turn.
2. The transcript is sent to the current session like any typed message.
3. **Text → speech** - `AVSpeechSynthesizer` speaks the streamed reply
   sentence-by-sentence (markdown/code stripped) as it arrives.

Enable it on the **Voice** card, then **press to talk** there or hit
**⌃⌥Space from any app** (global hotkey; uses the Accessibility grant). First
use prompts for Microphone + Speech Recognition. Combined with Computer
Control, you can speak a request and have the agent act on your screen and
report back aloud - no typing.

**Timing.** Your speech is sent as the prompt; the agent's reply is spoken
**once, after the full turn completes and renders** - not streamed
sentence-by-sentence. Thinking and tool steps are silent; only the final
response is read.

**Stopping it.** A **Stop** button appears on the Voice card while it's
speaking. Pressing to talk (or ⌃⌥Space) also interrupts playback - barge-in -
so you can cut it off and respond.

**Better voice.** The app auto-selects the best installed English voice
(premium → enhanced → default). macOS ships only low-quality voices by default
(you'll get "Samantha"), so for a natural voice download a **Premium** one.

Downloading a Premium voice (macOS Sequoia / 15):

1. **System Settings → Accessibility → Spoken Content.**
2. On the **System Voice** row, click the **i info button** to the *right* of
   the voice dropdown. (The dropdown itself only lists already-installed voices
   and has **no** "Manage Voices..." entry in Sequoia - the i is the only path to
   downloads.)
3. In the sheet, expand **English (US)** and find a voice marked **(Premium)** -
   e.g. **Ava, Zoe, Evan, Nathan**. Click the **cloud download icon ☁️**
   (~100-500 MB each).
4. That's it - you don't need to set it as the System Voice. The app re-picks
   the best voice on every spoken reply, so the next reply uses it (no relaunch).

> Older macOS (Ventura/Sonoma) had a "Manage Voices..." item at the bottom of the
> System Voice dropdown; Sequoia replaced it with the i button.

Premium voices are the neural, Siri-quality tier - a large step up from the
default Samantha. Pin a specific one with `defaults write
com.rookery.Rook VoiceIdentifier <voice-id>`. For studio-quality
voices, swap `VoiceController`'s synthesizer for a cloud TTS (ElevenLabs,
Cartesia, OpenAI).

This is the local-first tier (free, private, no API). The quality knobs are
swappable without touching the agent: drop in a cloud STT (Deepgram, Whisper)
or a natural TTS (ElevenLabs, Cartesia) behind `VoiceController`, or front the
whole thing with a realtime speech-to-speech model (OpenAI Realtime, Gemini
Live) as an I/O layer that forwards to Rook as the brain.

## Foreground-app environments

The Mac app now keeps an in-memory cache of **encountered** environments.
Encountering means the environment became foreground on the Mac or appeared in a
startup/wake visible snapshot. Newly encountered environments register
immediately and start a configurable 5-minute local TTL window.

Tracked foreground environments include:

- frontmost regular apps as `mac:<bundleId>`
- richer foreground-derived app environments such as:
  - `mac:md.obsidian/<vault>`
  - `mac:md.obsidian/_plugin/<plugin-id>` for enabled community plugins
  - `mac:com.tinyspeck.slackmacgap/<workspace>/<channel>`
  - `mac:com.obsproject.obs-studio/<scene-collection>`
  - `mac:com.descript.beachcube/<project>`
  - `mac:com.hnc.Discord/<server>/<channel>`
  - exact `dir:/...` folder environments discovered from Finder windows
- frontmost browser pages as host-level `web:<host>` ids

Examples:

- frontmost Slack in `#announcements` on `NashDev` →
  `mac:com.tinyspeck.slackmacgap/NashDev/announcements`
- Obsidian in the `Peeps` vault → `mac:md.obsidian/Peeps`
- OBS Studio in the `Untitled` scene collection →
  `mac:com.obsproject.obs-studio/Untitled`
- Descript in the `AI Tinkerers 2026.05.22` project →
  `mac:com.descript.beachcube/AI%20Tinkerers%202026.05.22`
- Discord in `#self-promotion` on `Build With AI` →
  `mac:com.hnc.Discord/Build%20With%20AI/self-promotion`
- Finder frontmost in `/Users/johnberryman/projects/github/rookkeeper` →
  `dir:/Users/johnberryman/projects/github/rookkeeper`
- `https://en.wikipedia.org/wiki/Main_Page?foo=bar` →
  `web:en.wikipedia.org`

The Mac app registers the exact encountered ID it sees at the moment, such as:

- `mac:com.tinyspeck.slackmacgap/NashDev/announcements`
- `mac:md.obsidian/Peeps`
- `mac:com.obsproject.obs-studio/Untitled`
- `mac:com.descript.beachcube/AI%20Tinkerers%202026.05.22`
- `mac:com.hnc.Discord/Build%20With%20AI/self-promotion`
- `dir:/Users/johnberryman/projects/github/rookkeeper`
- `web:en.wikipedia.org`

Specialist providers now live under `Sources/Models/EnvironmentProviders/` and
are assembled into an explicit bundle-id registry. Bundle IDs with no
specialist use the generic provider. Finder is a specialist too, but it emits
`dir:/...` environments instead of Finder-specific IDs so local file context
stays consistent. For Obsidian, vault parsing is title-based and works
backwards so note names may contain dashes safely. For plain apps the base
identity is the bundle id: `mac:<bundleId>`.

Each newly encountered environment registers with a fresh `registeredAt`
timestamp (`POST /api/environments/register`). If the same cached environment
stays within its local TTL, the Mac performs a scheduled keepalive re-register
every 5 minutes. If it is not brought back into user-visible focus within
4m45s, it simply falls out of the Mac cache; the server ages it out on its
own.

Non-user timers/polls do **not** discover new environments. They are used only
for:

- local TTL expiry cleanup of already-cached environments
- scheduled keepalive re-register of already-cached environments
- server/wake reconciliation of currently visible environments

Foreground activations are still debounced (700 ms) so ⌘-Tab flicker doesn't
thrash the richer foreground context, the app ignores its own activations
(opening the panel doesn't end the episode), and cached registrations are
re-announced if the server restarts.

### Client logging and beachball diagnostics

The Mac app uses Apple Unified Logging through the shared `RookKit` logger. The
subsystem is `com.rookery.Rook`; categories include `app`, `session`, `network`,
`environment`, `bridge`, `server`, and `performance`. Fast successful timings
are debug-level; operations that take at least 100 ms are warnings, and
operations that take at least 500 ms are errors. This keeps normal logs small
while making main-thread and Accessibility/Finder stalls easy to identify.

Open **Rook Log** from the app to view the last ten minutes of the client
subsystem log plus the managed server-log tail, followed by a live unified-log
stream. The viewer is an inspection aid; the authoritative client log is
Unified Logging, not a temporary file.

You can view the logs in **Console.app** by selecting the Mac, searching for
`subsystem:com.rookery.Rook`, and pressing **Start**. Terminal equivalents:

```zsh
log stream --style compact --predicate 'subsystem == "com.rookery.Rook"'
log show --last 10m --style compact --predicate 'subsystem == "com.rookery.Rook"'
sample Rook 10 -file ~/Desktop/rook-sample.txt
```

For a short diagnostic run with detailed polling and raw foreground context,
launch from the worktree with:

```zsh
ROOK_VERBOSE_LOGGING=1 ./scripts/run-rook.sh server mac
```

Verbose mode is opt-in; it includes window titles, document paths, and URLs, so
do not enable it for logs you plan to share without reviewing them.

Capture the timestamp of the beachball and collect the unified log plus a
`sample` while it is visible. In particular, search the `performance` and
`environment` categories for `elapsedMs`, `ax-`, `finder-`, or
`mac-bridge-route` entries immediately before the sample. The stall watchdog
also emits one `StallWatchdog` warning per episode, including a short client
instance ID and the last tracked operation; filter for it with:

```zsh
log show --last 1h --style compact \\
  --predicate 'category == "StallWatchdog"'
```

Each client process gets a short instance ID, so records from simultaneous Rook
clients can be compared without conflating their timelines.

### Tier 1 - window-title perception

App *identity* is free (NSWorkspace), but reading inside another app - its
focused **window title** - needs the macOS **Accessibility** permission. Grant
it from the **Context Bridge** card in the panel (or System Settings → Privacy
& Security → Accessibility). Once granted, the title is included in
registration metadata and in the live bridge context. Window titles are
surprisingly rich: Slack's is `#channel (Workspace) - Slack`, a browser's is
the tab title, most editors show the document name. Title changes *within* an
app (switching Slack channels) are picked up by a 2 s poll and pushed to the
bridge without re-registering.

> Unsigned/ad-hoc dev builds can lose the Accessibility grant on each rebuild
> because TCC keys on code identity. Re-grant after a rebuild, or sign the app
> with a stable identity.

### Tier 2 - the Mac bridge

The app runs a loopback HTTP server (default `http://127.0.0.1:8765`, override
with `defaults write com.rookery.Rook MacBridgePort <n>`) that
the agent's shell tool can `curl` to perceive and drive the Mac:

| Route | Body | Returns |
|-------|------|---------|
| `GET /context` | - | `{ frontmostApp, bundleId, windowTitle, environmentId, accessibilityTrusted }` |
| `GET /health` | - | `{ ok, service }` |
| `POST /applescript` | `{ "script": "..." }` | `{ ok, output }` |
| `POST /open-url` | `{ "url": "..." }` | `{ ok }` |

No server-side change was needed: Pi/Claude agents already have a shell tool,
so an app's skill bundle simply documents these endpoints and the agent calls
them. `POST /applescript` targeting another app triggers a one-time macOS
Automation consent prompt (declared via `NSAppleEventsUsageDescription`).
Centralizing these grants in one user-visible app is the point - Accessibility,
Automation, and Screen Recording are approved once here instead of being
attributed to the node server's subprocesses.

### Tier 4 - computer use (perception + control)

For driving apps the way a person does. Two grounding strategies share one set
of primitives:

| Route | Body | Returns | Gate |
|-------|------|---------|------|
| `GET /ax-elements` | - | `{ ok, elements: [{ id, role, label, x, y, width, height, centerX, centerY }] }` | Accessibility |
| `GET /screenshot` | - | `{ ok, png_base64, pixelWidth, pixelHeight, originX, originY, scale }` | Screen Recording |
| `POST /input` | `{ action, ... }` | `{ ok, output }` | **Computer Control toggle** + Accessibility |

`/input` actions (coordinates are global top-left screen space, matching
`/ax-elements` frames): `move`/`click`/`doubleClick` `{x,y}`, `type` `{text}`,
`key` `{key, modifiers?}` (e.g. `{"key":"return","modifiers":["cmd"]}`).

Two paths, by control strategy:

- **AX-driven control** (native apps, text-only models like DeepSeek V4 Pro):
  read `/ax-elements`, pick one by `id`, `POST /input {action:"click", x:centerX,
  y:centerY}`. No screenshot or vision model needed - the model reasons over the
  element list as text.
- **Pixel-vision control** (opaque apps with no useful AX tree, e.g. CapCut):
  `GET /screenshot`, send the image to a vision-grounding model (e.g. DeepSeek
  V4 Vision), map its chosen pixel back to screen coords via the returned
  `originX/originY/scale`, then `POST /input`. *Sending the screenshot into the
  model's context requires image content blocks in the ACP layer (the server
  protocol is currently text-only); that's the remaining server-side change for
  this path.*

**Safety.** `/input` is gated behind an explicit **Computer Control** toggle in
the panel, off by default and persisted (`EnableComputerControl`). Input
coordinates are clamped to the union of screen frames. The agent already has
shell access (so it could `osascript`/`cliclick` regardless), but routing
control through this one toggle gives a single, visible kill switch. Turn it off
when you're not actively supervising.

The server database can associate approved bundles with Mac environment ids;
focusing Slack offers matching capabilities that read `/context` to learn the
current channel and use `slack://` deep links + AppleScript through the bridge
to navigate and draft messages.

## Getting it running - exact steps

Prerequisites: Xcode, [xcodegen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`), and Node (for the Rook server).

Fast path from the repo root:

```zsh
./scripts/run-rook.sh mac
./scripts/run-rook.sh stop   # stop this checkout's server + launched app(s)
```

`run-rook.sh mac` selects the production-like profile from the main checkout or an isolated development profile from a Git worktree. It starts the selected server if needed, regenerates the Xcode project from `project.yml`, rebuilds incrementally, and launches the fresh app build. Worktree builds use a deterministic alternate port, isolated `ROOK_HOME`/SQLite state, and a distinct `Rook Dev (<worktree-slug>)` app identity so they can run beside production. The slug includes a short hash of the canonical worktree path, so same-named worktrees remain separate.

Manual steps:

```zsh
# 1. Start the Rook server (skip if it's already running)
cd <path-to-rookery>   # the repo root
npm run dev
# verify: curl http://127.0.0.1:7665/api/health  ->  {"ok":true,...}

# 2. Generate the Xcode project and build the app
cd clients/mac
xcodegen generate
xcodebuild -project Rook.xcodeproj \
  -scheme Rook -configuration Debug build

# 3. Launch it
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData \
  -path '*/Build/Products/Debug/Rook.app' -print -quit)
open "$APP_PATH"
```

Look for the **purple rook icon** in the menu bar. The app is a regular app
(`LSUIElement` is false) so it also shows a Dock tile and a main window. If
you don't see the menu bar icon, read the troubleshooting section below - on
a crowded menu bar this is expected, not a bug.

To kill and relaunch (e.g. after a rebuild):

```zsh
pkill -f Rook; sleep 1; open "$(find \
  ~/Library/Developer/Xcode/DerivedData \
  -path '*/Build/Products/Debug/Rook.app' -print -quit)"
```

The repo root (used by the panel's Start Server button) is derived from this
package's source location; override it with:

```zsh
defaults write com.rookery.Rook RookeryRepoRoot /path/to/rookery
```

Shared Rook config lives in `ROOK_HOME/config/` (`~/.rook/config/` for production and `~/.rook-<worktree-slug>/config/` for a worktree).

## Troubleshooting: the icon isn't in the menu bar

On notch Macs, macOS silently hides status items that don't fit - there is no
overflow indicator; they just vanish. Worse, each item's position is
*persisted* (distance from the right screen edge) in the app's defaults, so if
the app's first launch lands it in the hidden zone, it stays hidden on every
relaunch. Diagnose and fix:

```zsh
# Is a position stored, and where? (~870+ on a 1512pt display = hidden zone)
defaults read com.rookery.Rook "NSStatusItem Preferred Position Item-0"

# Fix: quit the app, then pin the item into the visible right-hand cluster
pkill -f Rook
defaults write com.rookery.Rook \
  "NSStatusItem Preferred Position Item-0" -float 400
open "$APP_PATH"
```

Once visible you can ⌘-drag the icon and macOS persists wherever you drop it.
Long-term, a menu bar manager (e.g. Ice: `brew install --cask
jordanbaird-ice`, or Bartender) avoids the overflow cull entirely.

**Window-mode escape hatch** - run the panel as a regular floating window
(works regardless of menu bar space; re-running `open` on the app brings the
window back after closing it):

```zsh
defaults write com.rookery.Rook ShowPanelWindow -bool true   # on
defaults write com.rookery.Rook ShowPanelWindow -bool false  # off
```

## Notes on the wire protocol

- The websocket carries pure ACP JSON-RPC frames; the app sends standard
  session methods and treats the JSON-RPC prompt response as end-of-turn.
- Existing sessions hydrate from the server-owned REST transcript when the
  runtime is already running; stopped sessions use ACP `session/load` replay.
- The app keeps its session socket open while a session is current, including
  while the panel is closed, and reconnects with the session-bound URL.
- Intentional socket teardowns (switching sessions) are silent; only genuine
  transport failures trigger the reconnect path, and a successful connection
  cancels any armed reconnect.
