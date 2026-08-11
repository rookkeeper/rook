# CLI, protocol, and replay debugging

Use this lane first for runtime behavior, ACP messages, prompt delivery,
tool calls, session state, and transcript rendering. It is faster and more
deterministic than rebuilding a native client.

## Authentication

Source `.env` first. All `rook` commands need the bearer token:

```bash
source .env
rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" "tell me a joke"
```

## One-shot and interactive commands

```bash
rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" "tell me a joke"
rook exec --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN" "what did you just say?"
rook exec --last-message-only --runtime MockAcpAgent --auth-token "$ROOK_AUTH_TOKEN" "12+34"

rook sessions --auth-token "$ROOK_AUTH_TOKEN"
rook sessions --limit 5 --auth-token "$ROOK_AUTH_TOKEN"
rook --transcript --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN"
rook environments --auth-token "$ROOK_AUTH_TOKEN"
rook environments --limit 5 --auth-token "$ROOK_AUTH_TOKEN"

rook --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN"
rook --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN"
```

Ctrl+C prints the session ID and exits.

Create or resume a session with environment changes:

```bash
rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" \
  --join location:office "hi"
rook exec --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN" \
  --leave web:example.com "done"
```

`--join` and `--leave` are repeatable and work with both `--runtime` and
`--sessionId`. `--title` only works with `--runtime` when creating a session.

## Mock agent

Fixture: `server/src/server/agents/test-fixtures/mockAcpServer.mjs`

The mock agent:

- stores a transcript and replays it on `session/load`
- streams thoughts, tool calls, tool outputs, and assistant text
- handles jokes, `ls`, arithmetic, and prime checking
- serializes replay and prompt processing with `enqueue`

Add a deterministic scenario to this fixture when testing client protocol
behavior. Do not reach for a real model until the mock scenario is understood.

## Transcript replay comparison

Use this when the server transcript and native rendering disagree.

1. Create a named session:
   ```bash
   rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" \
     --title "replay-test" "ls the directory"
   ```
2. Dump the source transcript:
   ```bash
   rook --transcript --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN"
   ```
3. Restart the Mac app, because its sessions list does not auto-refresh:
   ```bash
   ./scripts/run-rook.sh mac server
   ```
4. Have Codex click the session by name and describe every message:
   ```bash
   codex exec "Use computer use. Interact with the Rook app at .../.var/run-rook/build/Rook/...Rook.app. Click the session named 'replay-test'. Describe every message in order." 2>/dev/null
   ```
5. Compare the CLI transcript with the rendered report.

## Replay invariants

- Clear visible blocks **before** `session/load`, not after, or replay events are wiped.
- Buffer user, assistant, and thinking replay events separately from active-turn streaming.
- Keep `isRunning == false` during replay so the status dot does not glow.
