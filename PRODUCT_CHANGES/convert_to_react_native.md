# Convert to React Native

## Summary
Refactor the repo toward a cleaner long-term layout built around:

- `client/`
- `server/`
- `shared/`
- `environment-repository/`
- `extensions/`

The immediate goal is **not** to finish the full repo split all at once. The immediate goal is to:

1. create a new `client/` directory
2. implement the shared UI there with **Expo + React Native + react-native-web**
3. make sure that UI works at `localhost:3000`
4. leave the existing menu bar app, environment manager, and Mac bridge mostly alone for now

This change is primarily about establishing the new shared UI direction without destabilizing the platform-specific runtime pieces.

## Goals
- Establish `client/` as the future shared UI for web, iPhone, and Android.
- Use Expo + React Native as the new UI foundation.
- Preserve the current local development experience: open `localhost:3000` and use the app.
- Keep the server behavior stable while the UI migrates.
- Delay major changes to:
  - the menu bar app
  - the environment manager
  - the Mac OS bridge / host capabilities
  - cross-device host orchestration

## Non-goals for this phase
Do **not** do these yet:

- rewrite the menu bar app
- fold the Mac bridge into the React Native client
- redesign environment offers / environment approval semantics
- redesign the environment manager
- redesign the ACP protocol
- ship iPhone or Android apps yet
- fully extract every shared type on day one

## Product direction
We want one shared UI that can eventually power:

- the local web app at `localhost:3000`
- the Chrome extension surface
- the Obsidian surface
- iPhone
- Android
- possibly other embedded surfaces later

For now, we will prove that direction by making the new React Native client work well as the web UI first.

## Guiding architectural principle
Separate these concerns:

- **client** = shared UI
- **server** = backend, session runtime, APIs, websocket handling
- **shared** = protocol types, DTOs, cross-cutting domain definitions
- **environment-repository** = skill/environment content on disk
- **extensions** = platform-specific packaging and integrations such as Chrome, Obsidian, and menu bar app

For this phase, the React Native work is about the **client** only.

## Desired final repo shape
This is the target end state after the broader refactor is complete:

```text
/
  client/
  server/
  shared/
  environment-repository/
  extensions/
    chrome/
    obsidian/
    menu-bar-mac/
  scripts/
  PRODUCT/
  PRODUCT_CHANGES/
```

### Responsibilities
#### `client/`
- Expo app
- React Native UI
- react-native-web target for local/browser usage
- chat screens
- block rendering
- compose controls
- session/agent selection UI
- client-side ACP session state handling

#### `server/`
- Fastify app
- REST APIs
- websocket endpoints
- agent runtime orchestration
- session management
- environment offer / decision endpoints
- static hosting or proxying of the web client in production/dev

#### `shared/`
- ACP / JSON-RPC types
- environment DTOs
- session / agent DTOs
- cross-platform contracts shared by client and server

#### `environment-repository/`
- environment-backed skill bundles
- no major structural change in this phase

#### `extensions/`
- Chrome extension
- Obsidian extension
- macOS menu bar app
- other platform-specific shells later

## Important scope decision
We are **not** using this change to solve the entire host/environment/capability architecture yet.

In particular, the following stay mostly as they are for now:

- the environment manager
- the environment bridge from the menu bar app into the OS
- the Mac-specific perception/control stack
- environment availability semantics

Those concerns are important, but they are **out of scope for this React Native migration phase**.

## Implementation plan
## Design philosophy — adaptive parity
We are **not** chasing pixel-identical reproduction of the old web client.

Instead we aim for **adaptive parity**:

- **Same design language** — colors, fonts, spacing, hierarchy all drawn from the existing CSS tokens (`tokens.css`)
- **Same features** — agent tree, tool expand/collapse, markdown, queue controls, send-now, stop, plan, permissions
- **Responsive layout** — layout adapts naturally between desktop and mobile breakpoints; the same components work everywhere
- **Platform-appropriate interactions** — `:hover` on web maps to `Pressable` states; touch targets scale up on mobile
- **Intelligent code organization** — not one giant stylesheet; shared design tokens + per-component stylesheets

The old client is the reference for look, feel, and feature set. The new client should be *recognizably* the same app, not a clone.

## Shared design tokens
Extract `tokens.css` into a `src/theme.ts` that both components and stylesheets import:

```ts
export const tokens = {
  colors: {
    backgroundPrimary: "#19141f",
    backgroundSecondary: "#231c2d",
    modifierBorder: "#3d314d",
    modifierHover: "#2f263b",
    interactiveAccent: "#7c3aed",
    interactiveAccentHover: "#8b5cf6",
    textNormal: "#ede9f5",
    textMuted: "#b5a9c9",
    textOnAccent: "#ffffff",
    textError: "#ff9ca3",
  },
  fonts: {
    mono: "SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace",
    sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  radii: { sm: 8, md: 14, lg: 18, full: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
};
```

Every component pulls its values from `tokens` instead of hardcoding colors or sizes.

## Responsive breakpoints
Use `useWindowDimensions()` with a simple breakpoint system:

- **compact** (< 768px) — phone layout: full-width, bottom compose, stacked cards
- **expanded** (>= 768px) — desktop layout: centered panel with max-width, side-by-side sections

Components conditionally adjust layout, padding, and font sizes based on the active breakpoint. No separate component trees for mobile vs desktop.

## Phase 1 — create `client/` and prove the new UI on web
This is the first and most important phase, broken into checkable increments.

### Goal
Get a new client running successfully at `localhost:3000` without changing the deeper environment/runtime architecture, built incrementally with user checkpoints.

### Approach
1. Create a new root-level `client/` package (already done).
2. Set it up with React Native + react-native-web + Vite (already done).
3. Rebuild the UI incrementally, checking with the user at each milestone.
4. Point local development at the new client while keeping the current backend behavior intact.
5. Do **not** touch the menu bar app yet.

## Phase 1A — scaffold and design tokens (done)
Already exists:

```text
client/
  package.json
  index.html
  tsconfig.json
  vite.config.ts
  src/
    main.tsx
    App.tsx
    lib/
      acp.ts
      acpClientTypes.ts
      agent.ts
      environment.ts
      remoteAgent.ts
      types.ts
```

What still needs to be done before the incremental UI rebuild:
- Create `src/theme.ts` with design tokens from `tokens.css`.
- Add a responsive hook (`src/hooks/useBreakpoint.ts`).
- Remove the current giant `App.tsx` and split into proper component files.

## Phase 1B — incremental UI rebuild (with user checkpoints)
Build the new UI in small, checkable increments. After each increment, the user reviews before the next one starts.

### Increment 1: agent selection screen
Port `AgentSelectionScreen.tsx` with full fidelity:
- agent tree with `└─` branch indicators and depth-based indentation
- parent/child agent grouping
- "New" / "Continue" buttons per agent
- session name dialog when creating a new session
- environment skills notice when environments are approved
- starting/error states

**Checkpoint**: user confirms agent tree looks and works right.

### Increment 2: session selection screen
Port `SessionSelectionScreen.tsx`:
- session list with name, date, running/stopped state, connected clients
- back button to agent selection
- loading state
- empty state

**Checkpoint**: user confirms session selection works.

### Increment 3: chat screen shell + message blocks
Port the core chat experience:
- `ChatPanel` with state reducer
- `MessageThread` with auto-scroll
- `UserMessageBlock` (markdown)
- `AgentTextBlock` (markdown + streaming cursor)
- `ThinkingBlock` (collapsible, markdown)
- `ToolBlock` (expand/collapse with chevron, arguments, result, status labels)
- `ErrorBlock`
- `BlockModal` for expanded detail view on click

**Checkpoint**: user confirms chat rendering looks right with all block types.

### Increment 4: compose, queue, and stop
Port the compose and message-control affordances:
- compose box with send on Enter, Shift+Enter for newline
- automatic queuing when agent is busy
- queue display with queued message list
- queued message edit / send-now / delete controls
- stop button while agent is running
- status line (Ready / Agent is working / queued count / token usage)
- all ACP controls: modes picker, config option pickers

**Checkpoint**: user confirms compose, queue, and stop behaviors match the old client.

### Increment 5: plan, permissions, environment modal
Port remaining secondary features:
- plan display
- permission request prompt with option buttons
- environment offer modal with accept/approve/ignore/reject

**Checkpoint**: user confirms secondary features work.

### Increment 6: responsive polish
Tune the responsive behavior:
- compact breakpoint adjustments for narrow viewports
- expanded breakpoint adjustments for wide viewports
- verify the UI works sensibly at both extremes and in between

**Checkpoint**: user confirms responsive behavior.

## Phase 1C — serve the new client at `localhost:3000`
Once the user signs off on the incremental rebuild, switch `npm run dev` to serve the new client.

### Dev behavior
Root `npm run dev`:
- starts the backend
- starts the new client in web mode (Vite middleware)
- makes the app available at `localhost:3000`

This uses the same Fastify + Vite middleware pattern the old client uses today. The server owns port 3000 and proxies non-API requests to Vite.

## Acceptance criteria for Phase 1
- `client/src/theme.ts` with design tokens matching `tokens.css`
- responsive hook that components use for layout decisions
- agent selection screen with tree view, nesting, session name dialog
- session selection screen with list, loading, and empty states
- chat screen with all block types, markdown rendering, auto-scroll, block detail modal
- compose box with queueing, send-now, edit, delete, stop
- plan display, permission prompts, environment approval modal
- status line with token usage
- responsive behavior across compact and expanded breakpoints
- `npm run dev` serves the new client at `localhost:3000`
- menu bar app unchanged
- environment manager unchanged
- environment bridge unchanged

## Phase 2 — move toward `server/` and `shared/`
Once the new client is working, stable, and user-approved on web, begin the repo refactor proper.

### Goal
Split `agent-server-client/` into the long-term package boundaries.

### Planned actions
1. Create root `server/`.
2. Move Fastify/backend code from `agent-server-client/src/server/` into `server/`.
3. Create root `shared/`.
4. Move truly shared protocol/domain types there.
5. Update imports so `client/` and `server/` both depend on `shared/`.
6. Retire `agent-server-client/` once the split is complete.

### Initial candidates for `shared/`
- ACP types
- JSON-RPC types
- environment DTOs
- agent/session DTOs
- event payload definitions used on both sides

### Things that should **not** move to `shared/` too early
- React hooks
- React Native components
- browser-only helpers
- Fastify-only code
- UI reducer details unless they are clearly platform-neutral domain logic

## Phase 3 — move the existing platform shells under `extensions/`
After `client/`, `server/`, and `shared/` are established, reorganize the remaining packages.

### Target moves
- `agent-station-chrome-extension/` → `extensions/chrome/`
- `agent-station-obsidian-extension/` → `extensions/obsidian/`
- `agent-station-menu-bar-app-mac/` → `extensions/menu-bar-mac/`

This phase is primarily structural.

### Important note
This move does **not** imply rewriting those extensions immediately.

Especially for the menu bar app:
- keep it as-is for now
- do not force it onto React Native yet
- do not change its OS bridge architecture yet

## Phase 4 — later follow-on work, explicitly deferred
These are later efforts, not part of this document's implementation scope:

- menu bar app integration with the new shared client
- iPhone app packaging through Expo
- Android app packaging through Expo
- deeper extraction of shared domain logic
- environment manager redesign
- cross-device host/capability architecture
- narrowing platform tools away from shell-driven behavior

## Suggested migration sequence
1. create `client/`
2. configure Expo + React Native + web
3. port the current web UI into `client/`
4. verify it works against the current backend
5. make `localhost:3000` use the new client
6. stabilize tests and developer workflow
7. create `server/`
8. move shared protocol/domain code into `shared/`
9. retire `agent-server-client/`
10. move platform packages under `extensions/`

## Developer workflow target
### During the first transition
It is acceptable if the workflow is temporarily a little awkward, as long as it is reliable.

### Final desired workflow
From repo root:

```bash
npm run dev
```

And then:
- backend starts
- new React Native web client starts
- `localhost:3000` works

The user should not need to think about the old `agent-server-client` layout anymore.

## Risks
### React Native web parity work
Some browser behaviors may need special handling in React Native web:
- markdown rendering
- text selection
- modal behavior
- scroll anchoring
- keyboard shortcuts
- compact responsive layout

### Temporary duplication
There may be a short-lived period where:
- some types exist in old and new places
- some logic is copied before being cleanly extracted

That is acceptable if it accelerates the migration and is cleaned up in Phase 2.

### Overreaching into environment architecture
The main risk is trying to solve too much at once.

This document intentionally avoids changing:
- environment manager internals
- Mac bridge semantics
- cross-device capability routing

## Decision log
### Chosen now
- use **Expo + React Native** for the new shared client
- validate it first on web at `localhost:3000`
- delay menu bar changes
- delay environment/bridge redesign
- eventually split the repo into `client`, `server`, `shared`, `environment-repository`, and `extensions`

### Explicitly deferred
- menu bar rewrite or embedding strategy
- iPhone and Android rollout details
- host/capability architecture changes
- deep environment model changes

## Acceptance criteria for the overall change
- the repo has a new root `client/` package using Expo + React Native
- the shared UI works in the browser at `localhost:3000`
- current backend behavior still works with that UI
- the repo has a clear migration path to `server/`, `shared/`, and `extensions/`
- the menu bar app remains functional and largely untouched during this phase
- environment manager and environment bridge remain largely untouched during this phase
