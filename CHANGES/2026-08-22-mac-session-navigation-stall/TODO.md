# Mac warm-session navigation stall

## Context

Make warm Mac session entry and Back-to-home navigation visually immediate. Cold ACP `session/load` replay latency is real but intentionally out of scope.

## Decision details

- Change only the Mac client navigation/layout path.
- Restore a finite-height home session list, avoiding the recent unbounded GeometryReader layout during transitions.
- Avoid duplicate hidden measurement of fixed-height chat/environment content and exclude remaining measurement content from Accessibility.
- Set the home panel mode before launching best-effort asynchronous `unviewSession` cleanup.
- Do not stop or modify the production server or production Mac client.

## Work checklist

- [ ] Implement the targeted RookView and goHome changes in an isolated worktree.
- [ ] Add or update focused Mac regression tests for the measurement/navigation policy.
- [ ] Run Mac tests and build without launching or stopping the production profile.
- [ ] Review compatibility surfaces and documentation impact.
- [ ] Complete final validation and record outcomes.
