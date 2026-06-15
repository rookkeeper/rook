# React Native client architecture notes

## Purpose
Briefly outline the cleanup path for the new React Native client so we do not keep accreting product logic inside a few large components.

## Current problem
The current RN client proves the direction, but too much behavior still lives in:

- `App.tsx`
- `ChatPanel.tsx`
- ad hoc local component state

That makes it harder to:

- keep parity with the old web client
- test queue / send-now / replay behavior
- swap presentation for desktop vs mobile
- reason about ACP state transitions

## Desired structure
## 1. Session/controller layer
Move chat/session behavior into a controller-style hook or state module, e.g.:

- `useChatSession()`
- or `chatSessionState.ts`

Responsibilities:
- ACP event reduction
- queue state
- send-now state
- permission request state
- plan / usage / mode / config state
- replay handling
- steering / cancel semantics

This layer should be highly testable without depending on visual components.

## 2. Presentational components
Keep UI components dumb wherever possible:

- `MessageThread`
- `QueueDisplay`
- `ComposeBox`
- `StatusLine`
- `PlanDisplay`
- `PermissionPrompt`
- `BlockModal`

Responsibilities:
- render props
- emit user intents through callbacks
- hold only small local UI state when truly view-specific

## 3. Block rendering layer
Treat message/tool/thinking/error rendering as its own layer:

- `BlockRenderer`
- `MessageBlocks`
- `Markdown`

Responsibilities:
- render one block consistently
- support fullscreen/detail rendering by reusing the same block components
- hide web/mobile rendering differences behind one semantic API

## 4. Platform-adaptive rendering
Keep one client codebase, but allow targeted platform adaptation where needed.

Examples:
- markdown renderer may differ on web vs native
- selection / hover affordances may differ on web vs touch devices
- long model lists may use different controls on desktop vs mobile

The goal is shared semantics, not identical low-level rendering.

## 5. Shared theme + layout primitives
Centralize design tokens and breakpoint logic:

- `theme.ts`
- `useBreakpoint()`

Later likely:
- reusable surface/card primitives
- reusable header row / pill / chip primitives

## Testing strategy
Focus tests on stable behavior, not brittle styling:

- Enter submits
- busy submit queues
- queue edit persists
- send-now does not optimistically inject a user block
- queued item remains disabled while sending-now is pending
- replay restores user + assistant content
- mode/config option filtering avoids duplicate mode controls
- block click opens detail view

Avoid snapshotting large UI trees or testing exact spacing values.

## Migration guidance
When porting features from `agent-server-client`, prefer:

1. porting the proven state logic first
2. then adapting the rendering to RN
3. only then polishing the visuals

That keeps the behavior trustworthy while still moving toward the shared React Native approach needed for iPhone/Android.
