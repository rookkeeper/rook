# Agent Client Protocol

Rookery uses [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/introduction) as the wire format between clients and agent runtimes — the same problem space as LSP, but for coding agents. [Read details in llms.txt](https://agentclientprotocol.com/llms.txt) 

## Where ACP shows up

- **Server/client boundary:** session discovery over REST plus one session-bound WebSocket per session between native clients/CLI and the Fastify ACP facade
- **Agent subprocess boundary:** `SessionRuntime` spawns one stdio ACP server per public session — configured Pi, Claude, Cursor, or generic ACP runtimes
- **UI state:** `SessionHandle` / platform reducers and controls (tools, permissions, plans, stop/cancel, queued messages) map to ACP session methods and `session/update` notifications

## Why ACP

Before ACP, Rookery used a custom realtime event vocabulary. ACP gives us a shared protocol with other editors and agents, first-class permission/plan/usage concepts, and a path to interoperate without per-agent custom integration.

## Rookery ACP extensions

Standard ACP image content blocks are used for image-bearing prompts when the selected runtime advertises image support. Ordered text/image content is sent as ACP prompt blocks in the same sequence the user composed it. Rook does not turn Mac temporary file paths into a protocol-level attachment reference.

ACP explicitly supports product-specific extensions in two ways:

- custom data in `_meta`
- custom JSON-RPC methods whose names start with `_`

Rookery should prefer those sanctioned extension points rather than inventing non-ACP-shaped protocol additions.

### Current Rookery extensions

The live server-owned extension namespace is `_com.rookkeeper`. It currently carries environment offer notifications, offer resolution, and offer-resolution notifications. The extension is session-bound and is routed by `AgentRuntimeManager`.

### Future extension guidance

When Rookery needs behavior outside the ACP core spec, prefer:
1. standard ACP if it already exists
2. `_meta` for annotation/correlation
3. a namespaced `_com.rookkeeper/...` custom method for product-specific behavior

Avoid adding custom root fields to ACP-defined objects.

## Further reading

- Spec: https://agentclientprotocol.com/get-started/introduction
- Extensibility: https://agentclientprotocol.com/protocol/v1/extensibility
- Migration history: `PRODUCT_CHANGES/earlier-documentation/moving-to-agent-client-protocol.md`
