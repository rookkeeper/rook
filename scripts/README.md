# Scripts

All scripts run from the repo root and follow a consistent pattern: self-contained `.sh` files with supporting libraries tucked into `lib/<script-name>/`.

`run-rook.sh` now follows that split too: target-specific functionality lives under `scripts/lib/run-rook/`.

## Script index

### `run-rook.sh` — build and launch the server + clients

The primary development entry point. Starts the server (if needed) and builds + launches native clients.

```bash
./scripts/run-rook.sh server                    # start the main server
./scripts/run-rook.sh mac                       # build and launch the current macOS client
./scripts/run-rook.sh iphone                    # build and deploy the current physical-iPhone client
./scripts/run-rook.sh sim                       # build and launch the iPhone simulator client
./scripts/run-rook.sh android                   # placeholder target for now
./scripts/run-rook.sh server mac iphone         # run multiple targets
./scripts/run-rook.sh stop                      # stop the current checkout's profile
./scripts/run-rook.sh stop --all                # explicit broad cleanup of Rook processes
```

Flags: `--device NAME_OR_UDID`, `--server-url URL`, `--reset-permissions`, `--simulate-arrival "LAT,LON"`, and `--all` for `stop`.

`run-rook.sh` selects a production profile when run from the main checkout and an isolated development profile when run from a Git worktree. Development profiles use a deterministic port, `~/.rook-<worktree-slug>` for user-local state, an isolated SQLite database, and a distinct Mac app identity. The slug includes a short hash of the canonical worktree path, so same-named worktrees remain distinct. Set `ROOK_RUN_MODE=production|development` to override detection, or `ROOK_PRODUCTION_ROOT` to identify the main checkout explicitly. The launcher computes and exports `ROOK_HOME` and `ROOK_DATABASE_PATH` for the selected profile; to override those at launch time, use `RUN_ROOK_HOME` and `RUN_ROOK_DATABASE_PATH` rather than inheriting ambient `ROOK_HOME` / `ROOK_DATABASE_PATH` values. Development servers honor the checkout's configured remote/Tailscale listener. On first launch, development profiles seed their isolated home by copying `~/.rook`, then remove the copied application database so the development profile starts without inherited session history; later changes stay profile-local. Set `ROOK_AGENT_RUNTIMES_PATH` to use a different runtime catalog explicitly.

### `npm run test:launcher` — test launcher profiles and lifecycle

Runs hermetic Bash tests from `lib/run-rook/` using temporary Git worktrees, fake processes, and fake listeners. The tests cover profile selection, path/port configuration, same-basename worktrees, profile-scoped stopping, `stop --all` discovery, and refusal to adopt another profile's healthy server.

### `run-tests.sh` — run all test suites

Runs server tests (vitest), RookKit Swift package tests, iPhone XCTest suite, and macOS build validation in sequence.

```bash
./scripts/run-tests.sh
```

## Development tools

### Mock ACP test server — replay transcripts without a real AI backend

The mock ACP test server (`server/src/agents/test-fixtures/mockAcpServer.mjs`) replays a pre-recorded transcript instead of calling a live AI. Useful for testing the UI, error surfacing, tool rendering, streaming behavior, and session lifecycle without burning API credits or needing network access.

**How it works:**
- Reads `.var/example_transcript.json` — a JSON array of "turns", each containing thinking, agent messages, tool calls, and tool results
- On each user message, ignores the input and replays the next turn token-by-token (split on whitespace, ~20ms per token, 500ms between messages)
- Emits proper ACP session updates so the UI renders identically to a real agent
- Minimal ACP subprocess that keeps the test/runtime surface deterministic

**Transcript format** (see `.agents/skills/create-a-mock-transcript/SKILL.md` for details):
```json
[
  {
    "timestamp": "2026-07-05T12:00:00Z",
    "events": [
      { "type": "thinking",      "text": "Let me think..." },
      { "type": "agent_message", "text": "Here's the result." },
      { "type": "tool_call",     "id": "call_1", "name": "read", "input": { "path": "foo.txt" } },
      { "type": "tool_result",   "id": "call_1", "output": "contents here" },
      { "type": "agent_message", "text": "The file says hello." }
    ]
  }
]
```

**Getting started:**
1. Ask the agent (using the `create-a-mock-transcript` skill) to create `.var/example_transcript.json`, or hand-craft one
2. Start the server + Mac client: `./scripts/run-rook.sh server mac`
3. Select MockAgent from the agent list and start a session
4. Send any message — the first turn replays. Send again for turn 2, etc.

MockAgent is fully modular: delete `MockAgent.ts` and its single registration line in `agentDiscovery.ts` to remove it. Nothing else depends on it.

### `print-environments.sh` — dump environment diagnostics

Hits `GET /api/diagnostics/environments` on the running server and pretty-prints active/recent environment state with counts.

```bash
./scripts/print-environments.sh
./scripts/print-environments.sh --url http://127.0.0.1:7665 --token "$ROOK_AUTH_TOKEN" --raw
```

### `dump-environment-decisions.sh` — dump the environment-decisions SQLite database

Reads the active `ROOK_DATABASE_PATH` (or `ROOK_HOME/rook.sqlite`) and prints the `environment_decisions` table to the terminal.

```bash
./scripts/dump-environment-decisions.sh
```

Supporting library: `lib/dump-environment-decisions/`

### `screenshot-with-voice.sh` — voice-annotated screenshot

Runs any command, voiced by `say`. Used during screen recordings to signal when a screenshot is being taken.

```bash
./scripts/screenshot-with-voice.sh screencapture -C ~/Desktop/screenshot.png
```

## Library structure

```
lib/
├── dump-environment-decisions/         # TypeScript tool to read the decisions DB
│   └── dump-environment-decisions.ts
└── run-rook/                           # Shared bash helpers + per-target launch logic
    ├── common.sh
    ├── profile.sh
    ├── mac.sh
    ├── iphone.sh
    └── android.sh
```

Each `lib/<script-name>/` subdirectory is self-contained: it contains only the TypeScript modules and type definitions that the corresponding shell script needs. No library code is shared across scripts.
