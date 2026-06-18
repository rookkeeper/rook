# Mac chat scroll debugging notes

## Problem

In the macOS chat view, auto-scroll was supposed to pause when the user manually scrolled up in the thread.

In practice, it kept snapping back to the bottom while the agent was streaming new thinking/message updates.

## Root cause

The original implementation tried to detect manual scrolling by attaching an AppKit observer to the SwiftUI chat `ScrollView`'s underlying `NSScrollView`.

That assumption was wrong in this layout.

During debugging, the observer repeatedly failed to locate the real scroll view backing the chat thread, so:

- user trackpad scrolling was never detected reliably
- `pauseAutoScroll()` was never called
- `scrollTick` updates from new agent output kept calling `scrollTo("chat-bottom")`
- the UI appeared to "fight" the user and snap back to the bottom

## Solution

The fix was to avoid depending on private/fragile SwiftUI-to-AppKit scroll-view discovery.

Instead, the chat now uses two simpler signals:

1. **Window-level scroll-wheel monitoring**
   - detect actual user scroll-wheel / trackpad scroll input in the chat window
2. **SwiftUI geometry for bottom detection**
   - track whether the thread bottom marker is visible inside the chat viewport

When the user scrolls:

- if the bottom marker is visible, auto-scroll stays/resumes on
- if the bottom marker is no longer visible, auto-scroll pauses

Auto-scroll only resumes when:

- the user scrolls back to the bottom, or
- the user sends a new message

## Logging strategy used

To debug this reliably, temporary logs were written to `/tmp/rook-scroll.log` instead of relying on `print`/Console visibility.

The temporary logs captured:

- attempted scroll-view attachment
- user scroll-wheel events
- bottom-marker visibility changes
- pause/resume calls
- automatic scroll-to-bottom attempts

Those logs showed the key failure:

- auto-scroll events were firing continuously
- manual-scroll detection was not firing at all
- the old observer path was repeatedly failing to find the real scroll view

After confirming the cause and validating the new approach, the extra logs were removed.
