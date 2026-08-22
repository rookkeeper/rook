# Mac warm-session navigation stall

## User requirement

Warm, already-loaded sessions should enter chat immediately, and leaving a live session with Back should return to the home/session screen immediately. The session list must remain dynamically resizable: it should fill the available window, scroll only when content exceeds the viewport, and hide the scrollbar. Cold ACP `session/load` replay latency is out of scope. Production Rook resources must not be interrupted; implementation and validation use an isolated worktree.

## Observed data

- GitHub issue #167 tracks the return-to-home stall.
- Current Mac logs show warm resume using `session handle load reused` in roughly 74 ms, while `mac-load-sessions` is roughly 100 ms. This does not support a warm network/session-load explanation.
- The same process records multi-second main-thread watchdog stalls, and a sample points at SwiftUI/AppKit layout and accessibility graph work.
- Cold `acp-session-load` is independently slow for some sessions; that is explicitly out of scope.
- Commit `0b1c247` changed the home session list from a finite-height ScrollView to a GeometryReader/full-height layout shortly before this report. The current view also renders a hidden measurement copy of the active content and resizes the AppKit window on mode/measurement changes.
- The first implementation attempt restored hard-coded finite sizing. The developer rejected that because it prevents the home UI from correctly painting when the user enlarges the window. That attempt was stopped, deleted, and will not be reused.

## Replacement approach

1. Keep one visible content tree. Remove the hidden duplicate measurement tree that eagerly constructs the entire home/chat hierarchy.
2. Let the visible home content receive the current window height and keep the session list in a flexible scrolling viewport. Use `LazyVStack` and `.scrollIndicators(.hidden)`; do not impose a fixed session-list height.
3. Use visible-content measurement only for panels that genuinely need intrinsic sizing, and ensure the measurement reports a minimum/desired size without forcing the user window back to that size.
4. Preserve user enlargement. Window sizing may grow a window when content cannot fit its minimum, but must not shrink or cap a window that the user has enlarged.
5. Keep Back navigation state-first and cleanup asynchronous.

## Decision

Proceed with the replacement approach above. The implementation must preserve dynamic window resizing and hidden-but-functional scrolling; fixed panel/list heights are a non-goal. Add focused tests for the sizing/measurement policy, run Mac tests and build in an isolated worktree, and inspect the result before any user-facing launch.

## Open questions for implementation

- Confirm which panels require intrinsic measurement after the duplicate tree is removed.
- Confirm the visible home list gets a bounded viewport from the window without an unbounded GeometryReader feedback loop.
- Confirm scrollbar hiding does not disable wheel, trackpad, keyboard, or programmatic scrolling.
- Reassess warm navigation timings with a worktree build; do not use cold-load timings as an acceptance gate.
