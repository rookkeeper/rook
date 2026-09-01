#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/rook-run-rook-mac.XXXXXX")"
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill_process_tree "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

log() { :; }
die() { echo "unexpected failure: $*" >&2; exit 1; }

FAKE_BIN="$TEST_ROOT/bin"
APP="$TEST_ROOT/Rook.app"
mkdir -p "$FAKE_BIN" "$APP/Contents/MacOS"
cat >"$FAKE_BIN/osascript" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_BIN/osascript"
cat >"$APP/Contents/MacOS/Rook" <<'EOF'
#!/usr/bin/env bash
{
  printf 'ROOK_SERVER_BASE_URL=%s\n' "${ROOK_SERVER_BASE_URL:-}"
  printf 'ROOK_RUN_MODE=%s\n' "${ROOK_RUN_MODE:-}"
  printf 'ROOK_HOME=%s\n' "${ROOK_HOME:-}"
  printf 'ROOK_DATABASE_PATH=%s\n' "${ROOK_DATABASE_PATH:-}"
  printf 'ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB=%s\n' "${ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB:-}"
  printf 'PORT=%s\n' "${PORT:-}"
} >"$CAPTURE"
sleep 120
EOF
chmod +x "$APP/Contents/MacOS/Rook"

export PATH="$FAKE_BIN:$PATH"
export CAPTURE="$TEST_ROOT/environment.txt"
SERVER_PORT=8532
RUN_ROOK_PROFILE=development
ROOK_HOME="$TEST_ROOT/profile"
SERVER_DATABASE_PATH="$ROOK_HOME/rook.sqlite"
SERVER_AUTH_TOKEN="test-token"
unset ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB

open_mac_app_bundle "$APP"
app_pid="$(pgrep -f "$APP/Contents/MacOS/Rook" | head -1)"
[[ -n "$app_pid" ]] || die "expected fake Mac app to remain running"

grep -Fx 'ROOK_SERVER_BASE_URL=http://127.0.0.1:8532' "$CAPTURE" >/dev/null
grep -Fx 'ROOK_RUN_MODE=development' "$CAPTURE" >/dev/null
grep -Fx "ROOK_HOME=$TEST_ROOT/profile" "$CAPTURE" >/dev/null
grep -Fx "ROOK_DATABASE_PATH=$TEST_ROOT/profile/rook.sqlite" "$CAPTURE" >/dev/null
grep -Fx "ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB=$TEST_ROOT/profile/environment-repository.db" "$CAPTURE" >/dev/null
grep -Fx 'PORT=8532' "$CAPTURE" >/dev/null

printf 'PASS: run-rook Mac launch environment tests\n'
