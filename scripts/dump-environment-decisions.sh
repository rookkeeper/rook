#!/usr/bin/env bash
# Dump the environment_decisions table to the terminal.
# Run from repo root: ./scripts/dump-environment-decisions.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --experimental-sqlite scripts/dump-environment-decisions.ts "$@"
