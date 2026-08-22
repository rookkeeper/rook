# Mac warm-session navigation stall

## Context

Make warm Mac session entry and Back-to-home navigation visually immediate while keeping the home session list dynamically resizable. The list should scroll only when needed and should not display a scrollbar. Cold ACP `session/load` replay latency is intentionally out of scope.

## Decision details

- Replace the rejected fixed-height implementation with a single-visible-tree layout.
- Use a flexible, lazy session list that receives the current window height and hides scroll indicators without disabling scrolling.
- Remove duplicate hidden rendering of the active content; measure only visible or lightweight intrinsic-sizing content where necessary.
- Preserve user window enlargement. Sizing may enforce a minimum or grow to fit content, but must not shrink or cap an enlarged window.
- Publish home navigation before asynchronous best-effort `unviewSession` cleanup.
- Do not stop or modify the production server or production Mac client.

## Work checklist

- [x] Implement the replacement dynamic layout in an isolated worktree.
- [x] Add or update focused Mac regression tests for scrolling, sizing, and navigation policy.
- [x] Run Mac tests and build without launching or stopping the production profile.
- [x] Review compatibility surfaces and documentation impact; no compatibility surfaces or product/architecture documentation changes apply.
- [x] Complete final validation and record outcomes.
