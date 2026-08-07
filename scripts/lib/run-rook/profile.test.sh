#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/rook-run-rook-profile.XXXXXX")"
cleanup() {
  git -C "$TEST_ROOT/repository" worktree prune >/dev/null 2>&1 || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

log() { :; }
die() { echo "unexpected failure: $*" >&2; exit 1; }
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/profile.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  [[ "$1" == "$2" ]] || fail "expected '$1' to equal '$2'"
}

assert_ne() {
  [[ "$1" != "$2" ]] || fail "expected '$1' and '$2' to differ"
}

assert_empty() {
  [[ -z "$1" ]] || fail "expected value to be empty, got '$1'"
}

assert_match() {
  [[ "$1" =~ $2 ]] || fail "expected '$1' to match '$2'"
}

REPOSITORY="$TEST_ROOT/repository"
HOME="$TEST_ROOT/home"
mkdir -p "$HOME/.rook/config" "$REPOSITORY"
printf '{"profiles": []}\n' >"$HOME/.rook/config/agent-runtimes.json"
git -C "$REPOSITORY" init -q -b main
git -C "$REPOSITORY" config user.email test@example.com
git -C "$REPOSITORY" config user.name "Rook test"
printf 'fixture\n' >"$REPOSITORY/README.md"
git -C "$REPOSITORY" add README.md
git -C "$REPOSITORY" commit -q -m fixture

mkdir -p "$TEST_ROOT/one" "$TEST_ROOT/two"
git -C "$REPOSITORY" worktree add -q "$TEST_ROOT/one/shared-name" -b feature-one
git -C "$REPOSITORY" worktree add -q "$TEST_ROOT/two/shared-name" -b feature-two

reset_environment() {
  unset ROOK_RUN_MODE ROOK_PRODUCTION_ROOT ROOK_SERVER_PORT ROOK_HOME
  unset ROOK_DATABASE_PATH ROOK_AGENT_RUNTIMES_PATH ROOK_RUN_ROOT RUN_ROOK_BUILD_ROOT PORT
  unset ROOK_BIND_IP ROOK_TAILSCALE_IP ROOK_REMOTE_HOSTNAME ROOK_SERVER_HOST
  unset ROOK_DEV_ALLOW_REMOTE
  SERVER_BIND_HOST="127.0.0.1"
}

configure_for() {
  reset_environment
  REPO_ROOT="$1"
  configure_run_profile
}

configure_for "$REPOSITORY"
assert_eq "$RUN_ROOK_PROFILE" "production"
assert_eq "$RUN_ROOK_PROFILE_SLUG" "production"
assert_eq "$SERVER_PORT" "7665"
assert_eq "$ROOK_HOME" "$HOME/.rook"
assert_eq "$SERVER_DATABASE_PATH" "$REPOSITORY/.var/rook/rook.sqlite"
assert_eq "$RUN_ROOK_ALLOW_REMOTE_DEFAULT" "1"

configure_for "$TEST_ROOT/one/shared-name"
first_slug="$RUN_ROOK_PROFILE_SLUG"
first_port="$SERVER_PORT"
assert_eq "$RUN_ROOK_PROFILE" "development"
assert_match "$first_slug" '^shared-name-[0-9a-f]{8}$'
assert_eq "$SERVER_PORT" "$(deterministic_dev_port "$first_slug")"
assert_ne "$SERVER_PORT" "7665"
assert_eq "$ROOK_HOME" "$HOME/.rook-$first_slug"
assert_eq "$SERVER_DATABASE_PATH" "$HOME/.rook-$first_slug/rook.sqlite"
assert_eq "$RUN_ROOT" "$TEST_ROOT/one/shared-name/.var/run-rook"
assert_empty "${ROOK_BIND_IP:-}"
assert_empty "${ROOK_TAILSCALE_IP:-}"
assert_empty "${ROOK_REMOTE_HOSTNAME:-}"
assert_eq "$ROOK_SERVER_HOST" "127.0.0.1"
assert_eq "$ROOK_AGENT_RUNTIMES_PATH" "$HOME/.rook/config/agent-runtimes.json"

configure_for "$TEST_ROOT/two/shared-name"
second_slug="$RUN_ROOK_PROFILE_SLUG"
assert_ne "$first_slug" "$second_slug"
assert_ne "$first_port" "$SERVER_PORT"

reset_environment
REPO_ROOT="$TEST_ROOT/one/shared-name"
ROOK_SERVER_PORT="8123"
PORT="7665"
ROOK_BIND_IP="10.0.0.2"
ROOK_REMOTE_HOSTNAME="worktree.example"
ROOK_AGENT_RUNTIMES_PATH="$TEST_ROOT/custom-runtimes.json"
configure_run_profile
assert_eq "$SERVER_PORT" "8123"
assert_eq "$ROOK_AGENT_RUNTIMES_PATH" "$TEST_ROOT/custom-runtimes.json"
assert_eq "$PORT" "8123"
assert_empty "$ROOK_BIND_IP"
assert_empty "$ROOK_REMOTE_HOSTNAME"

if (reset_environment; REPO_ROOT="$TEST_ROOT/one/shared-name"; ROOK_RUN_MODE=production; configure_run_profile) >/dev/null 2>&1; then
  fail "production mode should be rejected outside the production checkout"
fi

if (reset_environment; REPO_ROOT="$TEST_ROOT/one/shared-name"; ROOK_RUN_MODE=invalid; configure_run_profile) >/dev/null 2>&1; then
  fail "invalid run mode should be rejected"
fi

echo "PASS: run-rook profile tests"
