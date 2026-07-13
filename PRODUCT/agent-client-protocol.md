# Agent Client Protocol

Rookery uses [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/introduction) as the wire format between clients and agent runtimes — the same problem space as LSP, but for coding agents. [Read details in llms.txt](https://agentclientprotocol.com/llms.txt) 

## Where ACP shows up

- **Server/client boundary:** WebSocket JSON-RPC between the React UI (or macOS menu bar client) and `SessionRoom`
- **Agent subprocess boundary:** `BaseAgent` spawns stdio ACP servers — Pi via `pi-acp`, Claude via `@agentclientprotocol/claude-agent-acp`, Cursor via `agent acp`
- **UI state:** chat reducer and controls (tools, permissions, plans, stop/cancel, queued messages) map to ACP session methods and `session/update` notifications

## Why ACP

Before ACP, Rookery used a custom realtime event vocabulary. ACP gives us a shared protocol with other editors and agents, first-class permission/plan/usage concepts, and a path to interoperate without per-agent custom integration.

## Rookery ACP extensions

ACP explicitly supports product-specific extensions in two ways:

- custom data in `_meta`
- custom JSON-RPC methods whose names start with `_`

Rookery should prefer those sanctioned extension points rather than inventing non-ACP-shaped protocol additions.

### `_rookery/steering_prompt`

Rookery adds a custom ACP-style JSON-RPC request named `_rookery/steering_prompt` on the client/server websocket boundary.

Purpose:
- let the user send a message **into the current workflow** without using the normal next-turn queue
- preserve the product affordance of Cursor-style **Send now** while keeping the semantics encapsulated inside the runtime/agent layer

Why it is an extension:
- ACP has `session/prompt` and `session/cancel`
- ACP does **not** define a standard mid-workflow steering prompt primitive
- this behavior is therefore product-specific and belongs in a custom `_...` method

Current Rookery semantics:
- client sends `_rookery/steering_prompt { sessionId, text }`
- websocket route delegates to `SessionRoom.sendSteeringMessage(text)`
- runtime delegates to `BaseAgent.sendSteeringMessage(text)`
- `PiAgent` uses a provider-specific ACP extension hop into `pi-acp`, which forwards the message to pi with `streamingBehavior: "steer"` so pi handles it as a real steering prompt during the active run
- other ACP-backed runtimes currently use the generic fallback: apply the steering prompt at the **next safe point inside the active workflow** before ordinary queued next-turn messages resume

Important design rule:
- the client knows only the semantic intent: **steering prompt**
- provider-specific details must remain contained within the runtime / `BaseAgent` subclass boundary

### Future extension guidance

When Rookery needs behavior outside the ACP core spec, prefer:
1. standard ACP if it already exists
2. `_meta` for annotation/correlation
3. `_rookery/...` custom methods for product-specific behavior

Avoid adding custom root fields to ACP-defined objects.

## Further reading

- Spec: https://agentclientprotocol.com/get-started/introduction
- Extensibility: https://agentclientprotocol.com/protocol/v1/extensibility
- Migration history: `PRODUCT_CHANGES/earlier-documentation/moving-to-agent-client-protocol.md`
