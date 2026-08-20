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

Client interaction uses a session-bound WebSocket at `/api/ws?sessionId=...` plus REST for health, session listing, session rename/delete/view-touch management, environment previews, registration, and decisions. An unbound socket can create a session and becomes bound to it. Session history is populated exclusively through requester-private ACP `session/load` replay.

The server maps public session ids to runtime-local ACP session ids and does not persist or normalize transcript notifications. Loaded clients retain session handles and their ACP connections in memory, including for background sessions; a genuine disconnect reloads through ACP and replaces cached presentation state. Client-facing ACP notifications are bounded to 10 kB without modifying runtime history. Session recency is server-owned: clients explicitly touch/view a session over REST when entering it so the shared list moves it to the top even if no new prompt is sent. Runtime retry progress is presented to clients, but when the runtime finishes with only retry progress and no actual agent output, Rook converts the prompt to a failed request so the session receives the standard error treatment; a later retry recovery remains successful.

## Environment integration

Every configured runtime receives the base Rook identity prompt, including sessions with no entered environment. Environment-specific instructions are added later through the same runtime configuration.

Standard ACP image content blocks are used for image-bearing prompts when the selected runtime advertises image support. Ordered text/image content is sent as ACP prompt blocks in the same sequence the user composed it. Rook does not turn Mac temporary file paths into a protocol-level attachment reference.

ACP explicitly supports product-specific extensions in two ways:

Environment changes are Rook orchestration around ACP:

1. resolve approved/personal bundles from active capability memberships
2. update shared writable environment sources and per-session links
3. generate the read-only aggregate `AGENTS.md`
4. replace the affected runtime with the agent workspace as cwd
5. load the existing runtime session successfully
6. retire the old subprocess

The runtime receives files and paths, not repository/database handles. Personal source edits are watched and persisted to SQLite; project edits remain direct project-file changes. For Pi, Rook starts the generated workspace with one-run project approval so non-interactive ACP startup loads the standard `.agents/skills` project resources; this is separate from Rook's bundle approval decisions.

## Rook ACP extensions

Rook uses ACP extension points for product-specific messages, including environment offers and their resolutions. Custom methods use `_`-prefixed names and carry Rook-specific semantics; standard ACP methods remain the runtime contract.

Provider-specific behavior belongs inside the runtime adapter. Clients observe semantic session/environment events rather than knowing whether the subprocess is Pi, Claude, Cursor, or another ACP runtime. The server bounds ACP startup, load, prompt, and cancellation waits. If a prompt or cancellation cannot settle, the server force-terminates the complete runtime process group, clears the in-flight turn, and reports an error instead of leaving the session Active indefinitely. A later client request starts one replacement runtime without replaying the interrupted prompt.

## Runtime safety

Rook owns one runtime process group per public session. Runtime creation is serialized per session to prevent duplicate adapters, and Rook shutdown/session deletion terminate each owned group, including provider descendants launched by an adapter. Runtime timeout settings are server controls, with `ROOK_RUNTIME_PROMPT_TIMEOUT_MS`, `ROOK_RUNTIME_REQUEST_TIMEOUT_MS`, `ROOK_RUNTIME_CANCEL_GRACE_MS`, and `ROOK_RUNTIME_SHUTDOWN_TIMEOUT_MS` available for deployment/test tuning.

ACP does not itself provide repository trust or filesystem isolation. Rook's bundle approval hash, per-session workspace, writable-source mapping, and read-only projection policy sit above ACP. Stronger OS isolation, runtime-specific tool replacement, prompt-injection validation, and MCP lifecycle security remain future work.
