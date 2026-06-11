#!/usr/bin/env bash
# Exercise the remote-agent bridge without the web UI. Run from repo root:
#
#   ./scripts/interact-with-remote-agent.sh [options] <prompt>
#   npm run agent:cli -- [options] <prompt>
#
# Setup once: cd agent-server-client && npm install
#
# Common flags: --agent PiAgent | MyPiAgent  --omit-deltas  --only <types>  --omit <types>
#               --session '<json>'  --restart  --replay  --no-session  --no-replay  --raw-acp  --help
#
# SessionEvent types (--omit-deltas hides text_delta, thinking_delta, tool_input_delta, tool_output_delta):
#   status_changed  user_message  assistant_message_started  assistant_message_completed
#   assistant_message_error  text_delta  thinking_delta  tool_call_started  tool_input_delta
#   tool_call_ready  tool_running  tool_output_delta  tool_completed  tool_error
#   run_completed  run_failed  protocol_error  connection_error  environment_event
#
# Full example:
#   ./scripts/interact-with-remote-agent.sh \
#     --agent MyPiAgent \
#     --session '{"id":"8f2c1a40-9b3e-4d12-8c01-2a9f0e7d31b4","agent":"MyPiAgent","name":"vault-chat","createdAt":"2026-06-02T18:30:00.000Z","restart":{"cwd":"/Users/me/vault"}}' \
#     --restart --replay --omit-deltas --omit status_changed,environment_event \
#     "Summarize our thread and list open tasks"
#
# Full documentation: see the header comment in interact-with-remote-agent.ts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_ROOT="$REPO_ROOT/agent-server-client"
TSX="$CLIENT_ROOT/node_modules/tsx/dist/cli.mjs"

if [[ ! -f "$TSX" ]]; then
  echo "Missing tsx. Install deps once:" >&2
  echo "  cd \"$CLIENT_ROOT\" && npm install" >&2
  exit 1
fi

exec node "$TSX" --tsconfig "$CLIENT_ROOT/tsconfig.json" "$SCRIPT_DIR/interact-with-remote-agent.ts" "$@"
