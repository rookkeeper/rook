# Rook server-next

Minimal Fastify playground server for ACP-first experiments.

This package is a small ACP-first playground. It uses a WebSocket/JSON-RPC ACP facade outwardly and lazily starts configured ACP runtimes inwardly.

## Current surface

- `GET /api/health` → `{ ok: true, service: "rook-next" }`
- `GET /api/ws` → bearer-authenticated ACP WebSocket.
- ACP `initialize`, `session/list`, `session/new`, `session/load`, `session/resume`, `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_config_option`, and `session/close` are routed through the facade.

## Runtime configuration

Runtime profiles load from `~/.rook/config/agent-runtimes.json`, or from `ROOK_AGENT_RUNTIMES_PATH` when set. `agent-profiles.example.json` shows the initial Pi and Claude profile shape.

`AgentRuntimeManager` owns the profile catalog, lazily starts an `AgentRuntime` only when a session needs it, and persists a public session mapping. Public session IDs are `<runtimeId>:<runtimeSessionId>`; `session/list` is one unified list with `_meta.runtimeId` and `_meta.startedAt` on each entry.

## Goal

Use `server-next/` as a clean play space for understanding and rebuilding the server side around more ACP-compliant assumptions without clobbering the main server yet.
