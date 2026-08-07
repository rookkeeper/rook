#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/rook-run-rook-lifecycle.XXXXXX")"
cleanup_pids=()
cleanup() {
  for pid in "${cleanup_pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

log() { :; }
stop_mac_app() { :; }
stop_all_mac_apps() { :; }
stop_android_app() { :; }
port_cleanup_calls=0
kill_server_on_port() { ((port_cleanup_calls+=1)); }
pkill() { :; }
xcrun() { return 1; }

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_absent() {
  [[ ! -e "$1" ]] || fail "expected '$1' to be absent"
}

assert_eq() {
  [[ "$1" == "$2" ]] || fail "expected '$1' to equal '$2'"
}

assert_alive() {
  kill -0 "$1" >/dev/null 2>&1 || fail "expected process $1 to remain alive"
}

assert_dead() {
  local pid="$1"
  wait "$pid" 2>/dev/null || true
  ! kill -0 "$pid" >/dev/null 2>&1 || fail "expected process $pid to be stopped"
}

spawn_server_process() {
  sleep 120 &
  spawned_pid="$!"
  cleanup_pids+=("$spawned_pid")
}

# A current-profile stop must not touch another profile's process.
CURRENT_SERVER_PIDFILE="$TEST_ROOT/current/server.pid"
SERVER_PIDFILE="$CURRENT_SERVER_PIDFILE"
RUN_ROOK_PROFILE_SLUG="test"
SERVER_PORT=8999
mkdir -p "$(dirname "$CURRENT_SERVER_PIDFILE")"
spawn_server_process
current_pid="$spawned_pid"
spawn_server_process
other_pid="$spawned_pid"
printf '%s\n' "$current_pid" >"$CURRENT_SERVER_PIDFILE"
stop_everything >/dev/null 2>&1
assert_dead "$current_pid"
assert_alive "$other_pid"
assert_file_absent "$CURRENT_SERVER_PIDFILE"
assert_eq "$port_cleanup_calls" "1"
kill "$other_pid"
wait "$other_pid" 2>/dev/null || true

# A profile without a live PID owner must not clean up a port it does not own.
unowned_pidfile="$TEST_ROOT/unowned/server.pid"
mkdir -p "$(dirname "$unowned_pidfile")"
spawn_server_process
unowned_pid="$spawned_pid"
SERVER_PIDFILE="$unowned_pidfile"
stop_server_for_profile >/dev/null 2>&1
assert_alive "$unowned_pid"
assert_eq "$port_cleanup_calls" "1"
kill "$unowned_pid"
wait "$unowned_pid" 2>/dev/null || true

# stop --all's discovery must stop the managed server PID in every Git worktree.
REPOSITORY="$TEST_ROOT/repository"
mkdir -p "$REPOSITORY"
git -C "$REPOSITORY" init -q -b main
git -C "$REPOSITORY" config user.email test@example.com
git -C "$REPOSITORY" config user.name "Rook test"
printf 'fixture\n' >"$REPOSITORY/README.md"
git -C "$REPOSITORY" add README.md
git -C "$REPOSITORY" commit -q -m fixture
git -C "$REPOSITORY" worktree add -q "$TEST_ROOT/worktree" -b feature
mkdir -p "$REPOSITORY/.var/run-rook" "$TEST_ROOT/worktree/.var/run-rook"

spawn_server_process
main_pid="$spawned_pid"
spawn_server_process
worktree_pid="$spawned_pid"
printf '%s\n' "$main_pid" >"$REPOSITORY/.var/run-rook/server.pid"
printf '%s\n' "$worktree_pid" >"$TEST_ROOT/worktree/.var/run-rook/server.pid"
REPO_ROOT="$REPOSITORY"
stop_everything_all >/dev/null 2>&1
assert_dead "$main_pid"
assert_dead "$worktree_pid"
assert_file_absent "$REPOSITORY/.var/run-rook/server.pid"
assert_file_absent "$TEST_ROOT/worktree/.var/run-rook/server.pid"

# A healthy listener without this profile's PID file must not be adopted.
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FAKE_BIN"
cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '{"ok":true}\n'
EOF
chmod +x "$FAKE_BIN/curl"
export PATH="$FAKE_BIN:$PATH"
SERVER_HEALTH_URL="http://127.0.0.1:8998/api/health"
SERVER_AUTH_TOKEN=""
SERVER_PORT=8998
SERVER_KIND=development
SERVER_LOG="$TEST_ROOT/server.log"
SERVER_PIDFILE="$TEST_ROOT/no-owner.pid"
HAS_IPHONE_TARGET=0
if (start_server) >/dev/null 2>&1; then
  fail "a profile must not adopt a healthy server without its PID file"
fi

# A healthy server with this profile's live PID file is reusable.
spawn_server_process
owned_pid="$spawned_pid"
printf '%s\n' "$owned_pid" >"$SERVER_PIDFILE"
start_server
kill "$owned_pid"
wait "$owned_pid" 2>/dev/null || true

printf 'PASS: run-rook lifecycle tests\n'
