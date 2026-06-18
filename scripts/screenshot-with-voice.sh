#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 2
fi

say 'taking screenshot.' &
SAY_PID=$!
wait "$SAY_PID" 2>/dev/null || true

"$@"
STATUS=$?

if [[ $STATUS -eq 0 ]]; then
  say 'done.' &
else
  say 'done.' &
fi

exit $STATUS
