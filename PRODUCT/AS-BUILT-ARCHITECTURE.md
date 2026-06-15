# Rookery - As-Built Architecture

**Last Updated**: 2026-06-15

This document is the short, current architecture description for the repo as it exists today. It intentionally avoids historical detail and low-level implementation notes.

## 1. System summary

Rookery is a local-first monorepo centered on one service at `127.0.0.1:3000`:

- a **Fastify server**
- a **React Native web chat UI**
- a **WebSocket ACP bridge** to agent runtimes
- an **environment manager** that can hot-load environment-linked skills into a session

The repo is organized into focused top-level packages: `client/`, `server/`, `shared/`, and extension packages.

## 2. Top-level shape

```text
Host clients / providers
  ├─ Browser at :3000
  ├─ Chrome extension
  ├─ Obsidian plugin
  └─ macOS menu bar app
            │
            ▼
server/ (Fastify)
  ├─ REST API for agent/session/environment control
  ├─ WebSocket endpoint carrying ACP JSON-RPC
  ├─ SessionRoomManager / SessionRoom runtime orchestration
  ├─ EnvironmentManager
  └─ ACP subprocess agents
        ├─ PiAgent
        ├─ ClaudeAgent
        ├─ CursorAgent
        └─ generic ACP agent

shared/  ← cross-package contracts: ACP types, environment DTOs, agent/session DTOs
client/  ← React Native web UI, shared UI base for future iPhone client
```

## 3. Core architectural idea

Rookery has two important protocol boundaries:

1. **Client ↔ server:** ACP over WebSocket
2. **Server ↔ agent runtime:** ACP over stdio subprocesses

That is the main simplifying idea in the current architecture.

The server is not trying to invent a new agent protocol. It is a coordinator that:

- creates and resumes sessions
- manages live room lifecycle
- forwards ACP updates between clients and runtimes
- adds Rookery-specific behavior around environments, approvals, and steering prompts

See also: [`PRODUCT/agent-client-protocol.md`](./agent-client-protocol.md)

## 4. Main packages

| Package | Current role |
|---|---|
| `server/` | Main backend at `:3000`; server, runtime orchestration, environment approvals |
| `client/` | React Native web UI; shared UI base for future iPhone (Expo) client |
| `shared/` | Cross-package ACP types, environment DTOs, agent/session contracts |
| `agent-station-chrome-extension/` | Chrome MV3 environment provider |
| `agent-station-obsidian-extension/` | Obsidian host embedding the main app |
| `agent-station-menu-bar-app-mac/` | Native macOS client and environment provider |
| `environment-repository/` | Local environment skill bundles keyed by `<kind>/<path>` |
| `PRODUCT/` | Product and architecture notes |

## 5. Main server architecture

### 5.1 Fastify server

`server/src/server/index.ts` builds the main service.

It wires together:

- `SessionRoomManager`
- `EnvironmentManager`
- `EnvironmentDecisionStore`
- `LocalEnvironmentRepository`
- REST routes
- WebSocket ACP route
- React app hosting

In dev, Vite middleware serves the client. In prod, Fastify serves the built static app.

### 5.2 Session rooms

A **SessionRoom** is the live coordinator for one agent session.

A room owns:

- the current `BaseAgent` runtime
- websocket subscribers
- room-local environment state
- serialized execution for prompts and runtime rebuilds
- idle shutdown behavior

`SessionRoomManager` keeps exactly one live room per session id.

When the last client disconnects, the room waits for a short idle timeout and then stops the runtime.

### 5.3 Agent runtime layer

`BaseAgent` is the common ACP subprocess runtime.

Responsibilities:

- spawn the subprocess
- create or load ACP sessions
- forward `session/update` notifications to the room
- forward permission requests to the client
- send prompts, cancel requests, mode changes, and config changes
- persist enough restart metadata to recreate a stopped session later

Concrete adapters:

- `PiAgent`
- `ClaudeAgent`
- `CursorAgent`
- generic ACP profiles loaded from config

### 5.4 Pi integration

Pi is no longer integrated through the older Pi-specific JSONL RPC path.

Current design:

- `PiAgent` is an ACP agent
- it launches `pi-acp`
- `pi-acp` in turn launches `pi`
- a small generated launcher injects Pi args, skill paths, and extension paths
- the default profile still points Pi at the sibling `../my-agent/` package

Generated Pi launch helpers are written under:

- `.var/agent-station/generated/pi-launchers/`

### 5.5 Agent discovery

Agents come from two places:

- built-in parents: `PiAgent`, `ClaudeAgent`, `CursorAgent`
- configured profiles from `server/config/agent-profiles.json`

Profiles let the app expose multiple concrete agents while reusing the shared runtime architecture.

## 6. Environment architecture

### 6.1 What an environment is

An **environment** is a context the user is currently "in", identified as:

- `<kind>:<path>`

Examples:

- `web:wikipedia`
- `demo:demo`
- `app:<slug>`

An environment maps to a directory in `environment-repository/` and provides one or more skill bundles.

### 6.2 Environment repository

`LocalEnvironmentRepository` resolves an environment id to a local directory and reads:

- skill bundle paths for runtime injection
- previewable skill files for the approval UI

Current storage model is simple: local disk only.

### 6.3 Environment manager

`EnvironmentManager` tracks three separate concepts:

| Concept | Meaning |
|---|---|
| **available** | a provider says the environment is currently present |
| **decision** | global allow/reject choice for that environment |
| **entered** | a session currently has that environment's skills loaded |

Decision model:

- `accept`: allow once
- `approve`: allow persistently
- `ignore`: dismiss once
- `reject`: reject persistently

Storage model:

- ephemeral decisions (`accept`, `ignore`) live in memory
- persistent decisions (`approve`, `reject`) live in SQLite

### 6.4 How environments affect sessions

When an environment becomes available:

1. providers call `/api/environments/register`
2. `EnvironmentManager` decides whether the session should be offered or entered
3. `SessionRoom` receives the lifecycle event
4. if entered, the room rebuilds the runtime with merged skill paths
5. the room emits a Rookery environment event to connected clients over ACP

Important constraint: the manager does **not** manipulate sockets or runtimes directly. It only pushes lifecycle events into rooms.

### 6.5 Environment-to-agent bridge

The product intent is still:

- the agent should not be deeply coupled to environment internals
- environments contribute **skills**
- interaction with the environment stays narrow and explicit

That remains consistent with:

- [`PRODUCT/relationship-or-environments-skills-and-agent.md`](./relationship-or-environments-skills-and-agent.md)
- [`PRODUCT/narrow-skills-environment-bridge.md`](./narrow-skills-environment-bridge.md)

## 7. Client architecture

### 7.1 Web client

The browser app is a React Native SPA in `client/`, served via `react-native-web` + Vite.

Main responsibilities are unchanged: agent selection, session lifecycle, ACP websocket communication, streaming conversation rendering, tool/permission/plan/usage/mode/config handling, queued messages, and environment approval UI.

The client is structured around:
- extracted session state layer (`client/src/session/`)
- platform-adaptive rendering seams (markdown, controls)
- presentational block components (`client/src/components/blocks/`)

`RemoteAgent` remains the transport layer, now living under `client/src/lib/`.

### 7.2 Other clients/providers

Current ecosystem around `:3000`:

- **Chrome extension**: detects supported web contexts and registers environments
- **Obsidian plugin**: embeds the app in a sidebar view
- **macOS menu bar app**: native client with the same backend, and can also register app-based environments

## 8. Live message flow

### 8.1 Starting a session

```text
client
  -> POST /api/agent/start
  -> create or reuse SessionRoom
  -> room has runtime + session metadata
```

If a prior session record exists but no live room exists, the server recreates the runtime from saved restart metadata.

### 8.2 Running a prompt

```text
client websocket ACP request: session/prompt
  -> websocketRoute
  -> SessionRoom.run()
  -> BaseAgent.run()
  -> ACP subprocess
  -> session/update notifications
  -> SessionRoom subscribers
  -> connected clients
```

The room serializes prompt execution so overlapping turns do not race.

### 8.3 Restoring history

Transcript restoration is primarily agent-owned now.

On resumed sessions, `BaseAgent` uses ACP `session/load`, and restored history comes from the runtime rather than from a Rookery-owned replay log.

### 8.4 Cancel and send-now

- normal stop uses ACP `session/cancel`
- send-now uses a Rookery extension request: `_rookery/steering_prompt`

This preserves the product behavior while keeping provider-specific steering inside the runtime layer.

## 9. API surface

### 9.1 REST

Current major routes:

- `GET /api/health`
- `GET /api/agents`
- `GET /api/agent/sessions?agent=<id>`
- `GET /api/agent/session/recent`
- `POST /api/agent/start`
- `POST /api/environments/register`
- `POST /api/environments/unavailable`
- `POST /api/environments/decision`
- `GET /api/environments/preview`

### 9.2 WebSocket

- `GET /api/ws?sessionId=...`

The websocket carries ACP JSON-RPC messages.

Supported behaviors include:

- `session/prompt`
- `session/cancel`
- `session/set_mode`
- `session/set_config_option`
- `_rookery/steering_prompt`
- permission request/response relay
- `session/update` fan-out from the runtime

## 10. Persistence and local state

Current local mutable state is under `.var/agent-station/`.

Important pieces:

- `environment-decisions.sqlite` - persistent environment approvals/rejections
- generated Pi launchers
- session records in `sessionLog.ts` backing saved/restartable sessions

The important architecture change versus older versions is:

- Rookery is **not** the primary durable transcript store anymore
- live conversation history is restored via ACP `session/load`

## 11. Current shared contracts

Shared cross-boundary types live in root `shared/`.

Important files:

- `shared/src/acp.ts` — ACP JSON-RPC types
- `shared/src/agent.ts` — session metadata and agent-facing shared types
- `shared/src/environment.ts` — environment ids, decisions, and preview types

Both `client/` and `server/` import from `shared/`. The `server/` package retains a few locally-scoped shared types (`realtime.ts`, `environmentSkillPreview.ts`) that carry server-side logic.

## 12. Architecture constraints that matter right now

1. **One live room per session id.**
2. **ACP is the primary protocol on both sides of the server.**
3. **Environment decisions are global, but entered state is per session.**
4. **Runtime rebuilds happen at the room layer, not in `EnvironmentManager`.**
5. **Session restoration depends on saved restart metadata plus ACP `session/load`.**
6. **Pi-specific behavior should stay inside `PiAgent` or `pi-acp`, not leak into the client.**

## 13. Recommended mental model

The shortest accurate model of the current system is:

> Rookery is a localhost ACP router/orchestrator with a React UI, a room-based session lifecycle, and an environment system that can inject skill bundles into live agent sessions.
