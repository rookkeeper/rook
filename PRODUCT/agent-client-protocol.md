# Agent Client Protocol

Rookery uses [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/introduction) as the wire format between clients and agent runtimes — the same problem space as LSP, but for coding agents.

## Where ACP shows up

- **Server/client boundary:** WebSocket JSON-RPC between the React UI (or macOS menu bar client) and `SessionRoom`
- **Agent subprocess boundary:** `BaseAgent` spawns stdio ACP servers — Pi via `pi-acp`, Claude via `@agentclientprotocol/claude-agent-acp`, Cursor via `agent acp`
- **UI state:** chat reducer and controls (tools, permissions, plans, stop/cancel, queued messages) map to ACP session methods and `session/update` notifications

## Why ACP

Before ACP, Rookery used a custom realtime event vocabulary. ACP gives us a shared protocol with other editors and agents, first-class permission/plan/usage concepts, and a path to interoperate without per-agent custom integration.

## Further reading

- Spec: https://agentclientprotocol.com/get-started/introduction
- Migration history: `PRODUCT_CHANGES/earlier-documentation/moving-to-agent-client-protocol.md`
