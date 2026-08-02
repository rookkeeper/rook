# Agent Client Protocol

Rook uses [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/introduction) across its runtime boundary. The server is the stable broker between native clients, public sessions, and selected agent runtimes.

## Protocol shape

```text
Mac/iPhone/Android client
        │ REST + ACP WebSocket
        ▼
Fastify Rook server
        │ ACP over stdio
        ▼
one runtime subprocess per public session
```

Client interaction uses a session-bound WebSocket at `/api/ws?sessionId=...` plus REST for health, session listing, transcript hydration, environment previews, registration, and decisions. An unbound socket can create a session and becomes bound to it.

The server maps public session ids to runtime-local ACP session ids and owns normalized transcript persistence. A second client can hydrate a running session from the server transcript without asking the runtime to replay publicly.

## Environment integration

Every configured runtime receives the base Rook identity prompt, including sessions with no entered environment. Environment-specific instructions are added later through the same runtime configuration.

Environment changes are Rook orchestration around ACP:

1. resolve approved/personal bundle revisions
2. materialize a fresh per-session workspace
3. compute skill paths and generated instruction text
4. replace the affected runtime
5. load the existing runtime session successfully
6. retire the old subprocess

The runtime receives files and paths, not repository/database handles. Personal workspace edits are synchronized before rematerialization.

## Rook ACP extensions

Rook uses ACP extension points for product-specific messages, including environment offers and their resolutions. Custom methods use `_`-prefixed names and carry Rook-specific semantics; standard ACP methods remain the runtime contract.

Provider-specific behavior belongs inside the runtime adapter. Clients observe semantic session/environment events rather than knowing whether the subprocess is Pi, Claude, Cursor, or another ACP runtime.

## Runtime safety

ACP does not itself provide repository trust or filesystem isolation. Rook's bundle approval hash, per-session workspace, writable-source mapping, and read-only projection policy sit above ACP. Stronger OS isolation, runtime-specific tool replacement, prompt-injection validation, and MCP lifecycle security remain future work.
