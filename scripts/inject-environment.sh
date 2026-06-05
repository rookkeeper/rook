#!/usr/bin/env bash
# Signal that an environment is available (and optionally record a decision for it).
# Run from repo root while the agent-server-client dev server is up.
#
#   ./scripts/inject-environment.sh demo:demo
#   ./scripts/inject-environment.sh --decide accept demo:demo
#   ./scripts/inject-environment.sh --unavailable demo:demo
#
# Availability and decisions are GLOBAL (they apply to every open session). The server
# pushes offers/enters to open chat sessions over the websocket — no session id needed.
set -euo pipefail

BASE_URL="${AGENT_STATION_URL:-http://127.0.0.1:3000}"
DECISION=""
UNAVAILABLE=false
ENVIRONMENT_ID=""

usage() {
  cat <<'EOF'
Usage: inject-environment.sh [options] <environment-id>

Register an environment as available. Open chat sessions receive an offer over the
websocket and prompt the user to decide (accept / approve / ignore / reject).

Options:
  --base-url URL        Agent Station base URL (default: http://127.0.0.1:3000)
  --decide DECISION     Immediately record a decision: accept | approve | ignore | reject
  --unavailable         Mark the environment unavailable instead of registering it
  -h, --help            Show this help

Examples:
  ./scripts/inject-environment.sh demo:demo
  ./scripts/inject-environment.sh --decide approve demo:demo
  ./scripts/inject-environment.sh --unavailable demo:demo
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:?missing value for --base-url}"
      shift 2
      ;;
    --decide)
      DECISION="${2:?missing value for --decide}"
      shift 2
      ;;
    --unavailable)
      UNAVAILABLE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$ENVIRONMENT_ID" ]]; then
        echo "Unexpected extra argument: $1" >&2
        exit 1
      fi
      ENVIRONMENT_ID="$1"
      shift
      ;;
  esac
done

if [[ -z "$ENVIRONMENT_ID" ]]; then
  echo "Missing environment id (e.g. demo:demo)." >&2
  usage >&2
  exit 1
fi

if [[ "$UNAVAILABLE" == true ]]; then
  curl -fsS -X POST "$BASE_URL/api/environments/unavailable" \
    -H 'content-type: application/json' \
    -d "{\"id\":\"$ENVIRONMENT_ID\"}"
  echo
  exit 0
fi

curl -fsS -X POST "$BASE_URL/api/environments/register" \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$ENVIRONMENT_ID\"}"
echo

if [[ -n "$DECISION" ]]; then
  curl -fsS -X POST "$BASE_URL/api/environments/decision" \
    -H 'content-type: application/json' \
    -d "{\"environmentId\":\"$ENVIRONMENT_ID\",\"decision\":\"$DECISION\"}"
  echo
fi
