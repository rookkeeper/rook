#!/usr/bin/env bash
# Clear persisted environment decisions (approve / reject) so environment offers start fresh.
# Run from repo root.
set -euo pipefail

DB_PATH="${AGENT_STATION_ENV_DECISIONS_DB:-.var/agent-station/environment-decisions.sqlite}"
ABS_DB_PATH="$(cd "$(dirname "$DB_PATH")" 2>/dev/null && pwd)/$(basename "$DB_PATH")"

usage() {
  cat <<'EOF'
Usage: drop-database.sh [--yes]

Deletes the current Agent Station SQLite DB.
Right now that clears all remembered environment approve/reject decisions.

Environment:
  AGENT_STATION_ENV_DECISIONS_DB   Override DB path
                                   (default: .var/agent-station/environment-decisions.sqlite)

Examples:
  ./scripts/drop-database.sh
  ./scripts/drop-database.sh --yes
EOF
}

ASSUME_YES=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      ASSUME_YES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$DB_PATH" ]]; then
  echo "No environment decision DB found at: $DB_PATH"
  exit 0
fi

if [[ "$ASSUME_YES" != true ]]; then
  read -r -p "Delete environment decisions DB at $DB_PATH? [y/N] " REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

rm -f "$DB_PATH"
echo "Deleted: $ABS_DB_PATH"
