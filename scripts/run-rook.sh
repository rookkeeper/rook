#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

SERVER_BIND_HOST="127.0.0.1"
SERVER_AUTH_TOKEN="${ROOK_AUTH_TOKEN:-}"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/run-rook/common.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/run-rook/profile.sh"

configure_run_profile

SERVER_AUTH_TOKEN="${ROOK_AUTH_TOKEN:-}"
log_run_profile

DEFAULT_IOS_APP_BUNDLE_ID="com.rookkeeper.Rook"
DEFAULT_IOS_WIDGET_BUNDLE_ID="${DEFAULT_IOS_APP_BUNDLE_ID}.RookWidgets"
DEFAULT_IOS_TEST_BUNDLE_ID="com.rookkeeper.RookTests"

mkdir -p "$RUN_ROOT" "$BUILD_ROOT"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/run-rook/mac.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/run-rook/iphone.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/run-rook/android.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run-rook.sh server
  ./scripts/run-rook.sh mac
  ./scripts/run-rook.sh iphone [--device NAME_OR_UDID] [--server-url URL] [--reset-permissions] [--simulate-arrival "LAT,LON"]
  ./scripts/run-rook.sh sim [--device NAME_OR_UDID] [--server-url URL] [--reset-permissions] [--simulate-arrival "LAT,LON"]
  ./scripts/run-rook.sh android
  ./scripts/run-rook.sh server mac iphone
  ./scripts/run-rook.sh stop [--all]

What it does:
  - starts the selected Rook server if needed
  - rebuilds / launches the selected target(s)
  - selects a production profile from the main checkout and an isolated development profile from a worktree
  - keeps the selected server, data, logs, and Mac app instance isolated from other profiles

Notes:
  - you can pass multiple targets; they run in the order given
  - mac uses localhost by default
  - iphone uses ROOK_REMOTE_HOSTNAME, ROOK_BIND_IP, or a non-localhost
    ROOK_SERVER_HOST by default; pass --server-url to override
  - sim uses localhost by default; pass --server-url to override
  - android is currently a placeholder target
  - the server always binds localhost; ROOK_BIND_IP adds a second remote listener
  - the server runs as a detached background process and logs to the selected profile's run directory
  - `stop` stops the current profile; `stop --all` is the explicit broad cleanup command
  - development worktrees use a deterministic port and `~/.rook-<worktree-name>` by default
  - iphone signing now follows the Xcode project’s configured DEVELOPMENT_TEAM and bundle identifiers
  - stop shuts down the server, mac app(s), iphone app(s), and android app if present
EOF
}

TARGETS=()
DEVICE_FILTER=""
RESET_PERMISSIONS=0
SERVER_URL=""
SIMULATE_ARRIVAL=""
STOP_ALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    server|mac|iphone|sim|android|stop)
      TARGETS+=("$1")
      shift
      ;;
    --reset-permissions)
      RESET_PERMISSIONS=1
      shift
      ;;
    --device)
      DEVICE_FILTER="${2:-}"
      shift 2
      ;;
    --server-url)
      SERVER_URL="${2:-}"
      shift 2
      ;;
    --simulate-arrival)
      SIMULATE_ARRIVAL="${2:-}"
      shift 2
      ;;
    --all)
      STOP_ALL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ ${#TARGETS[@]} -gt 0 ]] || { usage; exit 2; }

HAS_SERVER_TARGET=0
HAS_SERVER_NEXT_TARGET=0
HAS_IPHONE_TARGET=0
HAS_MAC_TARGET=0
HAS_SIM_TARGET=0
HAS_ANDROID_TARGET=0
for target in "${TARGETS[@]}"; do
  case "$target" in
    server) HAS_SERVER_TARGET=1 ;;
    iphone) HAS_IPHONE_TARGET=1 ;;
    sim) HAS_SIM_TARGET=1 ;;
    mac) HAS_MAC_TARGET=1 ;;
    android) HAS_ANDROID_TARGET=1 ;;
    stop) ;;
  esac
done

SERVER_KIND="$RUN_ROOK_PROFILE"
SERVER_PACKAGE_DIR="$REPO_ROOT/server"
SERVER_LOG="$CURRENT_SERVER_LOG"
SERVER_PIDFILE="$CURRENT_SERVER_PIDFILE"
SERVER_HEALTH_URL="http://${SERVER_BIND_HOST}:${SERVER_PORT}/api/health"

if (( STOP_ALL )) && [[ "${TARGETS[0]:-}" != "stop" ]]; then
  die "--all can only be used with stop"
fi

if (( ${#TARGETS[@]} > 1 )); then
  for target in "${TARGETS[@]}"; do
    if [[ "$target" == "stop" ]]; then
      die "stop must be used by itself"
    fi
  done
fi

need_cmd curl
need_cmd python3
need_cmd lsof

if [[ "${TARGETS[0]}" == "stop" ]]; then
  if (( STOP_ALL )); then
    stop_everything_all
  else
    stop_everything
  fi
  exit 0
fi

stop_requested_targets
start_server

for TARGET in "${TARGETS[@]}"; do
  case "$TARGET" in
    server)
      run_rook_target_server
      ;;
    mac)
      run_rook_target_mac
      ;;
    iphone)
      run_rook_target_iphone
      ;;
    sim)
      run_rook_target_sim
      ;;
    android)
      run_rook_target_android
      ;;
  esac
done
