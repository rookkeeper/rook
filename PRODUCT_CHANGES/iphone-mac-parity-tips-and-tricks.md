
# ACP client parity audit for iPhone + Mac

## Scope / commit swath
The main "make the client truly ACP-native" stretch looks like this:

- `cfbb103` — initial ACP boundary migration
- `2e1a445` — ACP-native client reducer
- `b14487c` / `9b1e5cb` — remove `SessionEvent` translation layers
- `ae99c6f` — `session/cancel`
- `2c10246` — richer ACP browser support
- `80e1242` / `5fa2619` — tool-call normalization cleanup
- `96c7dd3` — queue controls + stop + send-now steering extension
- `ca1fc9b` — copy parity work into the new `client/`
- `e7a2ede` / `51733cc` — move native clients onto shared `RookKit`

## ACP overview cross-check
From the ACP v1 overview, the pieces that matter most to this client/UI parity pass were:

- `session/prompt`
- `session/update`
- `session/request_permission`
- `session/cancel`
- `session/set_mode`
- `session/set_config_option`
- proper handling of plans, tool calls, usage/context, stop reasons, and ACP extension points (`_meta`, `_...` methods)

Notes:
- `initialize`, `authenticate`, `session/new`, and `session/load` mostly live on the server↔agent side here, not in the native UI layer.
- `fs/*`, `terminal/*`, and slash-command support are not part of this client-parity swath, and are not surfaced in `RookKit` today.

## Enumerated changes + breadcrumbs

### 1. The client became ACP-native instead of translating through `SessionEvent`
- **What changed:** the web client started reducing directly from ACP-shaped events.
- **Commit(s):** `2e1a445`, `b14487c`, `9b1e5cb`
- **Breadcrumbs:** `client/src/lib/remoteAgent.ts`, `client/src/lib/acpClientTypes.ts`, `client/src/session/applyAcpEvent.ts`, `client/src/session/chatSessionState.ts`
- **Native status:** **partial**. `RookKit/Sources/RookKit/Net/AcpSocket.swift` is the shared native equivalent, but it still handles a narrower event set than the web client.

### 2. Permission requests (`session/request_permission`) got first-class UI support
- **What changed:** tool permission prompts became real client state + UI, not hidden protocol traffic.
- **Commit(s):** `2c10246`
- **Breadcrumbs:** `client/src/lib/remoteAgent.ts`, `client/src/components/PermissionPrompt.tsx`, `client/src/session/useChatSession.ts`, `server/src/server/routes/websocketRoute.ts`
- **Native status:** **missing**. `RookKit/.../AcpSocket.swift` does not handle `session/request_permission`, and neither native app has a permission-prompt model/view.

### 3. Plan updates became a visible chat feature
- **What changed:** ACP `plan` updates render as their own block.
- **Commit(s):** `2c10246` (with groundwork in earlier ACP-native reducer work)
- **Breadcrumbs:** `client/src/components/PlanDisplay.tsx`, `client/src/session/chatSessionState.ts`
- **Native status:** **present**. See `RookKit/Sources/RookKit/Models/ChatBlocks.swift`, `RookKit/Sources/RookKit/Design/ChatBlockViews.swift`, plus both native models.

### 4. Usage/context window updates became visible, including cost
- **What changed:** ACP `usage_update` drives UI status for context usage and optional cost.
- **Commit(s):** `2c10246`
- **Breadcrumbs:** `client/src/lib/remoteAgent.ts`, `client/src/session/useChatSession.ts`, `client/src/components/StatusLine.tsx`
- **Native status:** **partial**. Mac/iPhone show context usage counts, but `RookKit/.../AcpSocket.swift` drops `cost`, and native models store only `(used, size)`.

### 5. Session mode support (`session/set_mode`, `current_mode_update`) was wired through
- **What changed:** the client can switch ACP modes and track mode updates.
- **Commit(s):** `2c10246`
- **Breadcrumbs:** `client/src/lib/remoteAgent.ts`, `client/src/components/AcpSettingsPanel.tsx`, `server/src/server/routes/websocketRoute.ts`
- **Native status:** **missing**. `RookKit/.../AcpSocket.swift` explicitly ignores `current_mode_update`; no shared native UI exists for mode controls.

### 6. Session config-option support (`session/set_config_option`, `config_option_update`) was wired through
- **What changed:** ACP config options became selectable client controls.
- **Commit(s):** `2c10246`
- **Breadcrumbs:** `client/src/lib/remoteAgent.ts`, `client/src/components/AcpSettingsPanel.tsx`, `server/src/server/routes/websocketRoute.ts`
- **Native status:** **missing**. `RookKit/.../AcpSocket.swift` ignores `config_option_update`; no native config control UI yet.

### 7. Mid-turn stop became real ACP cancel (`session/cancel`)
- **What changed:** stop no longer meant tearing down the session; it became proper ACP cancel.
- **Commit(s):** `ae99c6f`
- **Breadcrumbs:** `server/src/server/agents/BaseAgent.ts`, `server/src/server/routes/websocketRoute.ts`, `RookKit/Sources/RookKit/Net/AcpSocket.swift`, native model `stopAgent()` methods
- **Native status:** **present** in both apps.

### 8. Stop reason / cancellation semantics were cleaned up in the UI
- **What changed:** the client started treating `cancelled` as a clean stopped state instead of a generic failure.
- **Commit(s):** `ae99c6f`, `2c10246`, `96c7dd3`
- **Breadcrumbs:** `client/src/lib/remoteAgent.ts`, `client/src/session/chatSessionState.ts`, `client/src/components/ChatPanel.tsx`
- **Native status:** **partial**. Native models receive `runCompleted(stopReason:)`, but they do not really surface stop reasons as first-class UI state the way the web client does.

### 9. Tool-call parsing was normalized around real ACP traces
- **What changed:** the client learned to tolerate provider differences around tool raw input/output, including empty `{}` cases.
- **Commit(s):** `80e1242`, `5fa2619`
- **Breadcrumbs:** `client/src/lib/remoteAgent.ts`, `client/src/session/chatSessionState.ts`, `client/src/components/MessageBlocks.tsx`
- **Native status:** **partial**. `RookKit/.../AcpSocket.swift` parses basic tool calls, but not the fuller normalization logic the web client has.

### 10. Queue UX became part of the protocol story: edit, delete, and send-now steering
- **What changed:** queued messages stopped being just a passive FIFO list. They became editable, deletable, and send-now capable.
- **Commit(s):** `96c7dd3`
- **Breadcrumbs:** `client/src/session/useChatSession.ts`, `client/src/components/QueueDisplay.tsx`, `client/src/components/ComposeBox.tsx`, `server/src/server/routes/websocketRoute.ts`, `server/src/server/agents/BaseAgent.ts`
- **Native status:** **partial**. Both native apps have queue + delete, but not queue edit or queue send-now.

### 11. Rookery added an ACP-sanctioned custom extension for steering prompts
- **What changed:** a queued message can be promoted into an in-flight steering message via custom method `_rookery/steering_prompt`.
- **Commit(s):** `96c7dd3` (plus follow-up docs in `PRODUCT/agent-client-protocol.md`)
- **Breadcrumbs:** `PRODUCT/agent-client-protocol.md`, `client/src/lib/remoteAgent.ts`, `server/src/server/routes/websocketRoute.ts`, `server/src/server/realtime/SessionRoom.ts`, `server/src/server/agents/BaseAgent.ts`, `server/src/server/agents/PiAgent.ts`
- **How it works:** client intent stays generic (`sendSteeringMessage`); runtime subclasses own the provider-specific implementation. `PiAgent` uses a real provider extension; other ACP runtimes use the safe fallback.
- **Native status:** **missing**. `RookKit` has no steering-message API yet.

### 12. The new `client/` package inherited this work; native clients inherited only part of it
- **What changed:** `ca1fc9b` copied the ACP-parity work into the standalone `client/`, then the native apps consolidated on `RookKit`.
- **Commit(s):** `ca1fc9b`, `e7a2ede`, `51733cc`
- **Breadcrumbs:** `client/src/**`, `RookKit/Sources/RookKit/**`, `rook-mac-app/Sources/Models/RookMacModel.swift`, `rook-iphone-app/Sources/RookModel.swift`
- **Meaning:** the next parity pass should mostly be a **shared `RookKit` pass**, then light model/view work in both native apps.

## Current native parity summary

### Already basically there
- `session/prompt`
- `session/cancel`
- `session/update` for text/thinking/tool/plan
- queueing (basic)
- environment offers/events

### Partial in native
- stop-reason semantics
- usage updates (context yes, cost no)
- tool raw input/output normalization
- queue UX (delete only; no edit/send-now)

### Missing in native
- `session/request_permission`
- `session/set_mode`
- `current_mode_update`
- `session/set_config_option`
- `config_option_update`
- `_rookery/steering_prompt`

## Best places to patch
1. **Shared transport/parser:** `RookKit/Sources/RookKit/Net/AcpSocket.swift`
2. **Shared event/model surface:** `RookKit/Sources/RookKit/Models/ChatBlocks.swift`
3. **Shared chat rendering/components:** `RookKit/Sources/RookKit/Design/*`
4. **Mac state + UI glue:** `rook-mac-app/Sources/Models/RookMacModel.swift`, `.../Views/ChatView.swift`
5. **iPhone state + UI glue:** `rook-iphone-app/Sources/RookModel.swift`, `.../Views/ChatScreen.swift`

## Short recommendation
If the goal is "make iPhone and Mac app ACP-compliant in the same way the web client became ACP-compliant," the highest-leverage order is:

1. bring `RookKit/AcpSocket.swift` up to web parity for permission/mode/config/usage/tool normalization
2. add shared native state/types for permission prompts, modes, config options, steering
3. add shared/native queue edit + send-now controls
4. then do a final ACP overview checklist pass against all three clients


# NOTE
c88e47a8789cccc317f9a0ed2e7fa7f9923cbcdb is the last commit where the old "client" directory existed. If you want quick reference to it then check it out into /tmp/old_client so that you can see the patterns easily w/o having to refer to git too much. Make sure not to confuse the old code with the new.
