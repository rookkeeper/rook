# Mac native client parity work — key challenges

## 1. Window sizing and clipping

**Problem:** The window initially showed at a fixed size that cut off content at the bottom. When switching between home/chat scenes, the window didn't resize to fit.

**Why it was hard:** SwiftUI's layout interacts with AppKit window sizing in surprising ways. `NSHostingView` content-size tracking can resolve to 0×0, and animated size changes between panel modes crashed the app inside `NSHostingView.updateWindowContentSizeExtremaIfNecessary`.

**What worked:**
- Content measurement via `GeometryReader` + hidden sizing baseline + `PreferenceKey`
- `contentMinSize`/`contentMaxSize` on the NSWindow
- Unanimated frame changes
- Shrink-wrap on initial open, grow-only after user resizes

## 2. Assistant markdown rendering mismatch

**Problem:** `MarkdownUI` rendered assistant text with its own typography — different font, size, and color from the user-typed text in the compose area. It felt visually disconnected.

**What worked:**
- Created a custom `Theme` (`rookAssistantMarkdownTheme`) matching the app's design tokens
- Set body text to `.callout` size (13pt), matching the compose text field
- Matched text color, background color, and bubble styling to user messages
- During streaming, render as plain `Text()` to avoid MarkdownUI re-parse cost

## 3. Blank thread during streaming

**Problem:** When the agent streamed long responses, the entire thread area went blank until the response completed.

**Root cause:** `MarkdownUI.Markdown(text)` re-parses the full markdown tree on every text chunk update. During fast streaming, this caused render failures or empty views.

**Fix:** While `streaming == true`, render as plain `Text(text).font(.callout)`. Only switch to `Markdown(text)` when `streaming` becomes `false`.

## 4. Auto-scroll refusing to pause

**Problem:** When the user scrolled up in the chat thread during streaming, new agent output immediately snapped back to the bottom.

**Why it was the hardest:** The root cause was that we could not find the backing `NSScrollView` for the SwiftUI `ScrollView`. We tried:
1. `view.enclosingScrollView` — returned nil
2. Walking superview hierarchy — returned nil
3. Retry with 0.1s delays — still nil after 1000+ attempts
4. Walking the full window view tree looking for NSScrollView instances — also returned nil
5. None of these approaches ever found the real scroll container

This appears to be because SwiftUI's `ScrollView` on macOS may use a private/internal scroll container that doesn't expose an `NSScrollView` in the public view hierarchy, or the representable view is isolated from that hierarchy.

**What finally worked:**
- **Window-level scroll-wheel event monitor** (`NSEvent.addLocalMonitorForEvents(matching: .scrollWheel)`) to detect actual user trackpad scroll input
- **SwiftUI geometry** for bottom detection: a `GeometryReader` sentinel at the bottom of the LazyVStack, monitored via `PreferenceKey`, compared against the scroll viewport height
- When user scrolls: if bottom marker is visible → resume auto-scroll; otherwise → pause auto-scroll
- Auto-scroll only resumes on: user scrolls back to bottom, or user sends next message

## 5. Tool argument stacking

**Problem:** As a tool call received streaming input, the args display showed all prior snapshots concatenated, e.g.:
```
{ "command" : "" }
{ "command" : "ls /" }
{ "command" : "ls /Users/johnberry" }
```
Instead of just the current state.

**Root cause:** ACP `tool_call_update` snapshots were being treated as deltas. The model was doing `tool.arguments += delta` when it should have been `tool.arguments = text`.

**Fix:** Added distinct `toolInputSnapshot` / `toolOutputSnapshot` event types distinct from `toolInputDelta` / `toolOutputDelta`. The snapshots set the value; deltas append.

## 6. Window architecture: menu bar popover → normal window

**Problem:** The app needed to change from a menu bar popover (`MenuBarExtra(.window)`) to a normal resizable `NSWindow`. This meant removing the pin/unpin companion window system entirely.

**What changed:**
- `RookApp.swift` — replaced `MenuBarExtra(.window)` content with dropdown menu buttons; `AppDelegate` creates a standard `NSWindow` on `applicationDidFinishLaunching`
- `RookMacModel.swift` — removed `windowIsPinned`, `panelWindow`, `panelWindowDelegate`, `openPanelWindow()`, `togglePinnedWindow()`, and the `PanelWindowDelegate` class (~70 lines removed)
- `RookView.swift` — removed the pin/unpin footer button

**Cmd-Tab / Dock issue:** After the switch, the app didn't appear in the Dock or Cmd-Tab switcher. Root cause: `LSUIElement = true` in `Info.plist` (correct for a background menu-bar-only app, but wrong for a normal window app). Changed to `false`.

## Debugging strategy

For the hardest problems (auto-scroll, window sizing), we used **file-based debug logging** (`/tmp/rook-scroll.log`) instead of `print()` because:
- SwiftUI menu bar apps don't reliably print to Console
- File logs are deterministic and can be inspected on-demand
- Timestamps make it easy to correlate log events with UI behavior

The logging was removed after confirming fixes, with this summary preserved.
