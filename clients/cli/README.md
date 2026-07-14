# Rook CLI

A tiny ACP-first command-line client for the real Rook server.

It creates a new session for one configured runtime, sends prompts over ACP WebSocket, and prints colored output as events arrive.

## Install

From the repo root:

```bash
cd clients/cli
npm install
npm link
```

That installs the `rook` command locally.

## Usage

Interactive chat:

```bash
rook --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN"
```

Resume an existing session:

```bash
rook --sessionId <sessionId>
```

One-shot turn:

```bash
rook --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" "summarize this repo"
# or
rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" "summarize this repo"
```

Resume an existing session for one turn:

```bash
rook exec --sessionId <sessionId> "what did you just say?"
```

Only print the final assistant message:

```bash
rook exec --last-message-only --runtime MyPiOpenAiAgent "say hi"
```

Optional flags:

- `--server-url http://127.0.0.1:7665`
- `--auth-token <token>`
- `--title <session-title>`

Defaults:

- `ROOK_SERVER_BASE_URL` or `http://127.0.0.1:7665`
- `ROOK_AUTH_TOKEN`

## Output colors

- `user:` green
- thoughts purple
- tool calls blue
- tool outputs light blue
- assistant text red

## Notes

- `Ctrl+C` prints the session id and exits.
- `rook exec ...` prints the session id after the turn finishes.
- permission requests are auto-cancelled in this minimal client.
