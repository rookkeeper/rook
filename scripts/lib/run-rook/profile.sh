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

worktree_profile_slug() {
  local root
  root="$(canonical_path "$1")"
  local name
  name="$(sanitize_profile_slug "$(basename "$root")")"
  local path_hash
  path_hash="$(python3 - <<'PY' "$root"
import os, sys, zlib
print(f"{zlib.crc32(os.path.realpath(sys.argv[1]).encode()) & 0xffffffff:08x}")
PY
)"
  printf '%s-%s\n' "$name" "$path_hash"
}

configure_run_profile() {
  local production_root
  production_root="$(resolve_production_root)"
  local checkout_root
  checkout_root="$(canonical_path "$REPO_ROOT")"

  local requested_mode="${ROOK_RUN_MODE:-}"
  if [[ -n "$requested_mode" && "$requested_mode" != "production" && "$requested_mode" != "development" ]]; then
    die "ROOK_RUN_MODE must be production or development"
  fi

  if [[ -n "$requested_mode" ]]; then
    RUN_ROOK_PROFILE="$requested_mode"
  elif [[ "$checkout_root" == "$production_root" ]]; then
    RUN_ROOK_PROFILE="production"
  else
    RUN_ROOK_PROFILE="development"
  fi

  if [[ "$RUN_ROOK_PROFILE" == "production" && "$checkout_root" != "$production_root" && "${ROOK_ALLOW_NON_PRODUCTION_ROOT:-0}" != "1" ]]; then
    die "production profile requested outside the configured production checkout: $REPO_ROOT"
  fi

  RUN_ROOK_PROFILE_SLUG="production"
  RUN_ROOK_APP_BUNDLE_ID="com.rookkeeper.Rook"
  RUN_ROOK_APP_DISPLAY_NAME="Rook"
  RUN_ROOK_DEFAULT_PORT="7665"
  RUN_ROOK_HOME_DEFAULT="$HOME/.rook"

  if [[ "$RUN_ROOK_PROFILE" == "development" ]]; then
    RUN_ROOK_PROFILE_SLUG="$(worktree_profile_slug "$REPO_ROOT")"
    RUN_ROOK_APP_BUNDLE_ID="com.rookkeeper.Rook.Dev.${RUN_ROOK_PROFILE_SLUG//-/.}"
    RUN_ROOK_APP_DISPLAY_NAME="Rook Dev (${RUN_ROOK_PROFILE_SLUG})"
    RUN_ROOK_DEFAULT_PORT="$(deterministic_dev_port "$RUN_ROOK_PROFILE_SLUG")"
    RUN_ROOK_HOME_DEFAULT="$HOME/.rook-${RUN_ROOK_PROFILE_SLUG}"
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
  ROOK_HOME="${RUN_ROOK_HOME:-$RUN_ROOK_HOME_DEFAULT}"
  RUN_ROOK_DATABASE_PATH_EXPLICIT=0
  if [[ -n "${RUN_ROOK_DATABASE_PATH:-}" ]]; then
    RUN_ROOK_DATABASE_PATH_EXPLICIT=1
  fi
  SERVER_DATABASE_PATH="${RUN_ROOK_DATABASE_PATH:-$ROOK_HOME/rook.sqlite}"

  export RUN_ROOK_PROFILE RUN_ROOK_PROFILE_SLUG
  export RUN_ROOK_APP_BUNDLE_ID RUN_ROOK_APP_DISPLAY_NAME
  export SERVER_PORT RUN_ROOT BUILD_ROOT CURRENT_SERVER_LOG CURRENT_SERVER_PIDFILE
  export SERVER_DATABASE_PATH ROOK_DATABASE_PATH="$SERVER_DATABASE_PATH" ROOK_HOME

  # The server reads PORT, not ROOK_SERVER_PORT. Set it after loading .env so a
  # worktree cannot silently inherit production's PORT=7665.
  export PORT="$SERVER_PORT"

}

initialize_development_home() {
  [[ "$RUN_ROOK_PROFILE" == "development" ]] || return 0
  [[ -d "$ROOK_HOME" ]] && return 0

  local source_home="$HOME/.rook"
  mkdir -p "$ROOK_HOME"
  if [[ -d "$source_home" && "$source_home" != "$ROOK_HOME" ]]; then
    cp -a "$source_home/." "$ROOK_HOME/"
    rm -f "$ROOK_HOME/rook.sqlite" "$ROOK_HOME/rook.sqlite-shm" "$ROOK_HOME/rook.sqlite-wal"
    log "initialized development Rook home by copying $source_home without session database"
  else
    log "initialized empty development Rook home at $ROOK_HOME"
  fi
}

migrate_legacy_production_database_if_needed() {
  # THIS IS FOR BACKWARDS COMPATIBILITY: preserve existing production session
  # history by moving the legacy repo-local application database into the new
  # ROOK_HOME/rook.sqlite location the first time the launcher starts.
  [[ "$RUN_ROOK_PROFILE" == "production" ]] || return 0
  [[ "$RUN_ROOK_DATABASE_PATH_EXPLICIT" == "0" ]] || return 0

  local legacy_database_path="$REPO_ROOT/.var/rook/rook.sqlite"
  [[ -e "$legacy_database_path" ]] || return 0
  [[ ! -e "$SERVER_DATABASE_PATH" ]] || return 0

  mkdir -p "$(dirname "$SERVER_DATABASE_PATH")"
  local suffix
  for suffix in "" "-shm" "-wal"; do
    [[ -e "$legacy_database_path$suffix" ]] || continue
    mv "$legacy_database_path$suffix" "$SERVER_DATABASE_PATH$suffix"
  done
  log "migrated legacy production database to $SERVER_DATABASE_PATH"
}

initialize_profile_state() {
  initialize_development_home
  migrate_legacy_production_database_if_needed
}

log_run_profile() {
  log "profile: $RUN_ROOK_PROFILE ($RUN_ROOK_PROFILE_SLUG)"
  log "checkout: $REPO_ROOT"
  log "server: http://${SERVER_BIND_HOST}:${SERVER_PORT}"
  log "ROOK_HOME: $ROOK_HOME"
  log "database: $SERVER_DATABASE_PATH"
}
