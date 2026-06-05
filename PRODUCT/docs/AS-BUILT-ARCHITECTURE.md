# Agent Station — As-Built Architecture

**Last Updated**: 2026-06-05

Agent Station is a local-first npm monorepo (repo root package `agent-station`) that packages an event-native agent chat runtime, a React single-page UI, and a Fastify HTTP/WebSocket API into one web service running at `127.0.0.1:3000`. The server fronts each agent session with a realtime "room" that streams normalized `SessionEvent`s to connected clients; agents are driven through a `BaseAgent` abstraction whose primary backend (`PiAgent`) bridges to the external `pi` CLI in JSONL RPC mode (loading the sibling `../my-agent` package as a Pi extension), with a scripted `MockAgent` for tests and UI development. A disk-backed **environment** subsystem lets external providers (a Chrome MV3 extension, an Obsidian sidebar plugin, or any HTTP client) declare the user to be "in" a contextual environment, prompt for approval, and hot-load that environment's skill bundle into the running agent. All mutable local state — per-session event logs, the agent-session log, and persisted environment decisions — lives under a gitignored `.var/agent-station/` tree (JSONL files plus one `node:sqlite` database).

## Table of Contents

- [System Overview](#system-overview)
- [Core Concepts](#core-concepts)
- [Agent Runtime & Abstraction (Server)](#agent-runtime--abstraction-server)
- [Realtime Session Rooms & Event Streaming (Server)](#realtime-session-rooms--event-streaming-server)
- [Environment Manager & Repository (Server)](#environment-manager--repository-server)
- [HTTP/WebSocket API Surface & Server Bootstrap](#httpwebsocket-api-surface--server-bootstrap)
- [React Client UI (the :3000 app)](#react-client-ui-the-3000-app)
- [Chrome MV3 Extension (Environment Provider)](#chrome-mv3-extension-environment-provider)
- [Obsidian Sidebar Extension](#obsidian-sidebar-extension)
- [Build, Configuration & Dev Workflow](#build-configuration--dev-workflow)
- [External Dependencies](#external-dependencies)

## System Overview

Agent Station is one Fastify process that serves a REST API, a single WebSocket endpoint, and the React SPA (Vite middleware in dev, static `dist` in prod). Browser/Obsidian/Chrome host clients reach the React client at `:3000`; the client opens a per-session WebSocket to a `SessionRoom`, which wraps the agent runtime and fans sequenced, replayable events back out. The environment subsystem and on-disk skill repository feed skill paths into agent rebuilds, and all durable state lands under `.var/agent-station/`.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ HOST CLIENTS                                                                       │
│                                                                                    │
│  ┌──────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐ │
│  │ Browser tab  │   │ Chrome MV3 extension       │   │ Obsidian sidebar plugin   │ │
│  │ (direct)     │   │ split-pane shell;          │   │ ItemView → full-size      │ │
│  │              │   │ background worker POSTs     │   │ <iframe src=:3000>        │ │
│  │              │   │ /api/environments/*        │   │                           │ │
│  └──────┬───────┘   └─────────┬──────────────┬──┘   └────────────┬──────────────┘ │
└─────────┼─────────────────────┼──────────────┼───────────────────┼────────────────┘
          │  embeds :3000 app   │ embeds :3000  │ register/unavail  │ embeds :3000 app
          ▼                     ▼               ▼ (HTTP)            ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ REACT CLIENT  (Vite SPA, served at http://127.0.0.1:3000, cwa- prefixed)           │
│   App (agent-selection → session-selection → chat)                                 │
│   RemoteAgent: REST control-plane + per-session WebSocket; reducer → Block[]        │
└───────┬───────────────────────────────────────────────────────────┬────────────────┘
        │ REST /api/* (control)                       WebSocket /api/ws (stream)
        ▼                                                            ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ FASTIFY SERVER  (agent-server-client, buildServer())                               │
│                                                                                    │
│  REST routes                          WebSocket route                              │
│   /api/health,/api/agents             /api/ws?sessionId&fromSequence               │
│   /api/agent/{sessions,...,start}        │ subscribeWithReplay + user_event→run    │
│   /api/environments/{register,            │                                         │
│     unavailable,decision,preview}         ▼                                         │
│                              ┌───────────────────────────────────────────────────┐ │
│                              │ SessionRoomManager  (one SessionRoom per sessionId)│ │
│                              │  ┌──────────────────────────────────────────────┐ │ │
│                              │  │ SessionRoom                                   │ │ │
│                              │  │  RoomEventStream (seq++, persist, fan-out)    │ │ │
│                              │  │  EnvironmentSessionState (skill paths/offers) │ │ │
│                              │  │  serial queue: agent run | runtime rebuild    │ │ │
│                              │  └───────────────┬──────────────────────────────┘ │ │
│                              └──────────────────┼─────────────────────────────────┘ │
│                                                 │ setEventSink(SessionEvent)         │
│   ┌─────────────────────────────┐               ▼                                    │
│   │ EnvironmentManager          │   ┌──────────────────────────────────────────┐    │
│   │  available/ephemeral/entered│──▶│ Agent runtime (BaseAgent)                 │    │
│   │  listeners = SessionRooms   │   │  ┌────────────────────┐ ┌──────────────┐  │    │
│   │     │ onEnter(skillPaths)   │   │  │ PiAgent            │ │ MockAgent     │  │    │
│   └─────┼──────────────┬────────┘   │  │ spawn `pi`         │ │ scripted      │  │    │
│         │              │            │  │  --mode rpc (JSONL)│ │ 3-turn fixture│  │    │
│   ┌─────▼───────┐ ┌────▼──────────┐ │  └─────────┬──────────┘ └──────────────┘  │    │
│   │ Local       │ │ Environment   │ └────────────┼─────────────────────────────┘    │
│   │ Environment │ │ DecisionStore │              │ -e ../my-agent (Pi extension)     │
│   │ Repository  │ │ (node:sqlite) │              ▼                                    │
│   └─────┬───────┘ └────┬──────────┘     external `pi` CLI binary (on PATH)            │
└─────────┼──────────────┼───────────────────────┬───────────────────────────────────┘
          │ reads        │ writes                │ writes JSONL
          ▼              ▼                        ▼
  environment-repository/        .var/agent-station/  (gitignored local state)
   demo/demo/  web/wikipedia/      environment-decisions.sqlite
   (SKILL.md skill bundles)        agent-sessions.jsonl
                                   session-events/<sessionId>.jsonl
```

## Core Concepts

| Concept | Description |
|---|---|
| **BaseAgent lifecycle split** | Abstract base owns `run`/`stop`/`ensureStarted` + session-log persistence; subclasses implement only provider hooks (`start`/`restart`/`registerSession`/`runImpl`/`stopImpl`). `stop()` interrupts an in-flight run before releasing provider resources. |
| **PiAgent RPC** | Server wrapper that spawns the external `pi` CLI with `--mode rpc`, speaks newline-delimited JSON over stdin/stdout, correlates request/response by id, and translates Pi protocol events into normalized `SessionEvent`s. |
| **MockAgent** | Scripted fixture requiring no external process; cycles 3 hard-coded turns exercising the full event vocabulary, used in tests and streaming-UI development. |
| **Agent profiles** | Optional JSON config (`config/agent-profiles.json`) of `{ id, type:"pi", args, cwd, skillPaths, extensionPaths }` loaded at module init; each becomes a `PiAgent`-backed registry entry (parent `PiAgent`). Distinct from the `pi` extension package (`../my-agent`) the wrapper launches. |
| **Agent registry / discovery** | `AGENT_REGISTRY` mapping agent id → factory; `createAgent(id, restart, options)` builds the right `BaseAgent`; `getAgentDefinitions` exposes the id/parentId tree. |
| **Extension/skill paths** | `skillPaths` → `--skill` and `extensionPaths` → `-e` pi argv; the sibling `../my-agent` package is loaded as a pi extension via `-e`. |
| **Empty-response auth guard** | `PiAgent` treats a turn that ends with no assistant content as a likely expired `pi` sign-in token and emits an explicit `run_failed` instead of a clean completion. |
| **SessionEvent model / taxonomy** | Single normalized discriminated union all agents emit (`status_changed`, `text_delta`, `tool_*`, `run_completed`/`failed`, `environment_event`, etc.), decoupling consumers from the backend; helpers enumerate types and map them to `AgentRunStatus`. |
| **Session log & resume** | JSONL records (`id`/`agent`/`name`/`createdAt`/`restart`) appended on fresh start to `.var/agent-station/agent-sessions.jsonl`; the opaque `restart` blob drives `BaseAgent.restart` (Pi re-spawn with `--session`). |
| **SessionRoom** | Per-session server object wrapping the agent runtime, a sequenced event stream, and environment state; fans events to connected clients and reaps itself when idle. |
| **SessionRoomManager** | Registry of live rooms keyed by session id; create-or-reattach via `upsert`, single room per session, unsubscribes from `EnvironmentManager` on removal. |
| **RoomEventStream** | Monotonic sequence counter + subscriber set; `publish` (persist+increment+emit) vs `broadcast` (emit-only), with replay-then-subscribe to close the live/replay gap. |
| **SessionEventStore** | Per-session JSONL append log of `SessionEventMessage`s with serialized appends, sequence-filtered reads, and `getLatestSequence` for cursor continuity. |
| **EnvironmentSessionState** | Per-room tracking of base + per-environment skill paths, pending offers, and a one-shot runtime rebuilder that swaps the agent when environments are entered/exited. |
| **Realtime wire protocol** | Shared inbound `user_event` and outbound `session_event`/`ack`/`error` message types used by both the server WebSocket route and the client. |
| **Environment** | An external context (id of form `kind:path`, e.g. `demo:demo`) that a provider declares the user to be 'in'; backs a directory of skills under `environment-repository/<kind>/<path>/`. |
| **Skill bundle** | The on-disk directory for an environment containing one or more skills (each a subdir with a `SKILL.md` plus reference files), loaded into the agent runtime as skill-search roots when the environment is entered. |
| **2×2 decision model** | `EnvironmentDecision = accept/approve/ignore/reject`, split on positive-vs-negative and this-visit (ephemeral) vs permanent (persistent) axes. Ephemeral overrides persistent. |
| **Availability** | Global in-memory state that an environment is currently 'around' (a provider said so via `/register`); cleared by `/unavailable`. |
| **Entered (derived)** | Per-session state: a room has an environment iff it is *available* AND its effective decision is accept/approve; entering hot-rebuilds the agent runtime with the env's skill paths. |
| **Effective decision** | The live answer for an environment: ephemeral accept/ignore wins over persistent approve/reject; 'undecided' if neither, which triggers an offer prompt. |
| **Skill preview** | A `SkillPreview {id,name,files}` listing a skill's files+contents so the approval UI can show what would be injected before the user approves. |
| **EnvironmentEventListener** | Interface (implemented by `SessionRoom`) through which the manager pushes `onEnvironmentOffered`/`Entered`/`Exited`/`Resolved` lifecycle events; the manager never touches runtimes or sockets directly. |
| **EnvironmentDecisionStore** | The only database in the system; `node:sqlite` `DatabaseSync` persisting only `approve`/`reject` decisions (ephemeral `accept`/`ignore` stay in memory). |
| **message_parent bridge tool** | A pi extension whose `execute()` is a no-op; the browser client intercepts the tool call and relays the JSON payload to the host page via `postMessage`. |
| **AppScreen state machine** | Client discriminated union (`agent-selection` \| `session-selection` \| `chat`) in `App.tsx` driving the three-screen flow; chat is force-remounted via an incrementing `viewKey`. |
| **RemoteAgent** | Client class that performs the `/api/agent/start` handshake and manages the per-session WebSocket, with sequence-based replay (`fromSequence`) and a one-at-a-time run promise model. |
| **Block taxonomy** | Flat typed render units (`UserMessageBlock`, `ThinkingBlock`, `AgentTextBlock`, `ToolBlock`, `ErrorBlock`) produced by a `useReducer` that folds streamed `SessionEvent`s into incremental UI state. |
| **Message queueing** | Client-side serialization: messages submitted while the agent is busy are queued and replayed one at a time on `run_completed` (120ms gap). |
| **Skill files tree** | `skillFiles.ts` builds a files-first, sorted depth-tree from a path→content map for the `SkillFilesPanel` explorer in the approval modal. |
| **Environment provider** | Role of a host client (Chrome/Obsidian/HTTP): advertises a live context as an 'environment' an Agent Station agent can act in, identified by an `environmentId` like `web:wikipedia`. |
| **Site registry** | Chrome extension's `site-registry.json` mapping supported sites (`id`, `environmentId`, `sourceName`, `hostsExact`, `hostSuffixes`) used by the background worker to recognize hostnames and derive the `environmentId`. |
| **Split-pane shell** | Chrome content-script UI that replaces the page with a left iframe mirroring the original site and a right iframe embedding the Agent Station localhost app. |
| **url_change postMessage** | The only remaining Chrome parent/iframe message: the localhost panel posts `{type:'url_change', url}` and the content script updates the left mirror iframe. |
| **ChatView (ItemView)** | Custom Obsidian sidebar view whose `onOpen()` renders a single full-size iframe pointing at `http://localhost:3000`; the only runtime UI surface of the plugin. |
| **Scripts-only root package** | The repo-root `package.json` installs no deps; every npm script delegates to the `agent-server-client` workspace via `--prefix`. The only root-local script is `agent:cli`. |
| **buildServer()** | Exported Fastify factory in `src/server/index.ts` that wires stores/managers/routes; reused by tests and the headless CLI with `enableClient:false`. The `listen` block only runs when the module is the process entrypoint. |
| **Dev/prod client hosting fork** | `registerClientApp` switches on `NODE_ENV`: dev runs Vite in-process middleware mode (HMR); prod serves prebuilt `dist/client` statically with an SPA `index.html` fallback. |
| **.var/agent-station/ runtime state** | Single gitignored tree holding all mutable local state: per-session JSONL event logs, the `agent-sessions.jsonl` log, and the `environment-decisions.sqlite` database. |
| **Runtime path resolution (paths.ts)** | `AGENT_CLIENT_ROOT`/`REPO_ROOT` derived by walking up to the `package.json` named `agent-server-client`, so the same code resolves paths from `src/` (tsx) or `dist/server/server/` (prod). |
| **Split TypeScript projects** | `tsconfig.json` typechecks client+server with `noEmit`+Bundler resolution; `tsconfig.server.json` emits the server with NodeNext to `dist/server`. Source uses `.js` import specifiers to satisfy both NodeNext and tsx. |
| **Headless agent CLI** | `interact-with-remote-agent.{sh,ts}` starts an in-process Fastify server on an ephemeral port and streams filtered `SessionEvent`s as JSONL, enabling agent interaction without the web UI. |

> **Naming note (product vs. code).** The product surface is branded "Agent Station," but client code identifiers keep the `cwa-` prefix and `RemoteAgent` defaults to backend `"PiAgent"`. `AgentDefinition` (`{ id, parentId }`) exists in both `shared/agent.ts` and `agentDiscovery.ts`. The `pi` extension loaded via `-e ../my-agent` is the product's domain agent package, distinct from the `PiAgent` server wrapper class that launches it.

## Agent Runtime & Abstraction (Server)

This subsystem lives under `agent-server-client/src/server/agents/` and defines how Agent Station launches, drives, and persists agent sessions. It separates *application lifecycle* (owned by `BaseAgent`) from *provider mechanics* (implemented by subclasses), exposes a single normalized event stream (`SessionEvent`), and resolves concrete agents through a registry that is partly hard-coded and partly loaded from on-disk **agent profiles**.

### Abstraction hierarchy

```
                 BaseAgent (abstract, lifecycle + session log)
                 /                                      \
            PiAgent                                  MockAgent
   (spawns `pi` CLI, --mode rpc,                (scripted 3-turn fixture,
    JSONL stdin/stdout protocol)                 no external process)
        |
   profile-derived agents (id from agent-profiles.json,
   each is a PiAgent with profile-specific args/cwd/skill/extension paths)
```

`BaseAgent` (`agents/BaseAgent.ts:34`) holds all the Agent-Station-aware behavior. Its public methods (`run`, `ensureStarted`, `stop`) are concrete and should not be overridden; subclasses implement only five protected hooks:

| Hook | Purpose |
|---|---|
| `start()` | Create a brand-new live session. |
| `restart(metadata)` | Resume a live session from persisted `AgentRestartMetadata`. |
| `registerSession()` | Return the JSON-serializable `AgentSessionRecord` for future resume. |
| `runImpl(message)` | Handle one user message after start/restart. |
| `stopImpl()` | Release provider resources (child process, sockets, pending requests). |

```typescript
export abstract class BaseAgent {
  protected started = false;
  protected sessionRecord?: AgentSessionRecord;
  private activeRunReject?: (error: Error) => void;
  private sessionName = "default";
  private eventSink?: (event: SessionEvent) => void;

  constructor(protected restartMetadata?: AgentRestartMetadata) {}

  setEventSink(eventSink: ((event: SessionEvent) => void) | undefined): void;
  setSessionName(name: string): void;
  get record(): AgentSessionRecord | undefined;

  async run(userMessage: string): Promise<void>;
  async ensureStarted(): Promise<void>;
  async stop(): Promise<void>;

  protected abstract start(): Promise<void>;
  protected abstract restart(metadata: AgentRestartMetadata): Promise<void>;
  protected abstract registerSession(): Promise<AgentSessionRecord>;
  protected abstract runImpl(userMessage: string): Promise<void>;
  protected abstract stopImpl(): Promise<void>;
}
```

Key lifecycle details:

- **Start-once / lazy start.** `ensureStarted()` (`BaseAgent.ts:86`) is idempotent. If `restartMetadata` was supplied it calls `restart(metadata)` (resume); otherwise it calls `start()`, then `registerSession()`, then persists the record via `appendSessionRecord()`. Only fresh starts write a session-log record.
- **Stop interrupts an in-flight run.** `run()` (`BaseAgent.ts:67`) races the actual work (`ensureStarted()` → `runImpl()`) against a `stopped` promise whose reject function is stashed in `activeRunReject`. `stop()` (`BaseAgent.ts:100`) invokes that reject with `` `${agentName} stopped.` `` *before* calling `stopImpl()`, so a concurrently-running `run()` rejects and the caller (the session room / HTTP stream) can surface a run failure. `stopImpl()` itself only deals with the provider and never needs to know how the stream is signaled.
- **Identity & naming.** `agentName` defaults to `this.constructor.name` but `PiAgent` overrides it to `options.agentName` (the profile id). `setSessionName()` trims to a default of `"default"`. Both feed `createSessionRecord({ agent, name, restart })`.
- **Event sink.** `emitSessionEvent()` forwards to the injected `eventSink`. The sink is wired in `SessionRoom.attachRuntimeEventSink()` (`realtime/SessionRoom.ts:71`), which publishes each `SessionEvent` to the room's broadcast/replay stream.

### How a prompt becomes a stream of events

The room layer is the entry point. `SessionRoom.run(message)` (`realtime/SessionRoom.ts:137`) serializes prompts through a promise queue and calls `agent.run(message)`; any throw becomes a published `run_failed` event. Inside `BaseAgent.run`, `runImpl` does the provider-specific work and emits `SessionEvent`s through the sink.

```
WebSocket "user_event" ──▶ room.run(text)            (routes/websocketRoute.ts:77)
                              │  (serialized on room queue)
                              ▼
                       BaseAgent.run() ──▶ ensureStarted() ──▶ runImpl(message)
                              │                                    │ emitSessionEvent(...)
                              ▼                                    ▼
                       Promise.race(running, stopped)      eventSink (SessionRoom)
                                                                   │
                                                                   ▼
                                                   publishSessionEvent → broadcast/replay
```

### PiAgent: launching and driving the `pi` CLI

`PiAgent` (`agents/PiAgent.ts:124`) spawns the external **`pi`** CLI and speaks a newline-delimited JSON (JSONL) RPC protocol over stdin/stdout.

**Launch.** `startProcess()` (`PiAgent.ts:187`) spawns `command` (default `"pi"`) with `args` and `cwd` (default `process.cwd()`; the registry sets `cwd` to `REPO_ROOT`), `stdio: "pipe"`. Default args are `["--mode", "rpc"]` (`DEFAULT_ARGS`, `PiAgent.ts:32`). `getPiArgs()` (`PiAgent.ts:167`) augments them:

| Source | Effect on argv |
|---|---|
| `options.extensionPaths` | appends `-e <path>` per extension |
| `options.skillPaths` + `restart.skillPaths` | appends `--skill <path>` per skill (de-duplicated) |
| `restart.sessionFile` or `restart.sessionId` | appends `--session <value>` to resume |

The `-e` (extension) mechanism is how a sibling agent package is loaded. The shipped example profile (`config/agent-profiles.example.json`) defines `"args": ["-e", "../my-agent", "--mode", "rpc"]`, i.e. it loads the sibling `../my-agent` package (relative to the agent's `cwd`) as a Pi extension. Note: at the time of writing, `config/agent-profiles.json` does **not** exist in the repo (only the `.example.json` does), so `loadAgentProfiles()` returns `[]` and no profile-derived agents are registered; `../my-agent` is also not present as a sibling directory. The `pi` binary is expected on `PATH`.

**Restart vs. register.** `restart(metadata)` (`PiAgent.ts:180`) re-spawns with the session arg, then issues a `get_state` RPC (15s default timeout) and applies the returned `PiSessionState`. `registerSession()` (`PiAgent.ts:218`) also calls `get_state` and builds the record from `sessionId` / `sessionFile` / `skillPaths`.

**Reading the stream.** `attachJsonlReader()` (`PiAgent.ts:293`) buffers stdout/stderr and emits per line. `handleStdoutLine()` (`PiAgent.ts:317`):
- Lines with `type === "response"` and a string `id` resolve a pending RPC in `pendingRequests` (request/response correlation).
- All other lines are streaming events routed to `handleEvent()`.
- Unparseable lines emit a `protocol_error`; stderr lines emit `environment_event` (`kind: "pi_stderr"`); unexpected process `exit` emits `connection_error` and rejects any active run (unless `stopping`).

**Sending a prompt.** `runImpl()` (`PiAgent.ts:230`) emits a `user_message`, sends a `prompt` RPC (`sendCommand("prompt", { message })`), and returns a promise that resolves/rejects only when Pi signals end-of-turn. Each RPC command is `{ id: "pi-<ts>-<n>", type, ...payload }` written as one JSONL line (`PiAgent.ts:260`).

**Pi event → SessionEvent translation.** `handleEvent()` (`PiAgent.ts:354`) maps the Pi protocol to normalized events:

| Pi event | Emitted `SessionEvent`(s) |
|---|---|
| `agent_start` | `status_changed: busy` |
| `agent_end` | run completion via `finishRun()` |
| `turn_start` | `status_changed: busy` |
| `message_start` (assistant) | `assistant_message_started` (with `model`/`provider`) |
| `message_update` → `text_start`/`text_delta` | `status_changed: streaming` / `text_delta` |
| `message_update` → `thinking_start`/`thinking_delta` | `status_changed: thinking` / `thinking_delta` |
| `message_update` → `toolcall_start`/`delta`/`end` | `tool_call_started` / `tool_input_delta` / `tool_call_ready` |
| `message_update` → `error` | `assistant_message_error` + `run_failed`, then rejects run |
| `message_end` | `assistant_message_completed` |
| `tool_execution_start` | `status_changed: using_tool` + `tool_running` |
| `tool_execution_update` | `tool_output_delta` |
| `tool_execution_end` | `tool_completed` or `tool_error` (on `isError`) |
| `queue_update` | `status_changed: queued` |
| `compaction_start` | `status_changed: thinking` ("Compacting context…") |
| `auto_retry_start` / `auto_retry_end` | `status_changed: retrying` / `run_failed` on failure |
| `extension_error` | `run_failed` |
| `extension_ui_request` | `environment_event` (`kind: "pi_extension_ui_request"`) |
| unknown | `environment_event` (`kind: "pi_unknown_event"`) |

Tool-call streaming is correlated by a canonical `toolCall.id`. Drafts are keyed `"<messageId>:<contentIndex>"` (`toolDraftKey`); a `toolcall_delta` arriving before its `start`, an id change between start/end, or a missing id all emit `protocol_error` rather than corrupting state.

**Empty-response guard.** `finishRun()` (`PiAgent.ts:582`) tracks `producedAssistantContent`. If `agent_end` arrives with no assistant content, it emits an `assistant_message_error` + `run_failed` whose message explicitly suggests the `pi` sign-in token is expired ("Run `pi` in a terminal to sign in again") — this is the canonical failure mode for an unauthenticated CLI. Otherwise it emits `run_completed` + `status_changed: idle`.

**Stop.** `stopImpl()` (`PiAgent.ts:251`) rejects any active run, sets `stopping = true` (so the `exit` handler stays quiet), sends `SIGTERM`, and clears the process/start promise.

```typescript
export interface PiAgentOptions {
  command?: string;       // default "pi"
  args?: string[];        // default ["--mode", "rpc"]
  cwd?: string;
  startupTimeoutMs?: number;  // default 15_000 for get_state
  skillPaths?: string[];      // → --skill <path>
  extensionPaths?: string[];  // → -e <path>
  agentName?: string;         // overrides constructor.name
}

export interface PiSessionState {
  sessionId?: string; sessionFile?: string; model?: JsonObject | null;
  isStreaming?: boolean; messageCount?: number; pendingMessageCount?: number;
}
```

### MockAgent: scripted fixture

`MockAgent` (`agents/MockAgent.ts:152`) requires no external process. It cycles through 3 hard-coded turns (`turnIndex % 3`, static across instances) that exercise the full event vocabulary: streamed thinking, streamed assistant text, streamed tool-input deltas, tool completion, and (turn 3) a `tool_error` followed by a thrown provider error → `run_failed`. It is used in tests and for UI development of the streaming surfaces.

### Agent discovery & profiles

`agentDiscovery.ts` builds an `AGENT_REGISTRY` (`agents/agentDiscovery.ts:34`) of `{ id, parentId, create }` entries:

- `"MockAgent"` (parent `null`) → `new MockAgent(...)`.
- `"PiAgent"` (parent `null`) → a `PiAgent` with `cwd: REPO_ROOT`, `agentName: "PiAgent"`, plus de-duplicated skill/extension paths from caller options.
- One entry per loaded **agent profile** (`AGENT_PROFILES`), each a `PiAgent` whose `parentId` defaults to `"PiAgent"`, carrying the profile's `cwd`, `args`, and merged skill/extension paths.

Public API: `getAgentDefinitions()` → `{ id, parentId }[]`, `isKnownAgent(id)`, and `createAgent(id, restartMetadata?, options?)` which throws `Unknown agent: <id>` for unregistered ids.

Profiles are loaded eagerly at module load by `loadAgentProfiles()` (`config/agentProfiles.ts:21`) from `agent-server-client/config/agent-profiles.json`. The file is optional (missing → `[]`); each profile must have a non-empty string `id` and `type === "pi"`.

```typescript
export interface AgentProfile {
  id: string;
  type: "pi";
  parentId?: string | null;   // defaults to "PiAgent" in the registry
  args?: string[];            // full pi argv, e.g. ["-e","../my-agent","--mode","rpc"]
  cwd?: string;
  skillPaths?: string[];
  extensionPaths?: string[];
}
```

### Session logging & resume

`sessionLog.ts` persists one JSON record per line (JSONL) to `${REPO_ROOT}/.var/agent-station/agent-sessions.jsonl` (`DEFAULT_SESSION_LOG_PATH`, overridable via `setSessionLogPath()`).

```typescript
export type AgentRestartMetadata = Record<string, unknown>;

export interface AgentSessionRecord {
  id: string;        // crypto.randomUUID()
  agent: string;     // agent id / agentName
  name: string;      // session name, default "default"
  createdAt: string; // ISO timestamp
  restart: AgentRestartMetadata; // opaque resume payload (Pi: { sessionId, sessionFile, skillPaths })
}
```

`appendSessionRecord()` creates the directory and appends a line on each fresh start. `readSessionRecords()` parses, tolerates a missing file (`ENOENT → []`), and returns records sorted newest-first by `createdAt`. `findSessionRecord(id)` looks one up for resume; the room layer then passes its `restart` blob back into `createAgent(id, restart)`, driving `BaseAgent.restart()` → `PiAgent` re-spawn with `--session`.

### The normalized event/message model

`shared/agent.ts` defines the per-kind event payload interfaces and `AgentRunStatus`; `shared/realtime.ts` assembles them into the discriminated union `SessionEvent` and the wire envelopes.

```typescript
export type AgentRunStatus =
  | "idle" | "busy" | "thinking" | "streaming"
  | "using_tool" | "retrying" | "queued" | "error";
```

`SessionEvent` (`shared/realtime.ts:20`) is the single normalized shape every agent emits — both `PiAgent` and `MockAgent` produce identical event types so downstream consumers are backend-agnostic:

| Event `type` | Payload highlights |
|---|---|
| `status_changed` | `status: AgentRunStatus`, `message?` |
| `user_message` | `text`, `queued?`, `id?` |
| `assistant_message_started` / `_completed` | `id?`, `model?`, `provider?` |
| `assistant_message_error` | `error` |
| `text_delta` / `thinking_delta` | `delta` |
| `tool_call_started` | `toolCallId`, `toolName`, `rawInput?` |
| `tool_input_delta` | `toolCallId`, `toolName?`, `delta` |
| `tool_call_ready` | `toolCallId`, `toolName?` |
| `tool_running` | `toolCallId` |
| `tool_output_delta` | `toolCallId`, `toolName?`, `delta` |
| `tool_completed` | `toolCallId`, `toolName`, `output` |
| `tool_error` | `toolCallId`, `toolName`, `error` |
| `run_completed` | (no payload) |
| `run_failed` | `error` |
| `protocol_error` / `connection_error` | `error` |
| `environment_event` | `kind: string`, `payload?` (escape hatch / Pi passthrough) |

Helpers: `SESSION_EVENT_TYPES` (runtime enumeration), `isSessionEventType()`, and `sessionEventTypeToRunStatus()` which derives a coarse `AgentRunStatus` from an event type (e.g. `text_delta → "streaming"`, any tool event → `"using_tool"`, error events → `"error"`). The wire layer wraps events as `SessionEventMessage` `{ type: "session_event", sessionId, sequence, event }`, with inbound `UserEventMessage` `{ type: "user_event", event: { kind: "text_message", text } }` and `ack` / `error` envelopes.

## Realtime Session Rooms & Event Streaming (Server)

This subsystem turns a long-lived agent process into a multi-client realtime feed. Each agent session is wrapped in a **`SessionRoom`** (`agent-server-client/src/server/realtime/SessionRoom.ts`). A room owns the agent runtime, a sequenced/persisted event stream (`RoomEventStream`), and per-session environment state (`EnvironmentSessionState`). The **`SessionRoomManager`** tracks the live set of rooms keyed by session id, and a Fastify WebSocket route (`/api/ws`) connects clients to a room for replay + live streaming. The wire types are defined once in `agent-server-client/src/shared/realtime.ts` and imported by both server and client.

### Control / data flow

```
 agent process                EnvironmentManager
 (BaseAgent)                  (lifecycle signals)
      | setEventSink(event)        | onEnvironment{Offered,Entered,Exited,Resolved}
      v                            v
 +-----------------------------------------------+
 |                 SessionRoom                    |
 |  - currentRuntime: RoomRuntime                 |
 |  - environmentState: EnvironmentSessionState   |
 |  - queue: Promise<void>  (serializes run/rebuild)
 |  - idleTimer  (15s default -> onIdle)          |
 |        |                                       |
 |        v publish()/broadcast()                 |
 |  +-----------------------------------------+   |
 |  |          RoomEventStream                |   |
 |  |  sequence++, append to store, emit()    |   |
 |  |  subscribers: Set<RoomSubscriber>       |   |
 |  +-----------------------------------------+   |
 +-----------------------|------------------------+
                         | append/read
                         v
              SessionEventStore (JSONL on disk)
                         |
            replay (fromSequence) + live emit
                         v
        WebSocket clients  (/api/ws?sessionId&fromSequence)
```

### SessionRoom lifecycle

A room is created lazily via `SessionRoomManager.upsert(runtime)` (`SessionRoomManager.ts:24`), which is reached through `createOrReuseRoom` / `attachRoomToEnvironments` in `roomRuntime.ts`. Key lifecycle points:

- **Construction** (`SessionRoom.ts:40`): builds a `RoomEventStream` for the session id and immediately calls `scheduleIdleStop()`.
- **Event sink attach** (`attachRuntimeEventSink`, `SessionRoom.ts:70`): wires `agent.setEventSink(event => this.publishSessionEvent(event))` so every agent event flows into the stream. `upsert` calls this on create and on reuse, and `setRuntime` swaps the underlying runtime without recreating the room.
- **Running a turn** (`run`, `SessionRoom.ts:137`): user text is enqueued onto `this.queue` (a serial `Promise` chain) so runs and environment rebuilds never overlap. A thrown agent error is published as a `run_failed` session event rather than rejecting.
- **Idle reaping** (`SessionRoom.ts:178`): when subscriber count drops to zero, a timer (`options.idleTimeoutMs ?? 15_000` ms) fires `options.onIdle`. The manager's `onIdle` deletes the room from the map, notifies `onRoomRemoved`, and calls `room.stop()`. `subscribe`/`subscribeWithReplay` cancel any pending idle stop.
- **Stop** (`SessionRoom.ts:149`): sets `stopped`, cancels the idle timer, and stops the agent.

`RoomRuntime` is the swappable unit bound to a room:

```ts
export interface RoomRuntime {
  session: AgentSessionRecord;
  agentId: string;
  agent: BaseAgent;
}
export type RoomSubscriber = (event: OutboundRealtimeMessage) => void;
export type RuntimeRebuilder = (skillPaths: string[]) => Promise<RoomRuntime>;
```

### SessionRoomManager

`SessionRoomManager` (`SessionRoomManager.ts`) is the registry: `rooms: Map<string, SessionRoom>` keyed by `session.id`. It exposes `get`/`has`/`subscriberCount`, `upsert` (create-or-reattach), and `closeAll`. It is constructed in `index.ts:37` with the shared `SessionEventStore` and options `{ idleTimeoutMs, onRoomRemoved }`, where `onRoomRemoved` unsubscribes the session from the `EnvironmentManager`. `upsert` is the single entry point that guarantees exactly one room per session: an existing room is reused (runtime swapped + sink reattached) instead of duplicated.

### RoomEventStream — sequencing, persistence, replay

`RoomEventStream` (`RoomEventStream.ts`) is the heart of the realtime model:

- **Sequencing**: a monotonic `sequence` counter. On construction it `initialize()`s `sequence` from `eventStore.getLatestSequence(sessionId)` so restarts continue numbering rather than reset.
- **`publish(sessionEvent)`** (`RoomEventStream.ts:50`): increments `sequence`, wraps the event in a `SessionEventMessage` (`{ type:"session_event", sessionId, sequence, event }`), appends to the store, then emits to all in-memory subscribers. This is the durable path used for all agent events.
- **`broadcast(sessionEvent)`** (`RoomEventStream.ts:65`): emits to subscribers using the *current* sequence **without** incrementing or persisting. Used for transient signals that should reach connected clients but not be replayed (notably the post-rebuild environment lifecycle echoes from `SessionRoom.broadcastEnvironmentEvent`).
- **Ordering guarantee**: every mutating operation runs through `enqueueOperation`, a serial promise chain, so sequence increments and store appends cannot interleave even under concurrent publishes.
- **Replay**: `replay(fromSequence)` / `subscribeWithReplay(subscriber, fromSequence)` read all stored events with `sequence > fromSequence` and deliver them to the subscriber *before* adding it to the live set — combined with the operation queue, this closes the replay/live gap so a client misses no events and sees none twice.

`SessionEventStore` (`sessionEvents.ts`) persists each room's stream as newline-delimited JSON at `<sessionEventsRoot>/<sessionId>.jsonl` (default `<REPO_ROOT>/.var/agent-station/session-events`, overridable via `setSessionEventsRoot`). Appends are serialized per-session via `appendQueueBySession`; `read` waits for pending appends, parses the JSONL, and filters to `type === "session_event"`. `getLatestSequence` returns the last record's `sequence` or `0`.

### Environment session state per room

`EnvironmentSessionState` (`EnvironmentSessionState.ts`) tracks, per room: `baseSkillPaths`, a map of `environmentId -> skillPaths` for entered environments, a map of pending offers, and an optional `RuntimeRebuilder`. The `SessionRoom` implements `EnvironmentEventListener` (`environment/types.ts:31`); the `EnvironmentManager` pushes lifecycle calls:

| Listener call | State change | Stream effect |
|---|---|---|
| `onEnvironmentOffered` | `pendingEnvironmentOffers.set` | `broadcast` `environment_offer_available` |
| `onEnvironmentResolved` | `pendingEnvironmentOffers.delete` | `broadcast` `environment_offer_resolved` |
| `onEnvironmentEntered` | `environmentSkillPaths.set` | schedule runtime rebuild |
| `onEnvironmentExited` | `environmentSkillPaths.delete` | schedule runtime rebuild (only if present) |

**Runtime rebuild** (`SessionRoom.scheduleRuntimeRebuild`, `SessionRoom.ts:98`): on enter/exit, if a rebuilder is configured, a rebuild job is appended to the room's serial `queue`. It builds a fresh runtime from the union of base + per-environment skill paths (`currentSkillPaths()` dedups via `Set`), stops the previous agent, swaps the runtime, reattaches the event sink, and `broadcast`s the lifecycle kind. On failure it broadcasts `environment_exited` with an `error`. The rebuilder itself is supplied by `attachRoomToEnvironments` in `roomRuntime.ts:22`, which recreates the agent via `createAgent` with merged `skillPaths` and the parent-message tool extension.

**Pending-offer hydration**: when a new subscriber joins, `emitPendingEnvironmentOffers` (`SessionRoom.ts:163`) replays current pending offers as `session_event` messages stamped with `events.currentSequence`, so late-joining clients still see outstanding prompts. Offers/resolutions deliberately use `broadcast` (non-persisted) because their authoritative re-delivery is this pending-offer mechanism, not the replay log.

`EnvironmentEventStub` (`EnvironmentEventStub.ts`) is a thin `EnvironmentEventPublisher` adapter (`publish(sessionId, kind, payload)`) that forwards to an injected emit function; it is explicitly documented as a placeholder for future environment signals.

### Wire protocol (shared with the client)

Defined in `shared/realtime.ts` and re-exported by `realtime/types.ts`. Inbound (client→server) vs outbound (server→client):

```ts
// client -> server
type UserEventPayload = { kind: "text_message"; text: string };
type UserEventMessage  = { type: "user_event"; requestId?: string; event: UserEventPayload };

// server -> client
type SessionEventMessage = { type: "session_event"; sessionId: string; sequence: number; event: SessionEvent };
type AckEventMessage     = { type: "ack"; requestId?: string };
type ErrorEventMessage   = { type: "error"; requestId?: string; error: string };

type OutboundRealtimeMessage = SessionEventMessage | AckEventMessage | ErrorEventMessage;
type RealtimeMessage         = UserEventMessage | OutboundRealtimeMessage;
```

The WebSocket route (`routes/websocketRoute.ts`) requires `?sessionId=` and optional `?fromSequence=`. It rejects missing/invalid params or unknown sessions with an `error` message + close, then calls `room.subscribeWithReplay(send, fromSequence)`. Inbound messages must be `type:"user_event"` with `event.kind:"text_message"` and non-empty text; the server replies with an `ack` (echoing `requestId`) and calls `room.run(text)`. Any other shape yields an `error` message.

### SessionEvent taxonomy

`SessionEvent` (`shared/realtime.ts:20`) is a discriminated union on `type`; `environment_event` carries a free-form `kind`/`payload`. `SESSION_EVENT_TYPES` enumerates them and `isSessionEventType` guards strings. `sessionEventTypeToRunStatus` maps event types to `AgentRunStatus` for UI status (`status_changed`→`idle`, deltas→`thinking`/`streaming`, tool events→`using_tool`, failures→`error`).

| `type` | Payload shape (from `shared/agent.ts`) | Notes |
|---|---|---|
| `status_changed` | `AgentStatusChangedEvent` `{status, message?}` | maps to `idle` |
| `user_message` | `UserMessageAcceptedEvent` `{id?, text, queued?}` | accepted user turn |
| `assistant_message_started` | `AssistantMessageEvent` `{id?, model?, provider?}` | |
| `assistant_message_completed` | `AssistantMessageEvent` | |
| `assistant_message_error` | `AssistantMessageErrorEvent` `{error}` | |
| `text_delta` | `AgentTextDeltaEvent` `{delta}` | streaming text → `streaming` |
| `thinking_delta` | `AgentThinkingDeltaEvent` `{delta}` | → `thinking` |
| `tool_call_started` | `{toolCallId, toolName, rawInput?}` | → `using_tool` |
| `tool_input_delta` | `{toolCallId, toolName?, delta}` | → `using_tool` |
| `tool_call_ready` | `{toolCallId, toolName?}` | → `using_tool` |
| `tool_running` | `{toolCallId}` | → `using_tool` |
| `tool_output_delta` | `{toolCallId, toolName?, delta}` | → `using_tool` |
| `tool_completed` | `{toolCallId, toolName, output}` | → `using_tool` |
| `tool_error` | `{toolCallId, toolName, error}` | → `using_tool` |
| `run_completed` | _(none)_ | |
| `run_failed` | `AgentRunFailedEvent` `{error}` | synthesized by `SessionRoom.run` on throw; → `error` |
| `protocol_error` | `AgentProtocolErrorEvent` `{error}` | → `error` |
| `connection_error` | `AgentProtocolErrorEvent` `{error}` | → `error` |
| `environment_event` | `{kind: string; payload?: unknown}` | wraps environment lifecycle |

### Environment-event `kind` values

`environment_event` `kind`s are constants from `shared/environment.ts`; `environmentPayloadToSessionEvent` (`shared/realtime.ts:133`) converts an `EnvironmentEventPayload` into the `environment_event` SessionEvent.

| `kind` constant | Value | Emitted via |
|---|---|---|
| `ENVIRONMENT_OFFER_AVAILABLE_KIND` | `environment_offer_available` | `broadcast` (+ pending-offer hydration) |
| `ENVIRONMENT_OFFER_RESOLVED_KIND` | `environment_offer_resolved` | `broadcast` |
| `ENVIRONMENT_ENTERED_KIND` | `environment_entered` | `broadcast` after successful rebuild |
| `ENVIRONMENT_EXITED_KIND` | `environment_exited` | `broadcast` after rebuild / on rebuild error (with `error`) |

### Notable as-built behaviors

- **Persisted vs ephemeral**: only `publish` (agent events) increments sequence and writes to JSONL; environment offers/resolutions and post-rebuild echoes use `broadcast` and are re-delivered to new clients only through `emitPendingEnvironmentOffers`, not through replay.
- **Single serial queue per room** governs both agent `run`s and environment rebuilds, so an environment change cannot tear a runtime out from under an in-flight turn.
- **`configureRuntime` is one-shot** (`EnvironmentSessionState.ts:19`): once a rebuilder is set it is not overwritten, so the first `attachRoomToEnvironments` for a session wins.
- **Sequence continuity across restart** is provided by reading `getLatestSequence` from disk at stream init, making `fromSequence` cursors durable across server restarts.

## Environment Manager & Repository (Server)

### What an "environment" is

In Agent Station an **environment** is an external context that a provider (a browser extension, a demo script, or any HTTP client) can declare the user to be "in." When an environment is active and approved, its **skill bundle**—a directory of one or more Claude skills (`SKILL.md` + reference files)—is loaded into the agent runtime, changing the agent's behavior for that session. The shipped examples are `demo:demo` (a pirate joke-telling skill) and `web:wikipedia` (a Wikipedia-navigation skill that drives a split-pane browser extension via `message_parent`/`url_change`).

An environment is identified by a string of the form `kind:path` (e.g. `demo:demo`, `web:wikipedia`). The colon splits the id into a `kind` and an `envPath`, which map directly onto the on-disk layout `environment-repository/<kind>/<envPath>/` (`LocalEnvironmentRepository.resolveEnvironmentDir`, `LocalEnvironmentRepository.ts:35`).

```
environment-repository/
  demo/demo/                     <- environment id "demo:demo"
    joke-telling/SKILL.md        <- one skill in the bundle
  web/wikipedia/                 <- environment id "web:wikipedia"
    wikipedia-discovery/
      SKILL.md
      references/topic-search.md
      references/article-next-steps.md
```

The core data types (`agent-server-client/src/server/environment/types.ts`, `src/shared/environment.ts`):

```typescript
interface EnvironmentRecord {
  id: string;                          // "kind:path"
  metadata: Record<string, unknown>;
}

interface EnvironmentOfferInfo {
  sourceName?: string;
  canonicalSourceUrl?: string;
}

// The 2×2 decision model: positive/negative × this-visit/permanent.
type EnvironmentDecision  = "accept" | "approve" | "ignore" | "reject";
type PersistentDecision   = "approve" | "reject";   // stored in SQLite
type EphemeralDecision    = "accept" | "ignore";    // in-memory only
type EffectiveDecision    = EnvironmentDecision | "undecided";
type EnvironmentResolution = "approved" | "dismissed" | "unavailable";
```

### The three orthogonal concepts

`EnvironmentManager` (`EnvironmentManager.ts:33`) is the service-layer coordinator. Its docstring names three orthogonal concepts it tracks, each in its own `Map`:

| Concept | Scope | Storage | Meaning |
|---|---|---|---|
| **available** | global, in-memory | `available: Map<id, AvailableEnvironment>` | A provider says this env is currently "around." |
| **decision** | per-environment, global | `ephemeral: Map<id, EphemeralDecision>` + `EnvironmentDecisionStore` (SQLite) | The 2×2 choice. Ephemeral overrides persistent. |
| **entered** | per-session, derived | `entered: Map<sessionId, Set<id>>` | A room has an env iff it is *available* AND the effective decision is accept/approve. |

The manager **never touches runtimes or sockets**. It pushes lifecycle calls to subscribed `SessionRoom`s (one `EnvironmentEventListener` per room, keyed by `sessionId` in `listeners`), which translate them into runtime rebuilds and client broadcasts.

```typescript
interface EnvironmentEventListener {
  onEnvironmentOffered(environmentId: string, info: EnvironmentOfferInfo): void;
  onEnvironmentEntered(environmentId: string, skillPaths: string[]): void;
  onEnvironmentExited(environmentId: string): void;
  onEnvironmentResolved(environmentId: string, resolution: EnvironmentResolution): void;
}
```

### The 2×2 approval decision flow

`decideEnvironment(id, decision)` (`EnvironmentManager.ts:71`) routes the four decisions along two axes—**positive vs. negative** and **this-visit (ephemeral) vs. permanent (persistent)**:

| Decision | Axis | Persistence | Effect |
|---|---|---|---|
| `accept` | positive | ephemeral (in-memory `ephemeral` map) | Enter now; cleared when env goes unavailable. |
| `approve` | positive | persistent (`EnvironmentDecisionStore.setDecision`) | Enter now and on every future episode; clears any ephemeral override. |
| `ignore` | negative | ephemeral | Exit/skip for this visit only. |
| `reject` | negative | persistent | Exit and stay out across episodes; clears ephemeral. |

`effectiveDecision(id)` (`EnvironmentManager.ts:87`) resolves the live answer: **ephemeral (this-visit) wins over persistent (approve/reject)**; if neither exists, the result is `"undecided"`.

`applyEnvironmentToSession` (`EnvironmentManager.ts:125`) is the single place that turns an effective decision into a listener call, for one env in one room:

```
effectiveDecision        listener call
-----------------        -------------------------
approve | accept    -->  onEnvironmentEntered(id, skillPaths)   (idempotent: see `entered` set)
ignore  | reject    -->  onEnvironmentExited(id)
undecided           -->  onEnvironmentOffered(id, info)         (prompt the user)
```

`enterForSession`/`exitForSession` guard against duplicate enter/exit by checking the per-session `entered` set, so re-applying the same decision is a no-op.

`EnvironmentDecisionStore` (`EnvironmentDecisionStore.ts`) is the only place SQL lives. It is backed by Node's built-in `node:sqlite` (`DatabaseSync`), defaulting to a gitignored file at `.var/agent-station/environment-decisions.sqlite` (or `:memory:` for tests). Single table, upsert on conflict:

```sql
CREATE TABLE IF NOT EXISTS environment_decisions (
  environment_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  updated_at TEXT NOT NULL
)
```

Only persistent decisions (`approve`/`reject`) are stored here; ephemeral `accept`/`ignore` live solely in the manager's memory and are dropped on `markUnavailable`.

### Availability lifecycle and fan-out

```
                    ┌──────────────────────────────────────────────────┐
 provider           │              EnvironmentManager                  │
 (extension /        │  available  ephemeral  entered  listeners(rooms) │
  inject script)     └───────┬──────────────────────────┬──────────────┘
       │                     │                           │
       │ POST /register      │  for each open room:      │ onEnvironmentEntered / Offered / Exited
       ├────────────────────►│  applyEnvironmentToSession├──────────────► SessionRoom (listener)
       │ POST /decision      │                           │                    │
       ├────────────────────►│                           │                    ▼
       │ POST /unavailable   │                           │            rebuild runtime + broadcast
       └────────────────────►│  delete available+ephem,  │            over websocket to clients
                             │  exit + onResolved        │
```

- `registerAvailableEnvironment(env, info)` (`EnvironmentManager.ts:47`): resolves the env's skill paths from the repository, stores it in `available`, then re-applies it to **every** open room. Availability and decisions are **global**—they apply to all sessions.
- `markUnavailable(id)` (`EnvironmentManager.ts:56`): removes the env from `available` and clears its ephemeral decision, then for every room calls `exitForSession` and `onEnvironmentResolved(id, "unavailable")` to close any open prompts. (Persistent approve/reject in SQLite survives.)
- `subscribe(sessionId, listener)` (`EnvironmentManager.ts:95`): registers a room and immediately replays every currently-available env through `applyEnvironmentToSession`, so a newly-opened room gets offers/enters for already-active environments. `unsubscribe` (called from `index.ts:39` via the room manager's `onRoomRemoved`) drops both the listener and the room's `entered` set.

### How skill bundles are resolved (LocalEnvironmentRepository)

`LocalEnvironmentRepository` (`LocalEnvironmentRepository.ts`) reads skill content from disk under `REPO_ROOT/environment-repository` (overridable via constructor `root`).

- `getSkillPaths(id)` (`:16`): resolves `kind:path` → `<root>/<kind>/<path>`, returns `[dir]` if it exists, else `[]`. These directory paths are what the manager passes to `onEnvironmentEntered`; the agent runtime treats each as a skill-search root.
- `getSkillPreviews(id)` (`:27`): for each bundle path, reads every immediate subdirectory that contains a `SKILL.md`, recursively collecting all files under it into a `Record<relativePath, content>` (`collectFiles`, `:73`). File keys are prefixed with the skill directory name (e.g. `wikipedia-discovery/SKILL.md`, `wikipedia-discovery/references/topic-search.md`). Results are sorted by name.

```typescript
interface SkillPreview {
  id: string;
  name: string;
  files: Record<string, string>;  // relativePath -> file content
}
```

### Skill previewing

Previews exist so the approval UI can show the user exactly what skills an environment would inject before they approve. There are two paths to a `SkillPreview[]`:

1. **Server-side, from disk** — `GET /api/environments/preview?environmentId=...` (`environmentRoutes.ts:54`) → `EnvironmentManager.getSkillPreviews` → `LocalEnvironmentRepository.getSkillPreviews`, returning `{ environmentId, skills }`. Here grouping is structural: each subdirectory containing `SKILL.md` is one preview.
2. **Shared regrouping helper** — `groupSkillsForPreview(skills)` (`src/shared/environmentSkillPreview.ts`) takes an already-flat `Record<path, content>` and regroups it into `SkillPreview[]`. The skill id is the first path segment, except when a file ends in `SKILL.md` with ≥2 segments, in which case the id is the directory immediately containing `SKILL.md`. Used where flat skill maps arrive over the wire rather than from the local repo.

The client renders these in `EnvironmentApprovalModal.tsx` with `environment-approval.css`.

### inject-environment flow end-to-end

`scripts/inject-environment.sh` is a thin curl wrapper used to drive the environment lifecycle against a running dev server (`AGENT_STATION_URL`, default `http://127.0.0.1:3000`). It exercises the three POST routes in `environmentRoutes.ts`:

| Route | Handler call | Validation |
|---|---|---|
| `POST /api/environments/register` | `registerAvailableEnvironment({id, metadata}, {sourceName, canonicalSourceUrl})` | `id` non-empty string; `metadata` must be a plain object if present |
| `POST /api/environments/unavailable` | `markUnavailable(id)` | `id` non-empty string |
| `POST /api/environments/decision` | `decideEnvironment(environmentId, decision)` | `decision ∈ {accept, approve, ignore, reject}` |
| `GET /api/environments/preview` | `getSkillPreviews(environmentId)` | `environmentId` non-empty |

End-to-end, for `./scripts/inject-environment.sh --decide accept demo:demo`:

```
1. script POSTs /register {id:"demo:demo"}
2. EnvironmentManager.registerAvailableEnvironment:
     - repository.getSkillPaths("demo:demo") -> ["<repo>/environment-repository/demo/demo"]
     - available.set("demo:demo", {record, skillPaths, info})
     - for each open room: applyEnvironmentToSession
         effectiveDecision = "undecided"  -> listener.onEnvironmentOffered
           -> SessionRoom.onEnvironmentOffered -> EnvironmentSessionState.offer
              -> broadcast ENVIRONMENT_OFFER_AVAILABLE to that room's websocket clients
3. script POSTs /decision {environmentId:"demo:demo", decision:"accept"}
4. EnvironmentManager.decideEnvironment("accept"):
     - ephemeral.set("demo:demo","accept")             (not persisted)
     - for each open room:
         applyEnvironmentToSession -> effectiveDecision "accept"
           -> enterForSession -> listener.onEnvironmentEntered(id, skillPaths)
         onEnvironmentResolved(id, "approved")          (close the prompt)
5. SessionRoom.onEnvironmentEntered (SessionRoom.ts:88):
     - EnvironmentSessionState.enter(id, skillPaths)
     - scheduleRuntimeRebuild(ENVIRONMENT_ENTERED_KIND): on the room's serialized queue,
         rebuild agent with currentSkillPaths() = base ∪ all entered env skill paths,
         stop the previous agent, swap in the new runtime, re-attach the event sink,
         broadcast ENVIRONMENT_ENTERED to clients.
```

The runtime rebuild itself is wired in `roomRuntime.ts`: `attachRoomToEnvironments` (`:22`) installs a `RuntimeRebuilder` that calls `createAgent` with the union of skill paths plus the `parentMessageToolExtension` (only when any skills are present), then `environmentManager.subscribe(room.sessionId, room)`. `EnvironmentSessionState.currentSkillPaths()` (`EnvironmentSessionState.ts:59`) computes `base ∪ entered` and de-dups. Newly-connecting websocket subscribers replay any still-pending offers via `pendingOfferMessages` so late joiners see the approval prompt.

Choosing `approve` instead of `accept` additionally writes the row to SQLite via `EnvironmentDecisionStore.setDecision`, so the env auto-enters on future availability episodes without re-prompting. `--unavailable` tears the episode down: skills are removed (`onEnvironmentExited` → runtime rebuild without the env's paths) and ephemeral state is forgotten, but persistent approve/reject remains.

### Demo vs. web subfolders

`environment-repository/demo/` and `environment-repository/web/` are **not** separate applications—they are the two `kind` namespaces of the skill repository tree. `demo/demo/` backs the `demo:demo` environment (the `joke-telling` skill), and `web/wikipedia/` backs `web:wikipedia` (the `wikipedia-discovery` skill, which coordinates a browser split-pane extension through `message_parent` `url_change` messages, per its `SKILL.md`).

## HTTP/WebSocket API Surface & Server Bootstrap

The HTTP/WS surface lives in the `agent-server-client` package under `src/server/`. A single Fastify instance is constructed by `buildServer()` and serves three concerns: a JSON REST API under `/api/*`, one WebSocket endpoint at `/api/ws`, and the browser SPA (Vite dev middleware or static `dist`).

### Server bootstrap (`src/server/index.ts`)

`buildServer(options)` (`index.ts:30`) wires the dependency graph and registers route plugins in a fixed order:

```ts
export interface BuildServerOptions {
  enableClient?: boolean;
  logger?: Parameters<typeof fastify>[0]["logger"];
  roomIdleTimeoutMs?: number;
  /** SQLite location for persistent environment decisions; ":memory:" in tests. */
  environmentDecisionStoreLocation?: string;
}
```

Construction sequence (`index.ts:31-56`):

```
buildServer()
  ├─ fastify({ logger })                        # logger defaults to true
  ├─ new SessionEventStore()                    # per-session event persistence/replay
  ├─ new LocalEnvironmentRepository()
  ├─ new EnvironmentDecisionStore(location)     # SQLite (":memory:" in tests)
  ├─ new EnvironmentManager(repo, decisionStore)
  ├─ new SessionRoomManager(eventStore, {
  │      idleTimeoutMs,
  │      onRoomRemoved: (sessionId) =>          # room teardown unsubscribes env mgr
  │          environmentManager.unsubscribe(sessionId)
  │   })
  ├─ register(@fastify/websocket)
  ├─ addHook("onClose") -> roomManager.closeAll()
  ├─ registerAgentRoutes(app, { roomManager, environmentManager, sessionEventStore })
  ├─ registerEnvironmentRoutes(app, environmentManager)
  ├─ registerWebsocketRoute(app, roomManager)
  └─ if enableClient: registerClientApp(app)    # default enableClient = true
```

`.env` is loaded from `REPO_ROOT` at module load (`index.ts:17`). When the module is the process entrypoint (`index.ts:59-65`), it calls `app.listen({ host, port })`.

| Config | Source | Default |
| --- | --- | --- |
| `HOST` | `process.env.HOST` | `127.0.0.1` |
| `PORT` | `process.env.PORT` (`Number(...)`) | `3000` |
| `NODE_ENV` | drives prod static vs Vite dev, and extension `.ts`/`.js` path | (unset = dev) |
| `enableClient` | option | `true` |
| `roomIdleTimeoutMs` | option -> `SessionRoomManager` | manager default |
| `environmentDecisionStoreLocation` | option -> `EnvironmentDecisionStore` | impl default |

`buildServer` returns the un-listened Fastify app, which makes it directly injectable in tests (with `enableClient: false` and `:memory:` decision store).

### Path resolution (`src/server/paths.ts`, `serverPaths.ts`)

`paths.ts` resolves package roots at runtime rather than hardcoding. `findAgentClientRoot()` (`paths.ts:7`) walks up from the compiled server directory looking for a `package.json` whose `name === "agent-server-client"`, falling back to `../..`. It exports `AGENT_CLIENT_ROOT` (package root) and `REPO_ROOT` (its parent, the monorepo root). `serverPaths.ts` exports `isProduction = process.env.NODE_ENV === "production"` and the resolved `parentMessageToolExtensionPath` (`.js` in prod, `.ts` in dev).

### REST route table

All routes are registered directly on the Fastify root (no prefix plugin); every path is literal. Agent routes are in `routes/agentRoutes.ts`, environment routes in `routes/environmentRoutes.ts`.

| Method | Path | Source | Purpose / Behavior |
| --- | --- | --- | --- |
| GET | `/api/health` | `agentRoutes.ts:15` | Liveness. Returns `{ ok: true, service: "agent-station" }`. |
| GET | `/api/agents` | `agentRoutes.ts:16` | Lists discovered agent definitions: `{ agents: getAgentDefinitions() }`. |
| GET | `/api/agent/sessions?agent=<id>` | `agentRoutes.ts:18` | Session records for an agent (from `readSessionRecords()`), filtered by `agent`, each annotated with `running` (`roomManager.has`) and `connectedClients` (`roomManager.subscriberCount`). Rejects unknown agent with 400. |
| GET | `/api/agent/session/recent` | `agentRoutes.ts:32` | Most recent session record (index 0) with the same `running`/`connectedClients` annotation, or `{ session: null }`. |
| POST | `/api/agent/start` | `agentRoutes.ts:44` | Starts/reuses a SessionRoom for an agent (see below). |
| POST | `/api/environments/register` | `environmentRoutes.ts:6` | Registers an available environment: `environmentManager.registerAvailableEnvironment({ id, metadata }, { canonicalSourceUrl?, sourceName? })`. Validates `id` (non-empty string) and `metadata` (object, non-array). |
| POST | `/api/environments/unavailable` | `environmentRoutes.ts:29` | Marks an environment unavailable: `environmentManager.markUnavailable(id)`. |
| POST | `/api/environments/decision` | `environmentRoutes.ts:39` | Records a decision for an environment. `decision` must be one of `accept`/`approve`/`ignore`/`reject`; calls `environmentManager.decideEnvironment(...)`. |
| GET | `/api/environments/preview?environmentId=<id>` | `environmentRoutes.ts:54` | Returns skill previews: `{ environmentId, skills }` via `environmentManager.getSkillPreviews(id)`. |
| GET | `/api/ws` | `websocketRoute.ts:7` | WebSocket upgrade (see WebSocket section). |

#### `POST /api/agent/start` request/response

Request body (`agentRoutes.ts:44`):

```ts
{
  agent: string;                 // required, must pass isKnownAgent()
  session?: AgentSessionRecord;  // optional existing session to reuse/restart
  sessionName?: string;          // trimmed; "" -> "default"; used when no session
  includeReplayEvents?: boolean; // also implied true when `session` provided
  restartExisting?: boolean;     // === true forces restart of an existing room
}
```

Flow:
1. `rejectUnknownAgent(agent, reply)` (`serverHelpers.ts:4`) — 400 `{ error: "Unknown agent" }` if not a known agent.
2. If `session` is present it must satisfy `isSessionRecord` (`serverHelpers.ts:12`: requires string `id`, `agent`, `createdAt` and an object `restart`) else 400 `Invalid session`; and `session.agent` must equal `agent` else 400 `Session does not match agent`.
3. `createOrReuseRoom({ agentId, roomManager, environmentManager, session, sessionName, restartExisting })` (from `roomRuntime.ts`) creates or reuses the room.
4. If `includeReplayEvents` (explicit `true` OR `session !== undefined`), reads `sessionEventStore.readSessionEvents(room.session.id)`.

Response: `{ ok: true, agent, session: room.session, replayEvents? }`.

Validation helpers live in `serverHelpers.ts`; routes do manual `typeof`/shape checks rather than schema validation, returning `reply.code(400).send({ error })` on failure.

### WebSocket endpoint & SessionRoom bridge (`routes/websocketRoute.ts`)

`GET /api/ws` is registered with `{ websocket: true }` (requires the `@fastify/websocket` plugin registered in bootstrap). It is the single full-duplex channel between a browser client and a `SessionRoom`.

Query params:

| Param | Parsing | Failure |
| --- | --- | --- |
| `sessionId` | trimmed string | empty -> send `error` "Missing sessionId" + close |
| `fromSequence` | `parseFromSequence` (`serverHelpers.ts:18`): `undefined -> 0`, otherwise a non-negative integer | `null` (invalid) -> send `error` "Invalid fromSequence" + close |

Connection setup (`websocketRoute.ts:21-50`):
- `roomManager.get(sessionId)` — if no live room, send `error` "Unknown or inactive session" + close. The room must already exist (created via `/api/agent/start`); the socket does not lazily start agents.
- `room.subscribeWithReplay(subscriber, fromSequence)` (`SessionRoom.ts:126`) replays persisted events from `fromSequence` then streams live events. Each event is `JSON.stringify`'d and sent (only when `socket.readyState === OPEN`). The returned `unsubscribe` is stored; if the socket already closed before the async subscribe resolved (`closed` flag), it unsubscribes immediately. Subscribe failure sends `{ type: "error", error }` and closes.

```
browser ──WS /api/ws?sessionId&fromSequence──▶ websocketRoute
                                                  │
                          subscribeWithReplay ────▼──────────────┐
   ◀── session_event (replayed seq >= fromSequence) ── SessionRoom│
   ◀── session_event (live, JSON.stringify)  ──────── EventStore  │
                                                  ▲               │
   ── user_event {text_message} ──▶ validate ──▶ room.run(text) ──┘
   ◀── ack {requestId?}
```

Inbound message handling (`websocketRoute.ts:52-78`) — only one inbound shape is accepted:
- Parse JSON to `UserEventMessage`; parse error -> `error` message (no close).
- `message.type` must be `"user_event"` else `error` "Unsupported message type" (echoes `requestId`).
- `message.event.kind` must be `"text_message"` else `error` "Unsupported user_event kind".
- `event.text` trimmed; empty -> `error` "Missing text".
- On success: send `{ type: "ack", requestId? }` then fire-and-forget `room.run(text)` (`SessionRoom.ts:137`, which queues the agent run and emits a `run_failed` event on throw).

On `close`/`error` events the handler sets `closed = true` and calls `unsubscribe()`.

The message envelopes are defined in `src/shared/realtime.ts` (shared by server and client):

```ts
export type UserEventMessage = {
  type: "user_event";
  requestId?: string;
  event: UserEventPayload;            // { kind: "text_message"; text: string }
};

export type SessionEventMessage = {
  type: "session_event";
  sessionId: string;
  sequence: number;
  event: SessionEvent;                // discriminated union of run/tool/env events
};

export type AckEventMessage   = { type: "ack"; requestId?: string };
export type ErrorEventMessage = { type: "error"; requestId?: string; error: string };

export type OutboundRealtimeMessage = SessionEventMessage | AckEventMessage | ErrorEventMessage;
```

`SessionEvent` (`shared/realtime.ts:19`) is the streamed payload union — status, user/assistant messages, `text_delta`/`thinking_delta`, the full tool lifecycle (`tool_call_started`, `tool_input_delta`, `tool_call_ready`, `tool_running`, `tool_output_delta`, `tool_completed`, `tool_error`), `run_completed`/`run_failed`, `protocol_error`/`connection_error`, and `environment_event`. `SESSION_EVENT_TYPES` enumerates them and `sessionEventTypeToRunStatus()` maps each to an `AgentRunStatus`.

Note: the route layer wraps replayed/live `SessionEvent`s emitted by the room; the manager/room (`SessionRoomManager`, `SessionRoom`) own sequencing, replay from `SessionEventStore`, and idle teardown (`onIdle` removes the room and triggers `onRoomRemoved`).

### Static client serving (`src/server/clientApp.ts`)

`registerClientApp(app)` branches on `isProduction`:

- Production (`clientApp.ts:10-23`): registers `@fastify/static` rooted at `AGENT_CLIENT_ROOT/dist/client` with prefix `/`, plus a SPA `setNotFoundHandler` — GET requests that `Accept: text/html` get `index.html` (client-side routing fallback); everything else gets a 404 JSON `{ error: "Not found" }`.
- Development (`clientApp.ts:26-37`): registers `@fastify/middie`, creates a Vite dev server in `middlewareMode` (`appType: "spa"`, root `AGENT_CLIENT_ROOT`, config `vite.config.ts`), and installs middleware that passes `/api/*` through to Fastify (`next()`) while letting Vite handle all other URLs (HMR, module transforms, SPA serving).

### `message_parent` tool extension (`src/server/extensions/parentMessageTool.ts`)

A pi-coding-agent micro extension (default export `parentMessageToolExtension(pi: ExtensionAPI)`) that registers one tool:

| Field | Value |
|---|---|
| `name` | `message_parent` |
| `label` | "Message parent page" |
| `parameters` | `Type.Object({ message: Type.Any() })` (typebox) — JSON-serializable payload |

Its `execute()` is intentionally a no-op bridge: it always returns `{ content: [{ type: "text", text: "message sent" }], details: {} }`. Delivery is performed browser-side — the Agent Station SPA watches the pi tool-call stream for the `message_parent` tool name, extracts the `message` JSON from the tool arguments, and relays it to the embedding/host page via `postMessage`. The tool reports success unconditionally so the model never blocks on browser relay timing. The file is `@ts-nocheck` and is loaded via `parentMessageToolExtensionPath` from `serverPaths.ts` (resolving `.ts` in dev, `.js` in prod).

## React Client UI (the :3000 app)

The browser client is a single-page React app served from `agent-server-client/index.html`, which mounts a `<div id="root">` and loads `/src/client/main.tsx`. `main.tsx` simply creates a React root in `StrictMode` and renders `<App/>` (`agent-server-client/src/client/main.tsx:6-10`). All UI class names are prefixed `cwa-` (the product surface is branded "Agent Station" in the header, but code identifiers keep the `cwa-` prefix and the `RemoteAgent` defaults to backend `"PiAgent"`).

The app talks to the server two ways:
- **REST/HTTP** for control-plane reads and decisions (`/api/agents`, `/api/agent/sessions`, `/api/agent/session/recent`, `/api/agent/start`, `/api/environments/preview`, `/api/environments/decision`).
- **A per-session WebSocket** (`/api/ws?sessionId=...`) over which the server streams ordered `session_event` frames that render incrementally into the thread.

### Screen flow and navigation state machine

`App.tsx` owns the top-level screen as a discriminated union (`App.tsx:20-23`):

```typescript
type AppScreen =
  | { type: "agent-selection" }
  | { type: "session-selection"; agent: AgentDefinition }
  | { type: "chat"; agentId: AgentBackend; session: AgentSessionSummary; viewKey: number };
```

`viewKey` (from `chatViewKeyRef`, incremented on every successful start, `App.tsx:42,60`) is used as the React `key` on `<ChatScreen>` so that starting/resuming any session force-remounts the chat subtree and resets all reducer state.

```
                         ┌──────────────────────────────────┐
   fetchAgentDefinitions │        agent-selection           │
   ───────────────────►  │  (AgentSelectionScreen)          │
                         │   • "New" → NewSessionDialog      │
                         │   • "Continue" → openSessionSel.  │
                         └───────┬───────────────┬──────────┘
              onNewSession(name) │               │ onContinueSession(agent)
                  startAgent(    │               │  setScreen(session-selection)
                   undefined,    │               │  + fetchAgentSessions(agent.id)
                   {sessionName})▼               ▼
                ┌───────────────────┐   ┌──────────────────────────┐
                │   start() POST    │   │   session-selection      │
                │ /api/agent/start  │   │ (SessionSelectionScreen) │
                └─────────┬─────────┘   │  list of past sessions   │
                          │             │  onSelectSession ────────┼─► startAgent(agentId, session)
                          │             │  onBack ─────────────────┼─► agent-selection
                          ▼             └──────────────────────────┘
                ┌──────────────────────────────────────────────┐
                │                    chat                       │
                │  (ChatScreen → ChatPanel, keyed by viewKey)   │
                │  header "Sessions" button → agent-selection   │
                └──────────────────────────────────────────────┘
```

`startAgent` (`App.tsx:44-72`) is the single entry into chat: it constructs a `RemoteAgent`, calls `.start()` (the HTTP POST), and on success transitions to `{ type: "chat", ... }`. Errors are caught into `startupError` and surfaced on the originating screen. `startingAgent` holds the in-flight backend id so screens can disable buttons / show "Starting…".

**Auto-resume:** after agent definitions load, a one-shot effect (guarded by `initialResumeAttemptedRef`, `App.tsx:102-121`) calls `fetchMostRecentSession()` and, if one exists, immediately `startAgent`s it — so a returning user lands straight in their last chat.

The header (`App.tsx:169-186`) always shows an "Agent Station" title; in chat it shows a computed label (`screenLabel`: `agentName` or `agentName · sessionName`) plus a **Sessions** button that returns to `agent-selection`.

| Screen (`type`) | Component | Entered by | Exits to |
|---|---|---|---|
| `agent-selection` | `AgentSelectionScreen` | initial / header "Sessions" / session "Back" | `session-selection`, `chat` (via New) |
| `session-selection` | `SessionSelectionScreen` | "Continue" on an agent | `agent-selection` (Back), `chat` (select) |
| `chat` | `ChatScreen` → `ChatPanel` | `startAgent` success | `agent-selection` (Sessions) |

### Agent / session selection screens

`AgentSelectionScreen` (`screens/AgentSelectionScreen.tsx`) renders agents as a **recursive tree** keyed off `AgentDefinition.parentId` (`childAgents`, `AgentRows` recurse with `depth+1`, indenting with a `└─` branch glyph). Each row has **New** and **Continue** buttons. **New** opens an in-screen `NewSessionDialog` (modal `role="dialog"`) prompting for a session name (default `"default"`), then calls `onNewSession(agentId, sessionName)`. An optional `EnvironmentSkillsNotice` lists previously-approved environment skills that will be added on resume.

`SessionSelectionScreen` (`screens/SessionSelectionScreen.tsx`) lists `AgentSessionSummary[]` as buttons showing name, localized `createdAt`, and a running/stopped pill (`${connectedClients} connected` vs `Stopped`, derived from `session.running`). Selecting calls `onSelectSession(agentId, session)` → `startAgent`.

`ChatScreen` (`screens/ChatScreen.tsx`) is a thin pass-through that renders `<ChatPanel>` with the agent backend, the started session, the parent-message poster, and the two environment-offer callbacks.

### RemoteAgent: the server client

`remoteAgent.ts` contains both the stateless REST helpers and the stateful `RemoteAgent` class. The REST helpers each `fetch` a JSON endpoint and throw on non-2xx:

| Function | Endpoint | Returns |
|---|---|---|
| `fetchAgentDefinitions()` | `GET /api/agents` | `AgentDefinition[]` |
| `fetchAgentSessions(agent)` | `GET /api/agent/sessions?agent=` | `AgentSessionSummary[]` |
| `fetchMostRecentSession()` | `GET /api/agent/session/recent` | `AgentSessionSummary \| null` |
| `fetchEnvironmentPreview(id)` | `GET /api/environments/preview?environmentId=` | `EnvironmentPreview` |
| `decideEnvironment(id, decision)` | `POST /api/environments/decision` | `void` (throws `payload.error` on failure) |

`RemoteAgent` (`remoteAgent.ts:78-242`) manages the start handshake plus the WebSocket lifecycle:

```typescript
export interface RemoteAgentOptions {
  startEndpoint?: string;  // default "/api/agent/start"
  wsEndpoint?: string;     // default "/api/ws"
  backend?: AgentBackend;  // default "PiAgent"
  session?: AgentSessionSummary;
  sessionName?: string;
  includeReplayEvents?: boolean;
  restartExisting?: boolean;
  onSessionEvent?: (event: SessionEvent) => void;
}
```

Control flow:
1. **`start()`** POSTs `{ agent, session?, sessionName?, includeReplayEvents?, restartExisting? }` to `/api/agent/start`, stores the returned `session`, and returns `RemoteAgentStartResult { ok, agent, session, replayEvents? }`. On HTTP failure it emits a synthetic local `connection_error` event and throws.
2. **`connect()`** lazily `start()`s if there's no session, then opens a WebSocket whose URL is built by `websocketUrl()` — it flips `http(s)→ws(s)`, sets `sessionId`, and (for reconnects) `fromSequence` = `lastSequence` so the server can replay only newer events (`remoteAgent.ts:68-76,136`). Concurrent connects share one `connectPromise`.
3. **`run(userMessage)`** ensures the socket is open, then sends `{ type: "user_event", requestId: "user-event-N", event: { kind: "text_message", text } }` and returns a promise tracked in `pendingRuns`, resolved when a `run_completed`/`run_failed` `session_event` arrives.

Inbound frames are `OutboundRealtimeMessage` (`shared/realtime.ts:130`), one of three `type`s:

| Inbound `type` | Handling (`handleMessage`, `remoteAgent.ts:225-241`) |
|---|---|
| `session_event` | advance `lastSequence = max(...)`; forward `event` to `onSessionEvent`; resolve a pending run on `run_completed`/`run_failed` |
| `ack` | no-op |
| `error` | emit local `connection_error`, reject the head pending run |

Outbound is a single `UserEventMessage` shape; the only `UserEventPayload` today is `{ kind: "text_message", text }`. Socket `error`/`close` events emit synthetic `connection_error` events and reject outstanding runs (unless `close()` was called intentionally, which sets `closed`).

### Streamed events → block taxonomy

`ChatPanel` (`components/ChatPanel.tsx`) is the heart of the UI. It holds state via `useReducer` over `State { blocks, isAgentProcessing, status, queuedMessages }`. `applyServerEvent` (`ChatPanel.tsx:303-397`) maps each incoming `SessionEvent.type` to a reducer `Action`, building a flat `Block[]`. The block union (`types.ts`):

```typescript
type Block = UserMessageBlock | ThinkingBlock | AgentTextBlock | ToolBlock | ErrorBlock;

interface ToolBlock {
  type: "toolBlock"; id: string; name: string;
  status: "input_streaming" | "ready" | "running" | "completed" | "error";
  arguments: string; argumentsStreaming: boolean;
  result: string | null; isError: boolean;
}
interface ErrorBlock {
  type: "error";
  source: "assistant" | "tool" | "protocol" | "connection" | "run";
  message: string;
}
```

Streaming accretion rules in the reducer (`ChatPanel.tsx:83-256`):

| Server event | Reducer action | Block effect |
|---|---|---|
| `status_changed` | `STATUS_CHANGED` | sets status line; `isAgentProcessing` = status ∉ {idle,error} |
| `user_message` | `USER_MESSAGE_ACCEPTED` | append `UserMessageBlock` |
| `text_delta` | `TEXT_DELTA` | append to last streaming assistant text block, else push new |
| `thinking_delta` | `THINKING_DELTA` | append to last streaming thinking block, else push new |
| `tool_call_started` | `TOOL_CALL_STARTED` | push `ToolBlock` (status `input_streaming`); dedupe by id |
| `tool_input_delta` | `TOOL_INPUT_DELTA` | append to `arguments` of matching tool block |
| `tool_call_ready` | `TOOL_CALL_READY` | status→`ready`, `argumentsStreaming=false` |
| `tool_running` | `TOOL_RUNNING` | status→`running` |
| `tool_output_delta` | `TOOL_OUTPUT_DELTA` | status→`running`, set `result` |
| `tool_completed` | `TOOL_COMPLETED` | status→`completed`, `result=output` |
| `tool_error` | `TOOL_ERROR` | status→`error`, `isError=true` |
| `assistant_message_completed` | `ASSISTANT_MESSAGE_COMPLETED` | `finalizeStreamingBlocks` (clear cursors) |
| `run_completed` | `RUN_COMPLETED` | finalize; status→idle/queued; drains queue |
| `run_failed` / `protocol_error` / `connection_error` | `RUN_FAILED` (source `run`/`protocol`/`connection`) | finalize + append `ErrorBlock` |

Tool blocks are matched by `findLastIndex` on `id` (`updateLastToolBlock`, `ChatPanel.tsx:75-81`). `finalizeStreamingBlocks` (`ChatPanel.tsx:64-73`) clears `isStreaming` cursors and promotes any still-`input_streaming` tool to `ready` at run end.

**Replay**: when a session is resumed with prior events, `ChatPanel` receives `replayEvents` and (once, guarded by `replayAppliedRef`) feeds them through the same `applyServerEvent` before live connect (`ChatPanel.tsx:399-405`).

```
WebSocket frame ─► RemoteAgent.handleMessage ─► onSessionEvent
        │                                            │
        └── applyServerEvent(message) ──► dispatch(Action) ──► reducer ──► blocks[]
                                                                            │
                                            MessageThread renders block[i] ─┘
```

### Message rendering, compose, queueing

`MessageThread` (`components/MessageThread.tsx`) renders the `blocks[]` array, switching on `type`/`role` to the per-block components, and implements **sticky auto-scroll**: it scrolls to bottom on new blocks unless the user has scrolled up >40px (tracked in `userHasScrolled`, reset whenever streaming restarts).

Block components:
- `UserMessageBlock`, `AgentTextBlock`, `ThinkingBlock` render markdown via `react-markdown` + `remark-gfm`, with links forced to `target="_blank" rel="noopener noreferrer"`. Streaming text/thinking append a blinking `cwa-cursor`.
- `ToolBlock` (`components/ToolBlock.tsx`) is a collapsible card showing `name`, a `STATUS_LABELS`-mapped status badge (`Preparing/Ready/Running/Completed/Failed`), and on expand a `<pre>` of `arguments` plus a result pane (`Waiting for result…`/`Running…`/output/error).
- `ErrorBlock` shows `"{source} error"` and the message.

Every block uses `createBlockClickHandler` (`useBlockClick.ts`) so clicking the body — but **not** when clicking an interactive child (`a,button,input,…`) and **not** during an active text selection — opens a `BlockModal` (`components/BlockModal.tsx`), a backdrop dialog re-rendering the same component (tool blocks `forceExpanded`). `BlockModal` closes on backdrop `mouseDown`; inner card stops propagation.

`ComposeBox` (`components/ComposeBox.tsx`) is a 4-row textarea; **Enter submits, Shift+Enter inserts newline**. Placeholder and button label flip to "queue" mode (`isQueueing`) while the agent is processing.

**Message queueing** (`ChatPanel.tsx:292-451`): `handleSubmit` checks `isAgentProcessingRef`. If the agent is busy, the message is pushed to `queueRef` and shown in a `cwa-queue` list with a `USER_MESSAGE_QUEUED` status; otherwise `startAgentRun` calls `RemoteAgent.run`. On `run_completed`, `handleRunCompletion` shifts the next queued message and fires it after a 120ms timeout, keeping a serialized one-at-a-time run loop. A `cwa-status-line` shows the current `AgentRunStatus` (`idle/busy/thinking/streaming/using_tool/retrying/queued/error`) with a status dot.

### Parent-window message relay (`message_parent` tool)

`parentMessageTool.ts` bridges the agent to an embedding parent window (the app may run in an iframe). `App.postParentMessage` posts to `window.parent` via `postMessage(msg, "*")` when embedded (`App.tsx:143-151`). `ChatPanel` watches tool events for the tool named `message_parent` (`PARENT_MESSAGE_TOOL_NAME`): it accumulates the streamed JSON input across `tool_call_started`/`tool_input_delta`, and on `tool_call_ready` (`maybePostParentMessageToolCall`) parses the input, unwraps a `{ message }` envelope if present, and relays it to the parent exactly once (`sent` flag). Relay/parse failures are swallowed — mirroring the server tool which always reports success.

### Environment approval flow

Environments are an out-of-band offer pushed over the session socket as `environment_event` frames. `ChatPanel.applyServerEvent` (`ChatPanel.tsx:365-393`) recognizes two kinds and forwards typed payloads up to `App`:

| `environment_event.kind` constant | Payload | App handler |
|---|---|---|
| `environment_offer_available` | `{ environmentId, sourceName?, canonicalSourceUrl? }` | `handleEnvironmentOfferAvailable` → set `environmentOffer` |
| `environment_offer_resolved` | `{ environmentId, decision: "approved"\|"dismissed"\|"unavailable" }` | `handleEnvironmentOfferResolved` → clear matching offer |

(Other lifecycle kinds `environment_entered` / `environment_exited` are defined in `shared/environment.ts` but not consumed by this UI.) When `environmentOffer` is set, `App` renders a global `EnvironmentApprovalModal` (`App.tsx:218-224`). Because the decision is global (2×2), a `resolved` event from *any* client clears the modal here too (comment at `App.tsx:74-75`).

`EnvironmentApprovalModal` (`components/EnvironmentApprovalModal.tsx`) loads `fetchEnvironmentPreview(environmentId)` → `SkillPreview[]`, shows a skill selector + `SkillFilesPanel`, and a footer of four decisions:

```typescript
type EnvironmentDecision = "accept" | "approve" | "ignore" | "reject";
```

| Decision | Label | Meaning |
|---|---|---|
| `accept` | Allow this visit | use skills until you leave |
| `approve` | Always allow | auto-enter every future visit |
| `ignore` | Not now | skip until it returns |
| `reject` | Never | stop notifying |

`App.decideEnvironmentOffer` (`App.tsx:126-141`) optimistically closes the modal (the `resolved` event confirms), records accepted summaries into `acceptedEnvironmentSummaries` (shown on the agent-selection screen), and POSTs the decision via `decideEnvironment`.

### Skill files panel

`SkillFilesPanel` (`components/SkillFilesPanel.tsx`) is a two-pane file explorer over `Record<path, content>`. The flat tree is computed by `skillFiles.ts`: `skillPathsToTreeRows` builds a `DirNode` trie from slash-split paths and emits `SkillTreeRow[]` — **files first (sorted), then subdirs (sorted)** at each depth, each carrying a `depth` used for CSS indentation (`--cwa-skill-tree-base` + depth × `--cwa-skill-tree-indent`). `firstSkillFilePathInTree` returns the first file in that exact order, used to auto-select a file when a skill is opened (e.g. `SKILL.md`). The right pane shows the selected path and a `<pre>` of its content.

### Component map

```
App (App.tsx) ── EnvironmentApprovalModal ── SkillFilesPanel
 ├─ AgentSelectionScreen ── AgentTree/AgentRows/AgentRow, NewSessionDialog, EnvironmentSkillsNotice
 ├─ SessionSelectionScreen ── SessionList
 └─ ChatScreen ── ChatPanel
                   ├─ MessageThread
                   │    ├─ UserMessageBlock   (react-markdown)
                   │    ├─ AgentTextBlock     (react-markdown)
                   │    ├─ ThinkingBlock      (react-markdown)
                   │    ├─ ToolBlock          (collapsible)
                   │    └─ ErrorBlock
                   ├─ ComposeBox
                   └─ BlockModal ── (re-renders the clicked block)
```

### Styling system (brief)

CSS is plain (no CSS-in-JS), imported once via `styles/index.css` which `@import`s nine cascade-ordered files: `tokens → base → layout → messages → tools → messages-status → modal → environment-approval → screens → responsive`. `tokens.css` defines a dark theme on `:root` (`color-scheme: dark`, Inter font) with CSS custom-property design tokens — backgrounds (`--background-primary #19141f`, `--background-secondary`), borders/hover, a purple accent (`--interactive-accent #7c3aed`), text colors (`--text-normal/-muted/-error`), and a monospace stack. The layout is a centered "window" shell (`cwa-app-shell` → `cwa-window` → `cwa-header` + screen body), with all component styles keyed off `cwa-` BEM-ish class names.

## Chrome MV3 Extension (Environment Provider)

The `agent-station-chrome-extension/` directory is a self-contained, build-step-free Manifest V3 Chrome extension. It acts as an **environment provider** for Agent Station: when a user visits a recognized site, the extension replaces the page with a split-pane "shell," embeds the Agent Station web app from `http://localhost:3000` in the right pane, and tells the local Agent Station server (`http://127.0.0.1:3000`) that this browser tab is an available environment an agent can act in. The product term is "environment availability"; in code it is registered via `POST /api/environments/register` and an `environmentId` such as `web:wikipedia`.

The extension has two scripts: a **service worker** (`background.js`, the privileged side that talks to the registry and the Agent Station HTTP API and owns tab lifecycle) and a **content script** (`content.js`, the per-tab DOM side that builds the split UI and relays user intent). They communicate over `chrome.runtime` message passing.

### Manifest and permissions

`agent-station-chrome-extension/manifest.json` (MV3, version `1.2.1`):

| Field | Value | Purpose |
|---|---|---|
| `background.service_worker` | `background.js` | Privileged worker for registry + API calls |
| `host_permissions` | `http://127.0.0.1:3000/*` | Allows `fetch` to the Agent Station server (cross-origin) |
| `permissions` | `["tabs"]` | Tab lifecycle events (`onRemoved`, `onUpdated`) |
| `content_scripts[0].matches` | `*://*.wikipedia.org/*`, `*://wikipedia.org/*`, `*://www.wikipedia.org/*` | Where `content.js`/`split.css` are injected |
| `content_scripts[0].js` / `css` | `content.js` / `split.css` | Split-pane shell + styling |
| `content_scripts[0].run_at` | `document_idle` | Inject after DOM is parsed |
| `content_scripts[0].all_frames` | `false` | Top frame only |

Note the **two distinct localhost origins**: the content script embeds the agent panel from `http://localhost:3000` (`LOCALHOST_PANEL_URL`, content.js:7), while the background worker posts environment registration to `http://127.0.0.1:3000` (`AGENT_STATION_URL`, background.js:2). They resolve to the same server but are treated as separate origins by the browser; `host_permissions` only lists the `127.0.0.1` form because only the background worker makes programmatic cross-origin `fetch` calls.

### Site recognition (site-registry)

The list of supported sites lives in `agent-station-chrome-extension/site-registry.json`, loaded by the background worker via `chrome.runtime.getURL` and memoized in `registryCache` (background.js:10-19). It currently has one entry:

```json
{
  "sites": [
    {
      "id": "wikipedia",
      "environmentId": "web:wikipedia",
      "sourceName": "Wikipedia",
      "hostSuffixes": [".wikipedia.org"],
      "hostsExact": ["wikipedia.org", "www.wikipedia.org"]
    }
  ]
}
```

A registry site is matched against the current hostname by `hostnameMatchesSite` (background.js:21-25): a hit occurs if `hostsExact` contains the exact hostname **or** any `hostSuffixes` entry is a suffix of it. The `environmentId` sent to Agent Station comes from `environmentIdForSite` (background.js:27-31): the explicit `site.environmentId` if present and non-empty, otherwise the fallback `` `web:${site.id}` ``. So `wikipedia` resolves to `web:wikipedia`.

There is **redundancy between the manifest `matches` globs and the registry**: the manifest decides *whether the content script loads at all*, and the registry independently decides *whether the split UI is injected*. Adding a new site requires editing both files (manifest `matches` to inject the script, registry to recognize it).

### Background ↔ content messaging

The content script never calls the Agent Station API or reads the registry directly; it delegates to the worker through three message types (background.js `onMessage` listener, background.js:110-155). All handlers return `true` to keep the `sendResponse` channel open for the async reply, and respond with `{ ok: true, ... }` or `{ ok: false, error }`. The content-side helper `sendToBackground` (content.js:65-80) rejects on `chrome.runtime.lastError` or any non-`ok` response.

| Message `type` | Sender → Receiver | Payload | Background action | Response |
|---|---|---|---|---|
| `resolveSite` | content → bg | `{ hostname }` | `resolveSiteForHostname` over registry | `{ ok, site }` (site or `null`) |
| `activateEnvironment` | content → bg | `{ siteId, canonicalSourceUrl }` | `activateEnvironmentForTab` → `POST /api/environments/register` | `{ ok, payload: { environmentId, sourceName } }` |
| `deactivateEnvironment` | content → bg | `{ siteId }` | `deactivateEnvironmentForTab` → `POST /api/environments/unavailable` | `{ ok }` |

For `activateEnvironment`/`deactivateEnvironment`, the worker derives `tabId` from `sender.tab?.id` (not the message), so registration is always keyed to the real tab. The active environment per tab is tracked in `activeEnvironmentByTabId: Map<number, { environmentId, siteId }>` (background.js:8).

```
 Tab (wikipedia.org)                 Service worker                 Agent Station
 ┌──────────────────────┐           ┌───────────────────┐          (127.0.0.1:3000)
 │ content.js           │           │ background.js     │          ┌──────────────┐
 │  waitForBodyAndRun   │           │  site-registry    │          │ Fastify      │
 │   │                  │           │  cache + tabs map │          │ environment  │
 │   ▼ resolveSite ─────┼──────────►│ resolveSiteFor... │          │ Routes       │
 │  injectSplitUi(site) │◄──────────┤  {site|null}      │          └──────────────┘
 │  show "Chat with     │           │                   │                 ▲
 │   YOUR agent." CTA    │          │                   │                 │
 │   │ (click)          │           │                   │                 │
 │   ▼ activateEnv ─────┼──────────►│ activateEnv...    │  POST /api/      │
 │  mount localhost      │          │  register tab,    │  environments/   │
 │  iframe (:3000)      │           │  fetch ──────────┼──register ──────►│
 │                      │           │                   │                 │
 │  pagehide ───────────┼──────────►│ deactivateEnv...  │  POST /api/      │
 └──────────────────────┘  tab close│  fetch ──────────┼──unavailable ───►│
                            onUpdated│  (hostname left   │                 │
                            (url) ──►│   site → unavail) │                 │
                                     └───────────────────┘
```

### Content script: split-pane shell lifecycle

`content.js` runs at `document_idle`. Control flow:

1. **`waitForBodyAndRun(90)`** (content.js:375-393, 393) — polls via `requestAnimationFrame` up to 90 frames for `document.body`, then calls `tryInjectWhenReady`.
2. **`tryInjectWhenReady`** (content.js:358-373) — sends `resolveSite` for `window.location.hostname`. If no site matches, it logs and exits (no UI). Otherwise `injectSplitUi(site)`.
3. **`injectSplitUi`** (content.js:290-356) — guarded by the `window.__host_split_extension_v1` marker (`MARKER`) to prevent double-injection. It adds the `host-split-shell` class to `<html>`/`<body>`, **clears the existing `<body>`** (`clearBodyPreserveExtensionSafe`, content.js:57-63), and builds a fixed-position root `#__host_split_root__` containing a flex `.host-split-iframes` wrap. The left pane is an iframe (`#__host_split_site_iframe`) whose `src` is the original page URL — i.e. the visible page becomes a *mirror of itself inside an iframe*. It then calls `mountFloatingAgentCta`.
4. **CTA → open localhost split** (`mountFloatingAgentCta`, content.js:255-288) — a floating button labeled **"Chat with YOUR agent."** sits top-right of the left pane (`.host-split-agent-cta`). Until clicked there is **no right pane**. On click it: removes itself, adds `host-split-with-right` to the wrap, creates the draggable `.host-split-divider` and a `.host-split-right-slot` holding `#__host_split_local_iframe` with `src = http://localhost:3000`, wires message handling, and then calls `activateEnvironmentForCurrentTab(site.id)`.

So environment registration happens **only when the user opens the agent panel**, not merely on visiting the site.

5. **`activateEnvironmentForCurrentTab`** (content.js:156-164) — sets `canonicalSourceUrl = window.location.href`, sends `activateEnvironment`, and sets `environmentActive = true`.
6. **Teardown** — a `pagehide` listener (content.js:389-391) calls `deactivateEnvironmentForCurrentTab`, which sends `deactivateEnvironment` only if `environmentActive && activeSiteId`.

The divider is a manual pointer-driven resizer (`attachSplitResizer`, content.js:193-253) with a default left ratio of `2/3` (`SPLIT_DEFAULT_LEFT_RATIO`) and a `160px` per-pane minimum (`SPLIT_MIN_PANE_PX`); while dragging, `.host-split-resizing` disables `pointer-events` on the iframes so they don't swallow the drag (`split.css:85-88`).

### parent ↔ localhost iframe postMessage (url_change)

`postMessage` is **no longer** used to inject environment availability into the localhost iframe (that moved to the direct background→server API; see README "Notes"). It remains only for **live left-pane mirroring**. `attachLocalhostChildMessageHandler` (content.js:143-154) listens for `message` events and strictly validates `event.origin === LOCALHOST_ORIGIN` (`http://localhost:3000`) **and** `event.source === iframeLocal.contentWindow`. The only honored message:

```ts
// from the localhost agent panel to the parent page
{ type: 'url_change', url: string }
```

`applyUrlChangeFromChild` (content.js:116-137) validates the URL via `parseAllowedWikipediaUrl` (http/https on a `*.wikipedia.org` host only), sets the **left** mirror iframe's `src`, and — only when the new URL is same-origin as the tab — calls `history.replaceState` to keep the address bar in sync. It deliberately never navigates the top window so the shell and the right localhost iframe stay alive.

### Background tab lifecycle and environment availability

The worker keeps environment availability consistent with the browser tab state:

- **`chrome.tabs.onRemoved`** (background.js:83-85) — tab closed → `deactivateEnvironmentForTab` → `POST /api/environments/unavailable`.
- **`chrome.tabs.onUpdated`** (background.js:87-108) — when a tracked tab's `url` changes, it re-resolves the site and marks the environment unavailable if the new hostname no longer matches the registered site (or the URL is unparseable / site vanished). This handles SPA-style navigations away from the supported host.

`activateEnvironmentForTab` (background.js:57-73) builds the registration payload and stores `{ environmentId, siteId }` in `activeEnvironmentByTabId` before the fetch:

```ts
// POST http://127.0.0.1:3000/api/environments/register  body:
{
  id: string,                       // e.g. "web:wikipedia"
  metadata: {
    siteId: string,                 // "wikipedia"
    canonicalSourceUrl: string,     // the tab's window.location.href
    sourceName?: string,            // "Wikipedia"
  },
  canonicalSourceUrl: string,
  sourceName?: string,              // spread only if present
}

// POST http://127.0.0.1:3000/api/environments/unavailable  body:
{ id: string }
```

`postAgentStation` (background.js:46-55) sends JSON and throws on a non-2xx response (`Agent Station HTTP <status>`); the content side surfaces failures through a fixed red `showFailureBanner` overlay (content.js:26-55).

### Server contract (Agent Station side)

The receiver is a Fastify app in the sibling `agent-server-client` package, `agent-server-client/src/server/routes/environmentRoutes.ts`. Relevant to this extension:

- `POST /api/environments/register` (environmentRoutes.ts:6-27) — requires a non-empty string `id`; validates `metadata` is a plain object if provided; pulls optional `canonicalSourceUrl`/`sourceName`; calls `environmentManager.registerAvailableEnvironment(...)`; returns `{ ok: true, id }`.
- `POST /api/environments/unavailable` (environmentRoutes.ts:29-37) — requires `id`; calls `environmentManager.markUnavailable(id)`; returns `{ ok: true }`.

The extension only consumes these two. The same router also exposes `POST /api/environments/decision` and `GET /api/environments/preview` (environmentRoutes.ts:39-62), which the extension does not call. Per the README, once registered, Agent Station "offers that environment to any open sessions over websocket" — the accept/ignore handshake and skill previews are handled inside Agent Station, not the extension.

### Notable as-built details

- No build/bundle step: all five runtime files are plain JS/JSON/CSS loaded verbatim by Chrome.
- The split shell **destroys and rebuilds** the page DOM (`clearBodyPreserveExtensionSafe`), then re-renders the original page inside an iframe — the "mirror." Mixed-content caveat (http localhost inside an https parent) is called out in-code as a possible blank-panel cause (content.js:344-348).
- Environment-linked skill content was intentionally moved out of the extension into the repo-level `environment-repository/` (README "Notes"), reflecting the legacy removal of `postMessage`-based skill injection.
- Registration is **per-tab and lazy**: it fires on CTA click, is torn down on `pagehide`, tab close, or navigation off the supported host — keeping Agent Station's availability state aligned with what the user is actually looking at.

## Obsidian Sidebar Extension

`agent-station-obsidian-extension/` is a small Obsidian **desktop** plugin (product name "Agent Station Obsidian Extension", id `agent-station-obsidian-extension`, version `0.0.1`) whose entire job is to host the **agent-server-client** web app inside an Obsidian sidebar panel via an `<iframe>`. The plugin shell is intentionally minimal: it registers a custom view, draws an iframe into it, and points that iframe at `http://localhost:3000`. No chat logic, message bus, or agent runtime lives in the plugin itself — that is all delivered by the embedded app.

### Runtime architecture

```
 Obsidian desktop app
 ┌───────────────────────────────────────────────────────────┐
 │  ChatWithAgentPlugin (Plugin)                               │
 │   • registerView(VIEW_TYPE_CHAT, leaf => new ChatView)     │
 │   • addRibbonIcon("message-square") ── activateView()      │
 │   • addCommand(open-…)             ── activateView()       │
 │                                                            │
 │   activateView(): reuse existing leaf OR getRightLeaf()    │
 │                   → setViewState({type: VIEW_TYPE_CHAT})   │
 │                   → revealLeaf()                            │
 │                                                            │
 │   Right sidebar leaf                                        │
 │   ┌─────────────────────────────────────────────┐         │
 │   │ ChatView (ItemView)                           │         │
 │   │  onOpen(): container.children[1]              │         │
 │   │     .addClass("cwa-container")                │         │
 │   │     createEl("iframe", cls "cwa-iframe",      │         │
 │   │        src = http://localhost:3000)           │         │
 │   │  ┌───────────────────────────────────────┐   │         │
 │   │  │  <iframe src=localhost:3000>          │   │         │
 │   │  │     agent-server-client (web app)     │ ◄─┼── owns  │
 │   │  │     real chat UI + agent runtime      │   │   all   │
 │   │  └───────────────────────────────────────┘   │   logic │
 │   └─────────────────────────────────────────────┘         │
 └───────────────────────────────────────────────────────────┘
```

The two key constants are defined at the top of `src/main.ts:3-4`:

```ts
const VIEW_TYPE_CHAT = "agent-station-obsidian-extension";
const APP_URL = "http://localhost:3000";
```

`APP_URL` is hard-coded — there are no plugin settings, no settings tab, and no way to change the port from the Obsidian UI. (The README's "Monorepo context" mentions `http://127.0.0.1:3000`, but the code uses the `localhost` hostname.)

### Plugin lifecycle

The default export `ChatWithAgentPlugin extends Plugin` (`src/main.ts:38`) drives the lifecycle:

| Hook / method | Behavior | Source |
| --- | --- | --- |
| `onload()` | Registers the view type, adds a ribbon icon (`message-square` glyph) and a command, both wired to `activateView()`. | `src/main.ts:39-51` |
| `onunload()` | `app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT)` — tears down any open sidebar leaves. | `src/main.ts:53-55` |
| `activateView()` | Reuses the first existing leaf of `VIEW_TYPE_CHAT` if present; otherwise grabs the right sidebar leaf via `workspace.getRightLeaf(false)` and `setViewState({type, active:true})`. Then `revealLeaf()`. | `src/main.ts:57-70` |

`ChatView extends ItemView` (`src/main.ts:6`) is the view itself:

| Member | Behavior |
| --- | --- |
| `getViewType()` | returns `VIEW_TYPE_CHAT` |
| `getDisplayText()` | `"Agent Station Obsidian Extension"` (tab/panel title) |
| `onOpen()` | Empties `containerEl.children[1]`, adds class `cwa-container`, creates an `<iframe class="cwa-iframe" src={APP_URL}>` sized 100% × 100% with `border: 0`. |
| `onClose()` | Empties `containerEl.children[1]?.empty()`. |

There is no `loadData`/`saveData`, no `PluginSettingTab`, and no default-settings object — the plugin is stateless across reloads.

### How it connects to the :3000 app

The connection is purely an iframe `src`. The plugin does not implement any `postMessage` bus in the shell (confirmed: the shipped `main.js` contains no messaging code). Per the README, cross-window messaging — when it exists — is owned by `agent-server-client` inside the iframe: during agent runs a `message_parent` tool call can relay JSON to the parent window via `postMessage`, and environment availability is modeled server-side via an `EnvironmentManager` rather than client-side skill injection. None of that lives in this package; the plugin is a passive host.

### Build setup

`esbuild.config.mjs` bundles `src/main.ts` → `main.js` (CommonJS, `target: es2018`) for the Obsidian plugin loader:

- Single entrypoint `src/main.ts`, `outfile: main.js`, `format: "cjs"`, `bundle: true`.
- Externals: `obsidian`, `electron`, all `@codemirror/*` and `@lezer/*` packages, and every Node `builtinModules` (`esbuild.config.mjs:12-27`) — these are provided by the Obsidian/Electron host and must not be bundled.
- `jsxFactory: "React.createElement"` / `jsxFragment: "React.Fragment"` are configured, but the entry graph reached from `src/main.ts` imports no React, so the JSX config is effectively unused in the shipped bundle.
- Production (`node esbuild.config.mjs production`): `minify: true`, `sourcemap: false`, one `rebuild()` then exit. Dev: inline sourcemaps, `context.watch()` (continuous rebuild). Driven by npm scripts `dev` (`node esbuild.config.mjs`) and `build` (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`) in `package.json:8-9`.

`manifest.json` marks `"isDesktopOnly": true` and `minAppVersion: 1.0.0`, author "Arcturus Labs". The committed `main.js` is the esbuild output (the repo commits it so a fresh clone works without building); `node_modules/` and `IGNORED/` are gitignored.

### Dead / non-runtime code

`package.json` declares `react`, `react-dom`, `react-markdown`, and `remark-gfm`, and `src/` contains a full set of React chat components — `src/components/ChatPanel.tsx`, `MessageThread.tsx`, `ComposeBox.tsx`, `AgentTextBlock.tsx`, `ThinkingBlock.tsx`, `ToolBlock.tsx`, `UserMessageBlock.tsx` — plus supporting modules `src/agent.ts`, `src/mockAgent.ts`, `src/BlockModal.ts`, `src/context.ts`, `src/useBlockClick.ts`, and a `Block` union type in `src/types.ts`. **None of these are reachable from the `src/main.ts` entrypoint**, so esbuild tree-shakes them out — the shipped `main.js` contains zero React references. The README explicitly flags `src/components/` as "local React chat UI experiments/mocks (not the primary runtime path today)." They represent an earlier/alternative in-plugin chat implementation that has been superseded by the iframe-hosting approach.

The `Block` discriminated union in `src/types.ts` (used only by the dead components) documents the chat model those experiments targeted:

```ts
export type Block =
  | UserMessageBlock   // { type:"text"; role:"user"; text; isStreaming }
  | ThinkingBlock      // { type:"thinking"; thinking; isStreaming }
  | AgentTextBlock     // { type:"text"; role:"assistant"; text; isStreaming }
  | ToolBlock;         // { type:"toolBlock"; id; name; arguments;
                       //   argumentsStreaming; result: string|null; isError }
```

### Styling

`styles.css` (loaded automatically by Obsidian alongside `main.js`) zeroes the panel padding for the iframe host (`.cwa-container { padding: 0 !important; }`, `styles.css:5-7`) and contains a larger set of `.cwa-panel`/`.cwa-thread`/message-block rules that style the (currently dead) React chat UI rather than the iframe.

### Development / install

Per the README: run the repo-root `npm run dev` to bring up the shared stack (including agent-server-client on port 3000), then `npm run dev`/`npm run build` in this package to produce `main.js`. The plugin is installed by symlinking the package directory into `~/.config/obsidian/plugins/agent-station-obsidian-extension`, enabling it in Obsidian, and reloading after shell changes via `obsidian plugin:reload id=agent-station-obsidian-extension`.

## Build, Configuration & Dev Workflow

Agent Station is a npm monorepo whose root package (`agent-station`, `package.json:2`) is **scripts-only** — it installs no dependencies and contains all real code in the `agent-server-client/` workspace. The product is a single web service that bundles a Vite/React client and a Fastify/Node server. There is no Turborepo/pnpm/Nx tooling; orchestration is plain npm `--prefix` delegation. Two sibling browser-extension packages (`agent-station-chrome-extension/`, `agent-station-obsidian-extension/`) and a disk-backed `environment-repository/` live alongside but are documented in their own sections.

### Workspace layout

```
rookery/                              (repo root = "agent-station", private, scripts-only)
├── package.json                      delegates all scripts to agent-server-client via --prefix
├── .gitignore                        ignores .env*, .var/, dist/, node_modules/, IGNORED/, agent-profiles.json
├── scripts/                          bash + tsx operational/debug tooling
│   ├── interact-with-remote-agent.sh + .ts   headless agent CLI
│   ├── inject-environment.sh         curl wrapper for /api/environments/*
│   └── drop-database.sh              deletes the SQLite decisions DB
├── environment-repository/           on-disk skill bundles (demo/, web/wikipedia/...)
├── PRODUCT/                          refactor planning + outcome docs
└── agent-server-client/              THE app (Fastify + Vite + React 19)
    ├── package.json                  type:module; deps + the real scripts
    ├── vite.config.ts                Vite build + Vitest config (one file)
    ├── tsconfig.json                 client+server typecheck (noEmit, Bundler resolution)
    ├── tsconfig.server.json          server emit (NodeNext → dist/server)
    ├── config/agent-profiles.example.json
    └── src/{client,server,shared,test}/
```

### npm script orchestration

The root script table forwards everything to the workspace. The only root-local script is `agent:cli`, which shells into `scripts/interact-with-remote-agent.sh`.

| Root script (`package.json`) | Delegates to (`agent-server-client/package.json`) | What it actually runs |
| --- | --- | --- |
| `dev` | `dev` | `tsx src/server/index.ts` — runs the TS server directly, no build step |
| `build` | `build` | `tsc --noEmit` (typecheck) → `vite build` (client → `dist/client`) → `tsc -p tsconfig.server.json` (server → `dist/server`) |
| `start` | `start` | `NODE_ENV=production node dist/server/server/index.js` |
| `typecheck` | `typecheck` | `tsc --noEmit` |
| `test` / `test:watch` | same | `vitest run` / `vitest` |
| `dev:dummy` | `dev:dummy` | `node ../dummy-client/server.mjs` (note: `dummy-client/` is **absent** from the tree today — a dangling script) |
| `agent:cli` | (root-only) | `bash scripts/interact-with-remote-agent.sh` |

Note the binaries are invoked through explicit `node ./node_modules/.../*.js` paths rather than bare `vite`/`tsc`/`vitest`, which avoids reliance on `npm`-injected PATH and works when the script is run from the root via `--prefix`.

The doubled segment in `start` (`dist/server/server/index.js`) is real and correct: `tsconfig.server.json` sets `outDir: dist/server` with `rootDir: src`, so `src/server/index.ts` emits to `dist/server/server/index.js`.

### Dev vs. production serving (the dev/prod fork)

Client hosting is decided at runtime by `NODE_ENV` in `src/server/clientApp.ts`, keyed off `isProduction` from `src/server/serverPaths.ts:5`:

```
                buildServer()  (src/server/index.ts:30)
                       │  registerClientApp(app)  (if enableClient)
                       ▼
        ┌──────────────────────────────────────────────┐
        │  isProduction === true                        │
        │    @fastify/static  root=dist/client prefix=/ │
        │    setNotFoundHandler → SPA fallback to        │
        │      index.html for GET text/html requests    │
        └──────────────────────────────────────────────┘
        ┌──────────────────────────────────────────────┐
        │  isProduction === false  (dev)                │
        │    @fastify/middie (connect middleware)       │
        │    createViteServer({ middlewareMode, spa })  │
        │    app.use: pass /api/* through to Fastify,    │
        │             else hand to vite.middlewares      │
        └──────────────────────────────────────────────┘
```

Key points (`src/server/clientApp.ts:9-37`):
- In dev, Vite runs **in-process in middleware mode** (`server: { middlewareMode: true }`, `appType: "spa"`), not as a separate `vite dev` process. Fastify owns the port; `/api/*` is routed to Fastify handlers, everything else is delegated to Vite for HMR/transform.
- In prod, the prebuilt `dist/client` is served statically with an SPA not-found fallback to `index.html`.
- `serverPaths.ts` also switches the `parentMessageTool` extension path between `.ts` (dev) and `.js` (prod), the only other prod-specific path resolution.

The server entry (`src/server/index.ts`) loads `.env` from `REPO_ROOT` via `dotenv` and reads only three environment variables for its own bootstrap:

| Env var | Default | Used in |
| --- | --- | --- |
| `NODE_ENV` | (unset → dev) | `serverPaths.ts:5`, prod static hosting |
| `HOST` | `127.0.0.1` | `index.ts:19` |
| `PORT` | `3000` | `index.ts:20` |

`buildServer(options)` is exported and reused by tests and the CLI; the listening block only runs when the module is the process entrypoint (`isMain` check, `index.ts:59`).

```typescript
export interface BuildServerOptions {
  enableClient?: boolean;                       // default true; false in CLI/tests
  logger?: Parameters<typeof fastify>[0]["logger"];
  roomIdleTimeoutMs?: number;
  /** SQLite location for persistent environment decisions; ":memory:" in tests. */
  environmentDecisionStoreLocation?: string;
}
```

### TypeScript project setup

Two configs implement a split between **typechecking** (client + server together) and **server emission**.

| | `tsconfig.json` | `tsconfig.server.json` (extends base) |
| --- | --- | --- |
| Purpose | typecheck all code (`tsc --noEmit`) | emit runnable server JS |
| `module` / `moduleResolution` | `ESNext` / `Bundler` | `NodeNext` / `NodeNext` |
| `noEmit` | `true` | `false` |
| `outDir` / `rootDir` | — | `dist/server` / `src` |
| `include` | `src/client`, `src/server`, `vite.config.ts` | `src/server/**/*.ts`, `src/shared/**/*.ts` |
| `exclude` | — | `*.test.ts`, `*.test.tsx` |
| shared | `target: ES2023`, `strict`, `jsx: react-jsx`, `isolatedModules`, `skipLibCheck` | inherits all |

The client is bundled by Vite (Bundler resolution, ESM), while the server is compiled by `tsc` to NodeNext ESM. Source uses `.js` import specifiers throughout (e.g. `import { REPO_ROOT } from "./paths.js"`) so the same files satisfy both NodeNext emission and `tsx`'s dev loader.

### Runtime path resolution & local state (`.var/`)

Paths are resolved at runtime, not hardcoded. `src/server/paths.ts` walks up from the compiled/loaded module directory looking for the `package.json` whose `name === "agent-server-client"`, yielding `AGENT_CLIENT_ROOT`, and `REPO_ROOT` is its parent (`paths.ts:7-30`). This makes the same code work whether running from `src/` (tsx/dev) or `dist/server/server/` (prod).

All mutable local state lives under a single gitignored tree, `.var/agent-station/` (`.gitignore:10`):

| Path under `REPO_ROOT/.var/agent-station/` | Format | Owner | Default-defining file |
| --- | --- | --- | --- |
| `session-events/<sessionId>.jsonl` | JSONL, one `SessionEventMessage` per line | replay/persistence | `sessionEvents.ts:8` |
| `agent-sessions.jsonl` | JSONL, one `AgentSessionRecord` per line | session log | `agents/sessionLog.ts:15` |
| `environment-decisions.sqlite` | SQLite (`node:sqlite`) | persistent approve/reject decisions | `environment/EnvironmentDecisionStore.ts:22` |

The two JSONL roots are overridable in-process via `setSessionEventsRoot()` / `setSessionLogPath()` (used by tests); they are not driven by env vars at runtime.

### SQLite usage

`EnvironmentDecisionStore` (`src/server/environment/EnvironmentDecisionStore.ts`) is the only database in the system and uses Node's **built-in `node:sqlite` `DatabaseSync`** (no external driver dependency). It stores only *persistent* environment decisions (`approve`/`reject`); ephemeral decisions (`accept`/`ignore`) stay in memory on `EnvironmentManager`. The single table:

```sql
CREATE TABLE IF NOT EXISTS environment_decisions (
  environment_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  updated_at TEXT NOT NULL
)
```

The store auto-creates `.var/agent-station/` via `mkdirSync(..., { recursive: true })` unless the location is `":memory:"`. Tests pass `":memory:"` through `buildServer({ environmentDecisionStoreLocation })`.

### Operational / debug scripts

| Script | Type | Purpose |
| --- | --- | --- |
| `scripts/interact-with-remote-agent.sh` + `.ts` | bash → tsx | Headless agent CLI: spins up an in-process Fastify server (`buildServer({ enableClient:false, logger:false })`) on an ephemeral port (`port: 0`), drives a session through `RemoteAgent`, and streams `SessionEvent`s as JSONL on stdout. |
| `scripts/inject-environment.sh` | bash → curl | POSTs to `/api/environments/register`, `/api/environments/unavailable`, `/api/environments/decision` against `AGENT_STATION_URL` (default `http://127.0.0.1:3000`) to simulate environment availability/decisions without the browser extension. |
| `scripts/drop-database.sh` | bash | Deletes the SQLite decisions DB (path overridable via `AGENT_STATION_ENV_DECISIONS_DB`, default `.var/agent-station/environment-decisions.sqlite`), clearing remembered approve/reject decisions. Prompts unless `--yes`. |

The agent CLI's `.sh` wrapper (`interact-with-remote-agent.sh:39`) locates the workspace's `tsx` and `tsconfig.json` and `exec`s the `.ts` file directly. The `.ts` script imports the server via a `file://` URL pointing at `src/server/index.js` (`interact-with-remote-agent.ts:221`) — relying on tsx to resolve `.js`→`.ts`. It supports rich `SessionEvent` filtering (`--omit-deltas`, `--omit`, `--only`), session resume (`--session '<AgentSessionSummary JSON>'`), `--restart`, and `--replay`, with the canonical event-type list sourced from `src/shared/realtime.ts` (`SESSION_EVENT_TYPES`).

### Agent profiles config

Agent backends are configured via `agent-server-client/config/agent-profiles.json` (gitignored; checked-in template at `config/agent-profiles.example.json`, loaded by `src/server/config/agentProfiles.ts`). The example defines `MyPiAgent` (`type: "pi"`, `parentId: "PiAgent"`, spawning `../my-agent` in `--mode rpc`). The default CLI agent is `MyPiAgent`; `MockAgent` is available for quick tests.

### Testing

A single `vite.config.ts` doubles as the Vitest config (`defineConfig` from `vitest/config`): jsdom environment, global APIs, setup file `src/test/setup.ts` (just `@testing-library/jest-dom/vitest`), test glob `src/**/*.{test,spec}.{ts,tsx}`, and v8 coverage excluding tests + `src/server/extensions/**`. There are ~11 test files across client and server. The standard validation loop recorded throughout `PRODUCT/` is `npm test && npm run build` from `agent-server-client/`.

### Configuration & Deployment summary

- **Dev**: `npm run dev` → tsx runs `src/server/index.ts`; Fastify on `127.0.0.1:3000` with in-process Vite middleware (HMR). No separate client process.
- **Build**: `npm run build` → typecheck, then `vite build` → `dist/client`, then `tsc -p tsconfig.server.json` → `dist/server`.
- **Prod**: `npm start` → `NODE_ENV=production node dist/server/server/index.js`; Fastify statically serves `dist/client` with SPA fallback. Override host/port with `HOST`/`PORT`; secrets via `.env` at repo root (gitignored).
- **State**: everything mutable is under `.var/agent-station/` (JSONL event/session logs + one SQLite file); safe to delete to reset. `drop-database.sh` resets just the decision DB.

### Recent Evolution (from `PRODUCT/`)

`PRODUCT/todos.md` plus three `step-N-*-outcome.md` docs record a completed, sequenced three-branch refactor (each branch cut from the previous, each gated on `npm test && npm run build` + manual QA + an outcome doc):

1. **`refactor/remove-skill-injection-legacy`** — removed the legacy "skill injection" model (the `/api/skill-injections` route, `SkillInjectionStore`, client persistence transport, `injected_skills` parsing) and made the **environment model** the only path for dynamic capability loading. Renamed `skillInjection.ts` → `skillFiles.ts` and shifted UI language from injection-first to environment-first.
2. **`refactor/split-server-index`** — shrank `src/server/index.ts` from ~390 → 65 lines by extracting `routes/agentRoutes.ts`, `routes/environmentRoutes.ts`, `routes/websocketRoute.ts`, `clientApp.ts`, `roomRuntime.ts`, `serverHelpers.ts`, and `serverPaths.ts`. `index.ts` now only constructs shared deps, registers route groups, and attaches client hosting.
3. **`refactor/extract-session-room-responsibilities`** — reduced `realtime/SessionRoom.ts` (~272 → 193 lines) by extracting `RoomEventStream.ts` (persistence/replay/sequencing/fan-out) and `EnvironmentSessionState.ts` (unresolved offers, active skill paths, runtime-rebuild config).

`scratch.md` captures the design intents driving these: environments push availability immediately (no polling), the Wikipedia environment must not auto-inject, and an environment offer resolved (approve/reject) in any one client must close the approval modal across all clients in that session. The structural takeaway for build/ops: there is exactly one supported capability-loading mechanism (disk-backed environments under `environment-repository/`, decisions in SQLite under `.var/`), and the server bootstrap is now cleanly split into bootstrap wiring vs. route modules vs. realtime helpers.

## External Dependencies

| Dependency | Used by / Purpose |
|---|---|
| External `pi` CLI binary | `PiAgent` spawns it with `--mode rpc` (must be on `PATH`); JSONL stdin/stdout RPC backend for the primary agent. |
| Sibling `../my-agent` Pi extension package | Loaded into `pi` via `-e ../my-agent` per agent profile; the product's domain agent package (not present in repo at time of writing). |
| `fastify` (Fastify 5) | HTTP server; `buildServer()` constructs the single instance serving REST + WebSocket + SPA. |
| `@fastify/websocket` | Registers the `/api/ws` upgrade endpoint bridging clients to `SessionRoom`s. |
| `@fastify/static` | Production static hosting of the prebuilt `dist/client` SPA with index fallback. |
| `@fastify/middie` | Connect-style middleware host in dev so Vite middleware can run inside Fastify. |
| `vite` (Vite 7) + `@vitejs/plugin-react` | Client bundler; runs in-process middleware mode (HMR) in dev, builds `dist/client` in prod. |
| `react` / `react-dom` (React 19) | Client SPA (`createRoot`, `StrictMode`); also declared (but tree-shaken / unused at runtime) in the Obsidian extension. |
| `react-markdown` + `remark-gfm` | Markdown rendering of user/assistant/thinking message blocks in the client. |
| `dotenv` | Loads the repo-root `.env` (`HOST`/`PORT`/secrets) at server module init. |
| `typebox` (`Type`) | Parameter schema (`Type.Object({ message: Type.Any() })`) for the `message_parent` pi tool. |
| `@mariozechner/pi-coding-agent` (`ExtensionAPI`) | Type/registration surface for the `parentMessageTool` pi extension. |
| `node:sqlite` (`DatabaseSync`) | Built-in (no external driver); `EnvironmentDecisionStore` persists `approve`/`reject` decisions. |
| `node:child_process` (`spawn`) | `PiAgent` launches and signals the `pi` CLI subprocess. |
| `node:fs/promises` / `node:fs` | JSONL session/event-log reads & appends; skill-bundle reads; SQLite dir creation. |
| `node:string_decoder` | `PiAgent` JSONL line buffering of `pi` stdout/stderr. |
| `tsx` | Dev/CLI TypeScript execution loader (runs `src/server/index.ts` and the headless agent CLI directly). |
| `typescript` (TS 5.9 / `tsc`) | Typecheck (`--noEmit`) + server emission (`tsconfig.server.json` → `dist/server`, NodeNext). |
| `vitest` (Vitest 4) + `@testing-library` + `jsdom` | Test runner (config shares `vite.config.ts`); ~11 client+server test files. |
| `environment-repository/` (on-disk skill tree) | `LocalEnvironmentRepository` reads `demo/`, `web/` skill bundles loaded as agent skill-search roots. |
| Chrome MV3 runtime APIs (`chrome.runtime`, `chrome.tabs`) | Chrome extension: messaging/`getURL`, and `tabs.onRemoved`/`onUpdated` for per-tab environment lifecycle. |
| `obsidian` plugin API (`Plugin`, `ItemView`, `WorkspaceLeaf`) | Obsidian extension registers the sidebar `ChatView` and reveals/detaches its leaf. |
| `esbuild` (0.25.5) | Bundles the Obsidian plugin `src/main.ts` → `main.js` (CJS); host packages (`@codemirror/*`, `@lezer/*`, `electron`, Node builtins) externalized. |
| Electron/Obsidian host | Provides `obsidian`/`electron`/CodeMirror/Lezer as externals to the Obsidian plugin. |
| Embedding parent window (`window.postMessage`) | Optional iframe host (Chrome split-pane, Obsidian sidebar) targeted by the client's `message_parent` relay; `url_change` relayed back to the Chrome content script. |
| Browser WebSocket / `fetch` APIs | Client `RemoteAgent` HTTP control-plane + per-session WebSocket transport. |
