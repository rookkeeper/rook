# Convert web client to React Native + prepare iPhone client

## Summary
This document updates the migration plan for the new `client/` package.

The plan has narrowed in an important way:

- we are **not** trying to convert every Rookery client surface to React Native right now
- we **are** trying to make the new root `client/` the shared UI foundation for:
  - the local **web client**
  - the soon-to-be-created **iPhone client**
- the iPhone client is expected to use **Expo**
- we want to keep this intermediate state for a while, validate it, and only then decide whether broader React Native adoption makes sense elsewhere
- once the new implementation is fully validated, we want to **remove the old client implementation** in `agent-server-client/src/client`

So this is no longer "convert all clients to React Native."
It is now:

1. make the new `client/` truly suitable for **web + iPhone**
2. extract a **shared headless client core** for ACP/session behavior
3. reach feature and test maturity
4. delete the old web client once we trust the new one

## Current assessment
The new `client/` successfully proves the direction, but it is still in an intermediate state.

### What is good already
- root-level `client/` exists
- React Native style/component direction is established
- the new UI is already running as the web client
- major app flows are present

### What is not good enough yet
- the implementation is not yet truly **React Native-native**; some web-only rendering still leaks through
- protocol/types/session logic is still duplicated instead of living in a shared core
- the new implementation has lower test maturity than the old one
- some large files are accumulating too much logic
- the migration plan still talks too much about broad repo/platform restructuring and not enough about the immediate stabilization work

## Updated scope
## In scope now
- make `client/` the shared UI base for **web and iPhone**
- use **Expo** for the future iPhone app
- keep web working at `localhost:3000`
- extract a root `shared/` package for client/server shared contracts and headless ACP/session logic where appropriate
- reach parity with the old web client for the behaviors we still care about
- remove `agent-server-client/src/client` once parity + soak testing are complete

## Explicitly out of scope for now
- converting Chrome, Obsidian, menu bar, or every other surface to React Native
- converting Android right now
- re-implementing the old `parentMessageTool`
- supporting pre-ACP "session messages" compatibility paths
- redesigning environment offer semantics
- redesigning the environment manager
- folding the Mac bridge/runtime into React Native
- broader environment bridge redesign beyond what is already described in product docs

## Product-alignment notes
### Environment bridge direction
We do **not** want to preserve the old `parentMessageTool` path.
The expected replacement direction is the narrower environment interaction model described in:

- `PRODUCT/narrow-skills-environment-bridge.md`

That means the React Native migration should avoid introducing new dependencies on the old parent-message mechanism.

### Protocol compatibility direction
We **do** want strong ACP compatibility in the new implementation.

Specifically:
- support ACP behavior as fully as practical
- preserve support for the Rookery extension method `_rookery/steering_prompt`
- do not spend time on legacy pre-ACP compatibility layers we no longer care about

## Core architectural principle
Separate these concerns clearly:

- **client/** = shared UI for web + iPhone
- **shared/** = shared protocol types, DTOs, parsing helpers, headless ACP/session logic
- **agent-server-client/src/server/** = existing backend for now

This plan intentionally keeps the repo move modest for the moment. We do **not** need to finish the entire `server/`, `extensions/`, `environment-repository/` split before stabilizing the client.

## Desired near-term architecture

```text
/
  client/
  shared/
  agent-server-client/
    src/server/
```

### `client/`
Responsibilities:
- React Native UI
- react-native-web target for the local/browser client
- future Expo/iPhone UI surface
- presentation components
- platform-adaptive view code
- thin platform adapters only where necessary

### `shared/`
Responsibilities:
- ACP / JSON-RPC contracts
- environment DTOs
- agent/session DTOs
- shared ACP parsing helpers
- shared remote-session / event normalization logic
- shared chat-session state logic where it can be kept UI-agnostic

## Main workstreams
## Workstream 1 - make the new client actually React Native-native
Right now the new client is still partly "React Native Web styled web code."
We need to move it closer to a truly shared web+iPhone base.

### Goals
- isolate or remove web-only UI assumptions
- make native rendering a first-class target
- keep one semantic component model even where web/native rendering differs

### Roadmap
1. **Audit platform leaks**
   - raw DOM tags in the markdown path
   - raw `<select>` controls in chat settings
   - `window`/`document` assumptions in reusable logic
   - web-only modal or selection assumptions
2. **Introduce platform-adaptive rendering seams**
   - markdown renderer abstraction
   - picker/select abstraction
   - timer/navigation/location abstractions only where needed
3. **Make the shared UI semantically RN-first**
   - prefer React Native primitives/interfaces
   - keep web-specific behavior behind adapters
4. **Prepare for Expo**
   - ensure the code organization can be hosted by an Expo app without major surgery

### Important note
The goal is **not** to force identical low-level rendering on every platform.
The goal is shared semantics and shared product behavior across web and iPhone.

## Workstream 2 - create `shared/` and remove duplicated client/server logic
The old and new clients currently duplicate too much ACP/session/types code.
That is now worth fixing.

### Goals
- reduce drift between implementations
- establish a trustworthy shared core before deleting the old client
- make the future iPhone client cheaper to build

### Initial extraction targets
- ACP / JSON-RPC types
- environment DTOs
- agent/session DTOs
- remote agent message parsing helpers
- ACP event normalization
- session/controller state logic if it can be kept headless

### Non-goals for `shared/`
Do **not** put these in `shared/` prematurely:
- React components
- React hooks that are tightly UI-bound
- Fastify-specific code
- browser-only helpers
- styling/theme code

## Workstream 3 - preserve the right old-client capabilities
We do not want blanket parity with every historical behavior.
We want selective parity with the right current product direction.

### Preserve
- strong ACP compatibility
- `_rookery/steering_prompt`
- queueing / send-now / stop behavior
- plan display
- permission prompts
- environment offer handling
- session selection / resume behavior
- tool call rendering
- mode/config controls when reported by ACP

### Do not preserve
- `parentMessageTool`
- legacy pre-ACP session-message compatibility
- old compatibility code that no longer aligns with the current direction

## Workstream 4 - raise test maturity before deleting the old client
The new client should not replace the old one permanently until its behavior is much more thoroughly tested.

### Testing priorities
Focus on behavior, not snapshots:
- Enter submits
- Shift+Enter inserts newline
- busy submit queues
- queue edit/save/cancel works
- send-now does not optimistically inject a fake user message
- send-now disabled/pending behavior is correct
- replay/resume behavior works
- cancellation behavior is correct
- mode/config behavior is correct
- ACP tool input/output rendering is correct
- permission prompts work
- environment offer flows work
- block detail modal works
- RN-adaptive rendering seams behave correctly on web

### Acceptance bar before deleting old client
- core session/controller logic has direct tests
- remote ACP/websocket behavior has comprehensive tests
- major UI behaviors have focused component tests
- parity-critical regressions are easy to catch without manual inspection

## Workstream 5 - split oversized files as part of stabilization
Some files are already too large and should be split as we touch them.

### High-priority split targets
- `client/src/components/ChatPanel.tsx`
- `client/src/lib/remoteAgent.ts`
- `client/src/components/MessageBlocks.tsx`
- possibly `client/src/App.tsx`

### Preferred direction
#### Chat/session behavior
Move stateful session behavior into a controller-style layer, as outlined in:
- `PRODUCT_CHANGES/react_native_client_architecture_notes.md`

Likely targets:
- `useChatSession()`
- or a `chatSessionState.ts` module plus a thin hook

#### Rendering
Keep presentational components smaller and dumber:
- `MessageThread`
- `QueueDisplay`
- `ComposeBox`
- `StatusLine`
- `PlanDisplay`
- `PermissionPrompt`
- `BlockModal`

#### Block rendering
Split block rendering by responsibility where it helps:
- markdown abstraction
- block renderer
- tool/thinking/message block views

## Migration phases
## Phase 1 - stabilize the new web client as the primary implementation
### Goal
Make `client/` trustworthy enough that we can treat it as the real web client, not just a prototype.

### Checklist
- [ ] audit and document every web-only leak in `client/`
- [ ] introduce platform-adaptive seams for markdown, pickers, and other web/native differences
- [ ] extract shared contracts/helpers into root `shared/`
- [ ] move chat/session behavior out of giant UI components where practical
- [ ] improve ACP compatibility coverage
- [ ] raise test maturity to clearly exceed "prototype" status
- [ ] confirm no dependency remains on `parentMessageTool`
- [ ] preserve `_rookery/steering_prompt`
- [ ] preserve current environment-offer behavior
- [ ] preserve session resume / queue / stop / permission flows

## Phase 2 - run in this intermediate state and soak test
### Goal
Stay here for a while and validate the direction before broadening the migration.

### Checklist
- [ ] use the new `client/` as the day-to-day web client
- [ ] watch for parity gaps vs the old client
- [ ] fix regressions found in normal use
- [ ] confirm the extracted `shared/` layer is stable enough for reuse by iPhone

This phase is intentionally not rushed.

## Phase 3 - remove the old web client implementation
### Goal
Delete `agent-server-client/src/client` once confidence is high.

### Deletion criteria
- [ ] new client is the default and stable in normal use
- [ ] test coverage for critical behaviors is strong
- [ ] no important ACP behaviors remain only in the old client
- [ ] no intended product behaviors still depend on old client code
- [ ] developer workflow no longer depends on the old client implementation

## Phase 4 - create the iPhone client with Expo on top of the same shared UI/core
### Goal
Use the stabilized shared client architecture for iPhone.

### Checklist
- [ ] create Expo-hosted iPhone shell
- [ ] reuse `client/` UI + shared core as much as practical
- [ ] fill platform-adaptive seams intentionally rather than ad hoc
- [ ] validate major chat/session flows on-device

## What we are intentionally not deciding yet
This intermediate plan leaves several questions open on purpose:
- whether Android should join this architecture soon or much later
- whether Chrome/Obsidian should ever share this RN UI directly
- when to split `agent-server-client/src/server` into a root `server/`
- how broad the final repo reorganization should be
- how the future narrow environment bridge will be implemented in detail

## Current implementation status
### Completed recently
- root `shared/` now exists with shared ACP / environment / agent contracts
- `client/src/lib/acp.ts`, `client/src/lib/environment.ts`, and `client/src/lib/agent.ts` now re-export from root `shared/`
- `client/src/components/ChatPanel.tsx` no longer owns the full inlined chat-session reducer/state logic
- extracted `client/src/session/chatSessionState.ts` now owns chat session state types, reducer logic, and core block/queue state transitions
- extracted `client/src/session/applyAcpEvent.ts` now owns ACP-event-to-session-action mapping and environment event parsing
- extracted `client/src/session/useChatSession.ts` so the remaining remote-agent/session orchestration now lives in a controller-style hook instead of directly in `ChatPanel.tsx`
- extracted `client/src/components/controls/OptionPicker.tsx` so ACP settings no longer hardcode raw `<select>` usage inside `ChatPanel.tsx`
- extracted `client/src/components/AcpSettingsPanel.tsx` so ACP settings UI no longer lives inline inside `ChatPanel.tsx`
- extracted markdown rendering into `client/src/components/markdown/MarkdownRendererWeb.tsx` and `client/src/components/markdown/MarkdownRendererNative.tsx`, with `client/src/components/Markdown.tsx` acting as the platform seam
- split `client/src/components/MessageBlocks.tsx` into a `client/src/components/blocks/` layer with shared block styles and per-block components, leaving `MessageBlocks.tsx` as a thin export barrel
- duplicated contracts under `agent-server-client/src/shared/**` are intentionally being deferred until the old-client cleanup phase, so we do not destabilize the backend build too early

### Immediate next work
- parity review is now done and documented below
- move into the soak phase intentionally rather than continuing open-ended refactors
- collect parity issues during soak
- the next natural stop is deciding whether the old client can be deleted

## ACP parity review findings
Both `client/src/lib/remoteAgent.ts` and `agent-server-client/src/client/remoteAgent.ts` were compared side by side for the behaviors we still care about.

### Confirmed at parity ✅
- standard ACP session updates: `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `usage_update`, `current_mode_update`, `config_option_update`
- permission request handling via `session/request_permission`
- `_rookery_modes_state` parsing
- `_rookery_environment_event` forwarding
- `_rookery_status_changed` forwarding
- `_rookery_run_failed` forwarding
- `_rookery_connection_error` forwarding
- `_rookery_assistant_message_completed` → `acp_finalize_blocks`
- `_rookery/steering_prompt` as the send-now mechanism
- JSON-RPC success/failure/notification routing
- tool rawInput / rawOutput extraction (both `_meta.rookery` and direct payloads)
- websocket connection lifecycle

### Known intentional differences 🟡
- **Legacy tool delta compatibility** — the old client handled `_rookery_tool_input_delta`, `_rookery_tool_call_ready`, and `_rookery_tool_output_delta` as compatibility shims. The new client does **not** include these. This is intentional: they pre-dated ACP-native tool lifecycle delivery.
- **Send-now optimistic user message** — the old `sendSteeringMessage` emitted an optimistic `acp_user_message` event before the socket IO. The new client does **not** do this. This is intentional per the narrower steering-prompt direction.
- **Cancelled run handling** — the old client treated cancelled prompt responses as clean completions (`acp_run_completed` with `stopReason: "cancelled"`). The new client treats them as `acp_run_failed` with `"Run cancelled"`. This means clicking Stop in the UI will show an error block in the new client vs a "Stopped" status in the old client. This is deliberate and arguably clearer UX, but worth noting.
- **`parentMessageTool`** — intentionally not carried forward into the new client. The replacement direction is the narrow environment bridge described in `PRODUCT/narrow-skills-environment-bridge.md`.
- **Replay events** — the old `ChatPanel` had a `replayEvents` prop for session transcript replay. The new client does not implement this yet. This is acceptable for now; ACP replay support can be added later if needed.

### No blocking gaps found ✅
All intended current behaviors (queue, send-now, stop, permission, plan, usage, mode, config, environment offers, tool lifecycle, session resume, `_rookery/steering_prompt`) are present in the new client. Differences are intentional or documented above.

## Scoped remaining work to reach the end of this intermediate milestone
1. **Do one explicit ACP parity pass against the old client** ✅ done
2. **Close the most important remaining web/RN review items** ✅ done
3. **Raise test maturity to the minimum acceptable replacement level** ✅ done
4. **Enter the soak phase intentionally** ✅ done
5. **After soak, decide whether the old client can be deleted** ✅ deleted; `agent-server-client/src/client/**` removed
6. **After old-client deletion, clean up duplicated shared contracts** ✅ done; `agent-server-client/src/shared/acp.ts`, `agent.ts`, `environment.ts` now re-export from root `shared/`; `realtime.ts` and `environmentSkillPreview.ts` remain local as they carry server-side logic
7. **Only after that, begin the Expo/iPhone shell work**

## Suggested immediate next tasks
1. create root `shared/` ✅
2. move the most obvious shared ACP/types/contracts there ✅
3. identify and isolate every web-only rendering dependency in `client/` ← done for critical seams; markdown, picker, and settings controls are extracted
4. split `ChatPanel.tsx` by extracting session/controller logic ✅ reducer/state, ACP-event mapping, controller hook extraction, and `ChatPanel` view-wrapper simplification all done
5. expand behavioral tests around ACP/session flows ✅ ChatPanel integration tests now cover queue/send-now, permission, settings, environment events, tool lifecycle, plan/usage, and connection errors
6. compare the new client against the old one specifically for ACP parity ✅ done; findings documented above with no blocking gaps
7. only then start the Expo/iPhone shell work

## Risks
### 1. Accidental web lock-in
If we keep adding raw DOM assumptions, the future iPhone work gets much harder.

### 2. Premature over-extraction
If `shared/` absorbs UI concerns or unstable abstractions too early, it becomes noisy instead of helpful.

### 3. Deleting the old client too soon
If we remove `agent-server-client/src/client` before ACP/session parity and test coverage are strong, we will lose a useful reference and fallback.

### 4. Scope creep into environment architecture
The narrow environment bridge is important, but this migration should not get bogged down in solving that whole layer right now.

## Decision log
### Chosen now
- shared React Native direction is for **web + iPhone**, not "every client surface"
- iPhone should use **Expo**
- the old client should eventually be deleted
- the intermediate state should remain in place long enough to validate thoroughly
- `shared/` should now be created and used to remove duplicated contracts/core logic
- strong ACP compatibility is required
- `_rookery/steering_prompt` must remain supported
- `parentMessageTool` should not be carried forward

### Explicitly deferred
- Android rollout
- Chrome/Obsidian React Native strategy
- menu bar rewrite
- full repo split into all long-term directories
- deep environment bridge implementation work

## Acceptance criteria for this updated plan
- `client/` is clearly being stabilized as a shared **web + iPhone** UI base
- the roadmap explicitly includes making the implementation RN-native enough for Expo/iPhone use
- the roadmap explicitly creates `shared/` for shared contracts/core behavior
- the roadmap explicitly preserves ACP compatibility and `_rookery/steering_prompt`
- the roadmap explicitly excludes `parentMessageTool`
- the roadmap explicitly raises test maturity before deleting the old client
- the roadmap explicitly treats removal of `agent-server-client/src/client` as a later milestone after validation

## Concrete ordered execution plan
### Phase 1 - create `shared/` and stop further duplication
#### Goal
Create a root `shared/` package before more duplicated client/server protocol logic accumulates.

#### Planned directories/files
```text
shared/
  src/
    acp.ts
    environment.ts
    agent.ts
    jsonrpc.ts        # optional if split from acp.ts
```

#### Primary source files to consolidate
- `client/src/lib/acp.ts`
- `client/src/lib/environment.ts`
- `client/src/lib/agent.ts`
- matching old-client/shared definitions under `agent-server-client/src/client/` and `agent-server-client/src/shared/` where applicable

#### Exit criteria
- `client/` imports shared contracts from `shared/`
- old web client imports the same contracts where practical
- no new protocol/type duplication is added after this phase

### Phase 2 - make the new client RN-native at the seams
#### Goal
Keep `client/` as one semantic UI codebase for web + iPhone, while isolating platform-specific rendering.

#### Main files to address first
- `client/src/components/Markdown.tsx`
- `client/src/components/ChatPanel.tsx`
- `client/src/main.tsx`
- `client/src/lib/remoteAgent.ts`

#### Planned extractions
```text
client/src/components/markdown/
  Markdown.web.tsx
  Markdown.native.tsx

client/src/components/controls/
  OptionPicker.tsx
  OptionPicker.web.tsx     # if needed
  OptionPicker.native.tsx  # if needed
```

#### Key changes
- replace raw DOM markdown rendering with a platform-adaptive markdown layer
- replace raw `<select>` usage with a platform-adaptive picker abstraction
- keep browser-only entry concerns in `client/src/main.tsx`
- reduce reusable logic that depends directly on `window` or `document`

#### Exit criteria
- the client is RN-first with web adapters, not web-first with RN styling
- Markdown and settings controls have explicit web/native seams

### Phase 3 - split oversized files by responsibility
#### Goal
Move session/product behavior out of giant view files and make the code testable.

#### Highest-priority split targets
- `client/src/components/ChatPanel.tsx`
- `client/src/lib/remoteAgent.ts`
- `client/src/components/MessageBlocks.tsx`
- `client/src/App.tsx` if still needed after other extraction work

#### Planned extractions
```text
client/src/session/
  chatSessionTypes.ts
  chatSessionReducer.ts
  chatSessionController.ts   # or useChatSession.ts
  applyAcpEvent.ts           # optional
  queueHelpers.ts            # optional

client/src/components/blocks/
  BlockRenderer.tsx
  UserMessageBlock.tsx
  AgentTextBlock.tsx
  ThinkingBlock.tsx
  ToolBlockView.tsx
  ErrorBlockView.tsx
```

#### Exit criteria
- `ChatPanel.tsx` mainly wires controller state into presentational components
- block rendering is split into reusable pieces
- ACP/session behavior becomes directly unit-testable

### Phase 4 - preserve the right old-client behavior
#### Goal
Reach the intended parity level with the old client without dragging forward deprecated concepts.

#### Preserve
- ACP compatibility as fully as practical
- `_rookery/steering_prompt`
- queue/send-now/stop behavior
- permission prompts
- plan/usage/mode/config handling
- environment offer handling
- session selection/resume behavior
- tool lifecycle rendering

#### Explicitly do not preserve
- `parentMessageTool`
- legacy pre-ACP session-message compatibility

#### Main comparison references
- `agent-server-client/src/client/remoteAgent.ts`
- `agent-server-client/src/client/components/ChatPanel.tsx`

#### Exit criteria
- no intended current behavior exists only in the old client
- no new dependency is introduced on deprecated old-client-only concepts

### Phase 5 - raise test maturity before deletion
#### Goal
Make the new client safer to evolve than the old client.

#### Priority tests to add or strengthen
```text
client/src/lib/remoteAgent.test.ts
client/src/session/chatSessionState.test.ts
client/src/session/chatSessionController.test.ts   # or equivalent
client/src/components/ChatPanel.test.tsx
```

#### Behavioral priorities
- Enter submits
- Shift+Enter inserts newline
- busy submit queues
- queue edit/save/cancel works
- send-now works without optimistic fake user message injection
- stop/cancel works correctly
- ACP tool input/output rendering is correct
- permission flows work
- mode/config flows work
- environment offer flows work
- block modal/detail opening works

#### Exit criteria
- core session/controller logic has direct tests
- ACP/websocket behavior has comprehensive tests
- critical regressions are catchable without manual inspection

### Phase 6 - soak in the intermediate state
#### Goal
Use the new `client/` as the real web client for a while before deleting the old implementation.

#### During this phase
- keep backend in `agent-server-client/src/server/`
- keep `client/` as the active web UI at `localhost:3000`
- watch for ACP, parity, and platform-seam regressions

#### Exit criteria
- the client is trustworthy in normal use
- the extracted `shared/` layer looks reusable for the iPhone app

### Phase 7 - delete the old web client implementation
#### Goal
Remove `agent-server-client/src/client` once it is redundant.

#### Delete only when
- `shared/` is in use
- ACP parity is good enough
- test maturity is strong
- no intended behavior still depends on old client code
- docs/workflow no longer rely on the old client path

#### Cleanup scope
- delete `agent-server-client/src/client/**`
- remove or collapse now-redundant duplicated contracts in `agent-server-client/src/shared/**` once the old-client cleanup is complete and backend imports can be simplified safely
- update root `README.md`
- update `agent-server-client/README.md`
- update any now-stale PRODUCT / PRODUCT_CHANGES references

### Phase 8 - add the Expo/iPhone shell
#### Goal
Build the iPhone app on top of the stabilized shared architecture.

#### Expected work
- create the Expo-hosted iPhone shell
- reuse the shared `client/` UI and `shared/` core as much as practical
- fill platform-adaptive seams intentionally instead of ad hoc

#### Exit criteria
- major chat/session flows work in the iPhone shell
- the web+iPhone architecture is validated before any broader RN expansion

## Immediate next five implementation steps
1. create root `shared/`
2. move obvious shared ACP/environment/agent contracts there
3. extract session/controller logic from `client/src/components/ChatPanel.tsx`
4. add RN-native platform seams for markdown and pickers
5. deepen ACP/session behavior tests in `client/`
