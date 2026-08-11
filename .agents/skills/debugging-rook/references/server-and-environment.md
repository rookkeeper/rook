# Server and environment debugging

Use this lane when health, runtime discovery, environment registration, bundle
offers, decisions, or managed processes are suspect. It inspects state directly
instead of inferring it from a client screen.

## Launch profiles

Run from the checkout being investigated:

```bash
./scripts/run-rook.sh server       # server only
./scripts/run-rook.sh mac server   # server + Mac client
./scripts/run-rook.sh sim          # server + iPhone simulator
./scripts/run-rook.sh stop         # stop this profile's resources
```

A worktree profile has isolated ports, `ROOK_HOME`, SQLite state, and app
identity. Keep launcher tests hermetic: use temporary Git repositories/worktrees
and fake processes/listeners. Never modify real `~/.rook` state or stop another
developer's running Rook.

## Diagnostic scripts

```bash
./scripts/interact-with-remote-agent.sh
./scripts/print-environments.sh
./scripts/print-environments.sh --raw
./scripts/dump-environment-decisions.sh
./scripts/run-tests.sh
```

- `interact-with-remote-agent.sh` exercises the remote-agent bridge and needs
  `server/` dependencies installed.
- `print-environments.sh` calls `GET /api/diagnostics/environments` and shows
  active/recent environments, status, and bundle counts.
- `dump-environment-decisions.sh` reads SQLite's `environment_decisions` table
  and shows decisions keyed by bundle hash.
- `run-tests.sh` runs the known server, Swift package, iPhone, and macOS checks.

## Environment storage

Checked-in bundles:

```text
environment-repository/<kind>/<path>/.bundles/<bundle-id>/
```

Runtime-authored bundles:

```text
~/.rook/environment-repository/<kind>/<path>/.bundles/<bundle-id>/
```

For the filesystem shape and authoring model, read:

- `PRODUCT/environment-repository.md`
- `PRODUCT/environment-local-authoring.md`

When a skill or instruction seems missing, inspect both locations. The user-local
location is where `--join` finds agent-authored artifacts.

## Prompt and instruction traces

Use this when the model appears to receive the wrong system prompt, skills,
tools, or environment context:

```bash
./scripts/tail-logs.sh
./scripts/tail-logs.sh --instructions
./scripts/tail-logs.sh --tools
```

These read `/tmp/pi/provider-payload.jsonl` by default, or `PI_TRACE_LOG` when
set. They expose the raw provider payload, including system instructions, skill
content, tool definitions, and injected environment context.

For an exact capture, start the tail in one terminal and trigger a prompt in
another:

```bash
./scripts/tail-logs.sh --instructions
rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" "hi"
```
