# Chat/session/socket refactor

## Scope

- [x] Extract ACP socket, session state, streaming state, and tool state from `RookMacModel`
- [ ] Preserve current Mac UI behavior while reducing state sprawl
- [ ] Keep iPhone chat/session behavior aligned with current behavior during the refactor
- [ ] Prefer boundaries that could later be shared with iPhone, without requiring shared extraction now

## Current responsibilities in `RookMacModel`

- [x] Own current session and session list state
- [x] Own socket connection state
- [x] Own reconnect behavior
- [x] Reduce socket events into blocks/state
- [x] Own streaming buffers/throttling
- [x] Own tool input/output accumulation
- [x] Own queued messages and replay behavior
- [x] Own run lifecycle state (`isRunning`, `lastStopReason`, etc.)

## Target component

- [x] `ChatSessionController`

## Proposed responsibilities

- [x] Own ACP socket lifecycle
- [x] Own session attach/reconnect logic
- [x] Own message queueing and replay
- [x] Own run state and streaming buffers
- [x] Expose high-level events/state to `RookMacModel`
- [ ] Keep controller interfaces shaped so the same concepts could later apply to iPhone

## Extraction steps

- [x] Add a Mac manual verification checklist for session start/resume/chat/reconnect/cancel behavior before refactoring
- [x] Add an iPhone regression checklist for session/chat/offers/environment-list behavior before refactoring
- [x] Move socket setup and connection callbacks into `ChatSessionController`
- [x] Move socket event reduction out of `RookMacModel`
- [x] Move reconnect scheduling logic out of `RookMacModel`
- [x] Move streaming/tool/replay buffers out of `RookMacModel`
- [x] Keep view-facing published state mirrored through `RookMacModel` initially
- [ ] Compare extracted Mac behavior against `RookModel` to avoid accidental divergence in shared chat/session semantics

## Risks

- [ ] This is the highest-risk extraction because event reduction is stateful
- [ ] Avoid regressions in run cancellation, reconnection, and replay behavior
- [ ] Avoid drifting farther from iPhone behavior in areas that are conceptually shared
