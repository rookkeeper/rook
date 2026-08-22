# Mac warm-session navigation stall

## User requirement

Warm, already-loaded sessions should enter chat immediately, and leaving a live session with Back should return to the home/session screen immediately. Do not spend this change trying to make cold ACP `session/load` replay faster. Do not interrupt the production Rook server or Mac client; implementation and validation must use a worktree.

## Observed data

- GitHub issue #167 tracks the return-to-home stall.
- Current Mac logs show warm resume using `session handle load reused` in roughly 74 ms, while `mac-load-sessions` is roughly 100 ms. This does not support a warm network/session-load explanation.
- The same process records multi-second main-thread watchdog stalls, and a sample points at SwiftUI/AppKit layout and accessibility graph work.
- Cold `acp-session-load` is independently slow for some sessions; that is explicitly out of scope.
- Commit `0b1c247` changed the home session list from a finite-height ScrollView to a GeometryReader/full-height layout shortly before this report. The current view also renders a hidden measurement copy of the active content and resizes the AppKit window on mode/measurement changes.

## Candidate changes

1. Restore a finite home session-list layout so the 204-session list does not participate in an unbounded GeometryReader/layout pass during home transitions.
2. Do not construct the hidden measurement copy for fixed-height chat and environment panels; it duplicates the expensive chat transcript tree during warm entry and exit.
3. Mark the remaining measurement tree as accessibility-hidden, since it exists only for sizing.
4. Make the Back transition publish `.home` before starting best-effort `unviewSession` cleanup. Cleanup must remain asynchronous and must not gate the visual transition.

## Decision

Proceed with the four targeted Mac-client changes above. Add a focused test for the measurement policy, run Mac tests and build in an isolated worktree, and inspect the diff for regressions. No server, RookKit cold-load, or production process changes are planned.

## Open questions for implementation

- Confirm that the finite home list preserves scrolling and the existing minimum panel sizing.
- Confirm that chat and environments already use a fixed 420-point panel height, so omitting their measurement tree does not change sizing.
- Reassess timings after the worktree build; if a warm stall remains, use a worktree reproduction and sample rather than changing cold-load behavior.
