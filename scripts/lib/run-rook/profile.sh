#!/usr/bin/env bash

# Resolve the process/data/build profile for this checkout. Keep the profile
# logic here so run-rook.sh remains orchestration rather than a collection of
# worktree-specific conditionals.

canonical_path() {
  python3 - <<'PY' "$1"
import os, sys
print(os.path.realpath(sys.argv[1]))
PY
}

resolve_production_root() {
  if [[ -n "${ROOK_PRODUCTION_ROOT:-}" ]]; then
    canonical_path "$ROOK_PRODUCTION_ROOT"
    return
  fi

  local first_worktree
  first_worktree="$(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null | awk '/^worktree / { print substr($0, 10); exit }')"
  if [[ -n "$first_worktree" ]]; then
    canonical_path "$first_worktree"
  else
    printf '%s\n' "$REPO_ROOT"
  fi
}

sanitize_profile_slug() {
  local raw="$1"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-')"
  raw="${raw#-}"
  raw="${raw%-}"
  [[ -n "$raw" ]] || raw="worktree"
  printf '%s\n' "$raw"
}

deterministic_dev_port() {
  python3 - <<'PY' "$1"
import zlib, sys
# Keep development servers in a predictable, non-production range.
print(8000 + (zlib.crc32(sys.argv[1].encode()) % 1000))
PY
}

configure_run_profile() {
  local production_root
  production_root="$(resolve_production_root)"

  local requested_mode="${ROOK_RUN_MODE:-}"
  if [[ -n "$requested_mode" && "$requested_mode" != "production" && "$requested_mode" != "development" ]]; then
    die "ROOK_RUN_MODE must be production or development"
  fi

  if [[ -n "$requested_mode" ]]; then
    RUN_ROOK_PROFILE="$requested_mode"
  elif [[ "$REPO_ROOT" == "$production_root" ]]; then
    RUN_ROOK_PROFILE="production"
  else
    RUN_ROOK_PROFILE="development"
  fi

  if [[ "$RUN_ROOK_PROFILE" == "production" && "$REPO_ROOT" != "$production_root" && "${ROOK_ALLOW_NON_PRODUCTION_ROOT:-0}" != "1" ]]; then
    die "production profile requested outside the configured production checkout: $REPO_ROOT"
  fi

  RUN_ROOK_PRODUCTION_ROOT="$production_root"
  RUN_ROOK_PROFILE_SLUG="production"
  RUN_ROOK_APP_BUNDLE_ID="com.rookery.Rook"
  RUN_ROOK_APP_DISPLAY_NAME="Rook"
  RUN_ROOK_DEFAULT_PORT="7665"
  RUN_ROOK_HOME_DEFAULT="$HOME/.rook"
  RUN_ROOK_ALLOW_REMOTE_DEFAULT=1

  if [[ "$RUN_ROOK_PROFILE" == "development" ]]; then
    RUN_ROOK_PROFILE_SLUG="$(sanitize_profile_slug "$(basename "$REPO_ROOT")")"
    RUN_ROOK_APP_BUNDLE_ID="com.rookery.Rook.Dev.${RUN_ROOK_PROFILE_SLUG//-/.}"
    RUN_ROOK_APP_DISPLAY_NAME="Rook Dev (${RUN_ROOK_PROFILE_SLUG})"
    RUN_ROOK_DEFAULT_PORT="$(deterministic_dev_port "$RUN_ROOK_PROFILE_SLUG")"
    RUN_ROOK_HOME_DEFAULT="$HOME/.rook-${RUN_ROOK_PROFILE_SLUG}"
    RUN_ROOK_ALLOW_REMOTE_DEFAULT=0
  fi

  if [[ "$RUN_ROOK_PROFILE" == "production" ]]; then
    SERVER_PORT="${ROOK_SERVER_PORT:-${PORT:-$RUN_ROOK_DEFAULT_PORT}}"
  else
    SERVER_PORT="${ROOK_SERVER_PORT:-$RUN_ROOK_DEFAULT_PORT}"
  fi
  RUN_ROOT="${ROOK_RUN_ROOT:-$REPO_ROOT/.var/run-rook}"
  BUILD_ROOT="${RUN_ROOK_BUILD_ROOT:-$RUN_ROOT/build}"
  CURRENT_SERVER_LOG="$RUN_ROOT/server.log"
  CURRENT_SERVER_PIDFILE="$RUN_ROOT/server.pid"
  CURRENT_MAC_PIDFILE="$RUN_ROOT/mac.pid"
  ROOK_HOME="${ROOK_HOME:-$RUN_ROOK_HOME_DEFAULT}"
  ROOK_DEV_ALLOW_REMOTE="${ROOK_DEV_ALLOW_REMOTE:-0}"
  SERVER_DATABASE_PATH="${ROOK_DATABASE_PATH:-$ROOK_HOME/rook.sqlite}"

  if [[ "$RUN_ROOK_PROFILE" == "production" ]]; then
    # Preserve the existing production database location unless explicitly
    # overridden. Development instances default to their isolated Rook home.
    SERVER_DATABASE_PATH="${ROOK_DATABASE_PATH:-$REPO_ROOT/.var/rook/rook.sqlite}"
  fi

  export RUN_ROOK_PROFILE RUN_ROOK_PRODUCTION_ROOT RUN_ROOK_PROFILE_SLUG
  export RUN_ROOK_APP_BUNDLE_ID RUN_ROOK_APP_DISPLAY_NAME
  export RUN_ROOK_DEFAULT_PORT RUN_ROOK_HOME_DEFAULT RUN_ROOK_ALLOW_REMOTE_DEFAULT
  export SERVER_PORT RUN_ROOT BUILD_ROOT CURRENT_SERVER_LOG CURRENT_SERVER_PIDFILE CURRENT_MAC_PIDFILE
  export SERVER_DATABASE_PATH ROOK_DATABASE_PATH="$SERVER_DATABASE_PATH" ROOK_HOME

  # The server reads PORT, not ROOK_SERVER_PORT. Set it after loading .env so a
  # worktree cannot silently inherit production's PORT=7665.
  export PORT="$SERVER_PORT"

  if [[ "$RUN_ROOK_PROFILE" == "development" && "$ROOK_DEV_ALLOW_REMOTE" != "1" ]]; then
    # Keep these variables defined but empty. dotenv will not overwrite an
    # existing environment variable, whereas an unset variable would be
    # repopulated from the worktree's copied .env file.
    export ROOK_BIND_IP=""
    export ROOK_TAILSCALE_IP=""
    export ROOK_REMOTE_HOSTNAME=""
    export ROOK_SERVER_HOST="$SERVER_BIND_HOST"
  fi
}

log_run_profile() {
  log "profile: $RUN_ROOK_PROFILE ($RUN_ROOK_PROFILE_SLUG)"
  log "checkout: $REPO_ROOT"
  log "server: http://${SERVER_BIND_HOST}:${SERVER_PORT}"
  log "ROOK_HOME: $ROOK_HOME"
  log "database: $SERVER_DATABASE_PATH"
}
