#!/usr/bin/env bash

log() { echo "[run-rook] $*"; }
warn() { echo "[run-rook] warning: $*" >&2; }
die() { echo "[run-rook] error: $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

json_escape() {
  python3 - <<'PY' "$1"
import json,sys
print(json.dumps(sys.argv[1]))
PY
}

health_ok() {
  local -a curl_args=(--silent --show-error --fail)
  if [[ -n "$SERVER_AUTH_TOKEN" ]]; then
    curl_args+=( -H "Authorization: Bearer $SERVER_AUTH_TOKEN" )
  fi
  local body
  body="$(curl "${curl_args[@]}" "$SERVER_HEALTH_URL" 2>/dev/null)" || return 1
  [[ -n "$body" ]]
}

listener_is_localhost_only() {
  local out
  out="$(lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$out" ]] || return 1
  if grep -Eq '(localhost:|127\.0\.0\.1:)' <<<"$out" \
    && ! grep -Eq '(\*:|0\.0\.0\.0:|\[::\]:)' <<<"$out" \
    && ! grep -Eq '(^|[[:space:]])(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|100\.)' <<<"$out"; then
    return 0
  fi
  return 1
}

wait_for_health() {
  local attempts=${1:-60}
  local i
  for ((i=1; i<=attempts; i++)); do
    if health_ok; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_server_in_background() {
  need_cmd npm
  log "starting ${SERVER_KIND} server in background (log: $SERVER_LOG)"
  (
    cd "$SERVER_PACKAGE_DIR"
    nohup npm run dev >"$SERVER_LOG" 2>&1 &
    echo $! >"$SERVER_PIDFILE"
  )
}

ensure_server_deps() {
  local server_dir="$SERVER_PACKAGE_DIR"
  if [[ -d "$server_dir/node_modules" ]] && [[ -f "$server_dir/node_modules/tsx/dist/cli.mjs" ]]; then
    return 0
  fi
  need_cmd npm
  log "installing ${SERVER_KIND} server dependencies (npm install)"
  (cd "$server_dir" && npm install --no-audit --no-fund)
}

kill_process_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    kill_process_tree "$child"
  done <<< "$children"
  kill "$pid" 2>/dev/null || true
}

kill_server_pidfile() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] || return 0
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    log "stopping server process tree rooted at pid $pid"
    kill_process_tree "$pid"
    sleep 1
  fi
  rm -f "$pidfile"
}

server_pidfile_is_alive() {
  [[ -f "$SERVER_PIDFILE" ]] || return 1
  local pid
  pid="$(cat "$SERVER_PIDFILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

stop_server_for_profile() {
  local owned=0
  if server_pidfile_is_alive; then
    owned=1
  fi
  kill_server_pidfile "$SERVER_PIDFILE"
  if (( owned )); then
    kill_server_on_port
  fi
}

kill_server_on_port() {
  local pids
  pids="$(lsof -tiTCP:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] || return 0
  log "stopping existing listener(s) on port ${SERVER_PORT}: $(echo "$pids" | tr '\n' ' ')"
  kill $pids || true
  sleep 1
}

start_server() {
  if health_ok; then
    if ! server_pidfile_is_alive; then
      die "port ${SERVER_PORT} has a healthy server, but it is not owned by the current profile; stop that server or choose another port"
    fi
    log "${SERVER_KIND} server already healthy at ${SERVER_HEALTH_URL}"
  else
    if lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      die "port ${SERVER_PORT} is already in use, but /api/health is not healthy"
    fi
    ensure_server_deps
    start_server_in_background
    if ! wait_for_health 90; then
      tail -n 80 "$SERVER_LOG" >&2 || true
      die "server did not become healthy"
    fi
    log "${SERVER_KIND} server is healthy"
  fi

  if (( HAS_IPHONE_TARGET )) && listener_is_localhost_only; then
    die "server is only listening on localhost; restart it so the iPhone can reach your Mac over your chosen remote network"
  fi
}

mac_app_executable() {
  printf '%s\n' "$BUILD_ROOT/Rook/Build/Products/Debug/Rook.app/Contents/MacOS/Rook"
}

mac_app_pids() {
  local executable
  executable="$(mac_app_executable)"
  ps -axo pid=,command= | awk -v executable="$executable" '$2 == executable { print $1 }'
}

stop_mac_app() {
  local pids
  pids="$(mac_app_pids || true)"
  [[ -n "$pids" ]] || return 0
  log "stopping Rook mac app for profile $RUN_ROOK_PROFILE_SLUG: $(echo "$pids" | tr '\n' ' ')"
  kill $pids || true
  sleep 1
}

stop_all_mac_apps() {
  if pgrep -f '/Rook.app/Contents/MacOS/Rook' >/dev/null 2>&1; then
    log "stopping all Rook mac apps"
    pkill -f '/Rook.app/Contents/MacOS/Rook' || true
    sleep 1
  fi
}

stop_android_app() {
  command -v adb >/dev/null 2>&1 || return 0
  local serials
  serials="$(adb devices 2>/dev/null | tail -n +2 | awk '$2=="device"{print $1}')"
  [[ -n "$serials" ]] || return 0
  log "stopping existing Rook android app"
  while IFS= read -r s; do
    [[ -n "$s" ]] || continue
    adb -s "$s" shell am force-stop com.rookery.rook >/dev/null 2>&1 || true
  done <<< "$serials"
}

stop_everything() {
  log "stopping managed Rook resources for profile $RUN_ROOK_PROFILE_SLUG"

  stop_mac_app
  stop_android_app
  stop_server_for_profile

  local tmp udid
  tmp="$(mktemp)"
  if xcrun devicectl list devices -j "$tmp" >/dev/null 2>&1; then
    udid="$(python3 - <<'PY' "$tmp"
import json,sys
with open(sys.argv[1]) as f:data=json.load(f)
for d in data.get('result',{}).get('devices',[]):
    hw=d.get('hardwareProperties',{})
    conn=d.get('connectionProperties',{})
    if hw.get('platform')=='iOS' and hw.get('reality')=='physical' and conn.get('pairingState')=='paired':
        print(hw.get('udid',''))
        break
PY
)"
    if [[ -n "$udid" ]]; then
      xcrun devicectl device process terminate --device "$udid" "$DEFAULT_IOS_APP_BUNDLE_ID" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$tmp"

  if command -v adb >/dev/null 2>&1; then
    local serials
    serials="$(adb devices 2>/dev/null | tail -n +2 | awk '$2=="device"{print $1}')"
    while IFS= read -r s; do
      [[ -n "$s" ]] || continue
      adb -s "$s" shell am force-stop com.rookery.rook >/dev/null 2>&1 || true
    done <<< "$serials"
  fi

  log "stopped server, Mac app, iPhone app, and Android app for profile $RUN_ROOK_PROFILE_SLUG where applicable"
}

stop_everything_all() {
  log "stopping all managed Rook resources"

  local worktree_root
  while IFS= read -r worktree_root; do
    [[ -n "$worktree_root" ]] || continue
    kill_server_pidfile "$worktree_root/.var/run-rook/server.pid"
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null | awk '/^worktree / { print substr($0, 10) }')

  stop_all_mac_apps
  pkill -f Rook 2>/dev/null || true
  stop_android_app
  log "stopped all managed worktree servers and client processes found by the launcher"
}

stop_requested_targets() {
  (( HAS_MAC_TARGET )) && stop_mac_app
  (( HAS_ANDROID_TARGET )) && stop_android_app
  if (( HAS_SERVER_TARGET || HAS_SERVER_NEXT_TARGET )); then
    stop_server_for_profile
  fi
}

ensure_xcode_project() {
  local app_dir="$1"
  local project_path="$2"
  if ! command -v xcodegen >/dev/null 2>&1; then
    [[ -d "$project_path" ]] || die "missing $project_path and xcodegen is not installed (brew install xcodegen)"
    return
  fi
  log "generating $(basename "$project_path") from project.yml"
  (
    cd "$app_dir"
    xcodegen generate >/dev/null
  )
}

current_remote_target() {
  if [[ -n "${ROOK_REMOTE_HOSTNAME:-}" ]]; then
    printf '%s\n' "$ROOK_REMOTE_HOSTNAME"
    return 0
  fi
  if [[ -n "${ROOK_BIND_IP:-}" ]]; then
    printf '%s\n' "$ROOK_BIND_IP"
    return 0
  fi
  if [[ -n "${ROOK_SERVER_HOST:-}" ]] && [[ "$ROOK_SERVER_HOST" != "127.0.0.1" ]] && [[ "$ROOK_SERVER_HOST" != "localhost" ]]; then
    printf '%s\n' "$ROOK_SERVER_HOST"
    return 0
  fi
  return 1
}

resolve_phone() {
  local tmp
  tmp="$(mktemp)"
  xcrun devicectl list devices -j "$tmp" >/dev/null
  python3 - <<'PY' "$tmp" "$DEVICE_FILTER"
import json,sys
path,want=sys.argv[1],sys.argv[2].strip().lower()
with open(path) as f:
    data=json.load(f)
rows=[]
for d in data.get('result', {}).get('devices', []):
    hw=d.get('hardwareProperties', {})
    conn=d.get('connectionProperties', {})
    props=d.get('deviceProperties', {})
    if hw.get('platform') != 'iOS' or hw.get('reality') != 'physical':
        continue
    if conn.get('pairingState') != 'paired':
        continue
    name=props.get('name') or hw.get('productType') or 'Unknown iPhone'
    udid=hw.get('udid') or d.get('identifier')
    rows.append((name,udid))
if want:
    matches=[r for r in rows if want in f"{r[0]} {r[1]}".lower()]
    if len(matches)==1:
        print(f"{matches[0][0]}\t{matches[0][1]}")
        raise SystemExit(0)
    if len(matches)>1:
        print('MULTIPLE', file=sys.stderr)
        for name,udid in matches:
            print(f"- {name} ({udid})", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(1)
if len(rows)==1:
    print(f"{rows[0][0]}\t{rows[0][1]}")
    raise SystemExit(0)
if len(rows)>1:
    print('MULTIPLE', file=sys.stderr)
    for name,udid in rows:
        print(f"- {name} ({udid})", file=sys.stderr)
    raise SystemExit(2)
raise SystemExit(1)
PY
  local status=$?
  rm -f "$tmp"
  return "$status"
}

resolve_ios_simulator() {
  local tmp
  tmp="$(mktemp)"
  xcrun simctl list devices available >"$tmp"
  python3 - <<'PY' "$tmp" "$DEVICE_FILTER"
import re,sys
path,want=sys.argv[1],sys.argv[2].strip().lower()
rows=[]
with open(path) as f:
    for raw in f:
        line=raw.strip()
        m=re.match(r'^(.*?) \(([0-9A-F-]+)\) \((Shutdown|Booted)\)$', line)
        if not m:
            continue
        name,udid,state=m.groups()
        if not name.startswith('iPhone'):
            continue
        rows.append((name,udid,state))
if want:
    matches=[r for r in rows if want in f"{r[0]} {r[1]}".lower()]
    if len(matches)==1:
        print(f"{matches[0][0]}\t{matches[0][1]}\t{matches[0][2]}")
        raise SystemExit(0)
    if len(matches)>1:
        print('MULTIPLE', file=sys.stderr)
        for name,udid,state in matches:
            print(f"- {name} ({udid}) [{state}]", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(1)
if rows:
    booted=[r for r in rows if r[2]=='Booted']
    chosen=(booted or rows)[0]
    print(f"{chosen[0]}\t{chosen[1]}\t{chosen[2]}")
    raise SystemExit(0)
raise SystemExit(1)
PY
  local status=$?
  rm -f "$tmp"
  return "$status"
}

ensure_app_dir() {
  local app_dir="$1"
  [[ -d "$app_dir" ]] || die "missing app directory: $app_dir"
}

activate_mac_app() {
  local app_path="$1"
  local app_name
  app_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$app_path/Contents/Info.plist" 2>/dev/null || true)"
  [[ -n "$app_name" ]] || app_name="Rook"
  osascript -e "tell application \"$app_name\" to activate" >/dev/null 2>&1 || true
}

build_mac_app_bundle() {
  need_cmd xcodebuild
  local app_dir="$1"
  local derived_name="$2"
  ensure_app_dir "$app_dir"
  local proj="$app_dir/Rook.xcodeproj"
  local derived="$BUILD_ROOT/$derived_name"
  ensure_xcode_project "$app_dir" "$proj"
  stop_mac_app
  log "building Rook"
  xcodebuild \
    -project "$proj" \
    -scheme Rook \
    -configuration Debug \
    -derivedDataPath "$derived" \
    "PRODUCT_BUNDLE_IDENTIFIER=$RUN_ROOK_APP_BUNDLE_ID" \
    "ROOK_APP_DISPLAY_NAME=$RUN_ROOK_APP_DISPLAY_NAME" \
    build >/dev/null
  RUN_ROOK_LAST_MAC_APP_PATH="$derived/Build/Products/Debug/Rook.app"
  [[ -d "$RUN_ROOK_LAST_MAC_APP_PATH" ]] || die "missing built app: $RUN_ROOK_LAST_MAC_APP_PATH"
}

build_mac_app() {
  build_mac_app_bundle "$1" "$2"
  local app_path="$RUN_ROOK_LAST_MAC_APP_PATH"
  local url="http://127.0.0.1:${SERVER_PORT}"
  log "launching Rook with ROOK_SERVER_BASE_URL=$url"
  open_mac_app_bundle "$app_path"
}

open_mac_app_bundle() {
  need_cmd open
  local app_path="$1"
  log "opening $(basename "$app_path") through LaunchServices"
  if [[ -n "$SERVER_AUTH_TOKEN" ]]; then
    launchctl setenv ROOK_AUTH_TOKEN "$SERVER_AUTH_TOKEN"
  fi
  launchctl setenv ROOK_SERVER_BASE_URL "http://127.0.0.1:${SERVER_PORT}"
  launchctl setenv ROOK_RUN_MODE "$RUN_ROOK_PROFILE"
  launchctl setenv ROOK_HOME "$ROOK_HOME"
  launchctl setenv ROOK_DATABASE_PATH "$SERVER_DATABASE_PATH"
  launchctl setenv PORT "$SERVER_PORT"
  open -n "$app_path"
  sleep 1
  launchctl unsetenv ROOK_SERVER_BASE_URL
  launchctl unsetenv ROOK_RUN_MODE
  launchctl unsetenv ROOK_HOME
  launchctl unsetenv ROOK_DATABASE_PATH
  launchctl unsetenv PORT
  if [[ -n "$SERVER_AUTH_TOKEN" ]]; then
    launchctl unsetenv ROOK_AUTH_TOKEN
  fi
  activate_mac_app "$app_path"
}

ios_launch_env_json() {
  local launch_env
  if [[ -n "$SERVER_AUTH_TOKEN" ]]; then
    launch_env="{\"ROOK_AUTH_TOKEN\":$(json_escape "$SERVER_AUTH_TOKEN")"
  else
    launch_env="{"
  fi
  if [[ -n "$SIMULATE_ARRIVAL" ]]; then
    log "simulating arrival at $SIMULATE_ARRIVAL (DEBUG ROOK_SIMULATE_ARRIVAL)"
    if [[ "$launch_env" != "{" ]]; then
      launch_env+=","
    fi
    launch_env+="\"ROOK_SIMULATE_ARRIVAL\":$(json_escape "$SIMULATE_ARRIVAL")"
  fi
  printf '%s' "$launch_env"
}

build_iphone_app() {
  need_cmd xcodebuild
  need_cmd xcrun
  local app_dir="$1"
  local derived_name="$2"
  ensure_app_dir "$app_dir"

  local phone
  if ! phone="$(resolve_phone)"; then
    die "no paired physical iPhone found; plug one in, unlock it, trust this Mac, and enable developer mode if prompted"
  fi
  local phone_name phone_udid
  IFS=$'\t' read -r phone_name phone_udid <<<"$phone"
  log "using device: $phone_name ($phone_udid)"

  local url
  if [[ -n "$SERVER_URL" ]]; then
    url="$SERVER_URL"
  else
    local remote_target
    remote_target="$(current_remote_target)"
    if [[ -z "$remote_target" ]]; then
      cat >&2 <<EOF
[run-rook] error: could not determine a reachable server address for the iPhone
[run-rook] set one of:
[run-rook]   ROOK_REMOTE_HOSTNAME=your-hostname
[run-rook]   ROOK_BIND_IP=your.remote.ip
[run-rook] example with Tailscale:
[run-rook]   ROOK_REMOTE_HOSTNAME=your-mac.tailxxxx.ts.net
[run-rook] or pass --server-url URL directly
EOF
      exit 1
    fi
    url="http://${remote_target}:${SERVER_PORT}"
  fi

  local proj="$app_dir/Rook.xcodeproj"
  local derived="$BUILD_ROOT/$derived_name"
  log "using iPhone bundle ids: $DEFAULT_IOS_APP_BUNDLE_ID (+ widget/test variants)"
  ensure_xcode_project "$app_dir" "$proj"
  log "building Rook for $phone_name"
  local build_log="$RUN_ROOT/${derived_name}-build.log"
  if ! xcodebuild \
    -project "$proj" \
    -scheme Rook \
    -configuration Debug \
    -destination "id=$phone_udid" \
    -derivedDataPath "$derived" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    CODE_SIGN_STYLE=Automatic \
    build >"$build_log" 2>&1; then
    tail -n 80 "$build_log" >&2 || true
    die "iPhone build failed (full log: $build_log)"
  fi

  local app_path="$derived/Build/Products/Debug-iphoneos/Rook.app"
  [[ -d "$app_path" ]] || die "missing built app: $app_path"

  if (( RESET_PERMISSIONS )); then
    log "uninstalling Rook on $phone_name to reset its privacy permissions"
    xcrun devicectl device uninstall app --device "$phone_udid" "$DEFAULT_IOS_APP_BUNDLE_ID" >/dev/null 2>&1 || true
  fi
  log "installing Rook on $phone_name"
  xcrun devicectl device install app --device "$phone_udid" "$app_path" >/dev/null
  log "launching Rook on $phone_name with ROOK_SERVER_BASE_URL=$url"
  local phone_launch_env
  phone_launch_env="$(ios_launch_env_json)"
  if [[ "$phone_launch_env" != "{" ]]; then
    phone_launch_env+=","
  fi
  phone_launch_env+="\"ROOK_SERVER_BASE_URL\":$(json_escape "$url")}"
  local launch_log="$RUN_ROOT/${derived_name}-launch.log"
  if ! xcrun devicectl device process launch \
    --device "$phone_udid" \
    --terminate-existing \
    -e "$phone_launch_env" \
    "$DEFAULT_IOS_APP_BUNDLE_ID" >"$launch_log" 2>&1; then
    if grep -qiE 'explicitly trusted by the user|invalid code signature|inadequate entitlements' "$launch_log"; then
      cat "$launch_log" >&2 || true
      die "iPhone launch failed because the developer app certificate is not yet trusted on $phone_name; trust it in Settings -> General -> VPN & Device Management, then run ./scripts/run-rook.sh iphone again"
    fi
    if grep -qiE 'Locked|could not be unlocked' "$launch_log"; then
      cat "$launch_log" >&2 || true
      die "iPhone launch failed because $phone_name is locked; unlock the phone and run ./scripts/run-rook.sh iphone again"
    fi
    tail -n 80 "$launch_log" >&2 || true
    die "iPhone launch failed (full log: $launch_log)"
  fi

  cat <<EOF
[run-rook] launched on $phone_name
[run-rook] server URL: $url
[run-rook] if iOS says the developer certificate is untrusted:
[run-rook]   Settings -> General -> VPN & Device Management -> trust your developer app certificate
EOF
}

build_ios_simulator_app() {
  need_cmd xcodebuild
  need_cmd xcrun
  local app_dir="$1"
  local derived_name="$2"
  ensure_app_dir "$app_dir"

  local sim
  if ! sim="$(resolve_ios_simulator)"; then
    die "no usable iPhone simulator found; open Xcode and install an iPhone simulator runtime"
  fi
  local sim_name sim_udid sim_state
  IFS=$'\t' read -r sim_name sim_udid sim_state <<<"$sim"
  log "using simulator: $sim_name ($sim_udid)"
  if [[ "$sim_state" != "Booted" ]]; then
    log "booting simulator $sim_name"
    xcrun simctl boot "$sim_udid" >/dev/null 2>&1 || true
  fi
  open -a Simulator >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$sim_udid" -b >/dev/null

  local proj="$app_dir/Rook.xcodeproj"
  local derived="$BUILD_ROOT/$derived_name"
  ensure_xcode_project "$app_dir" "$proj"
  log "building Rook for simulator $sim_name"
  local sim_build_log="$RUN_ROOT/${derived_name}-simulator-build.log"
  if ! xcodebuild \
    -project "$proj" \
    -scheme Rook \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination "id=$sim_udid" \
    -derivedDataPath "$derived" \
    build >"$sim_build_log" 2>&1; then
    tail -n 80 "$sim_build_log" >&2 || true
    die "iPhone simulator build failed (full log: $sim_build_log)"
  fi

  local sim_app_path="$derived/Build/Products/Debug-iphonesimulator/Rook.app"
  [[ -d "$sim_app_path" ]] || die "missing built app: $sim_app_path"
  if (( RESET_PERMISSIONS )); then
    log "uninstalling Rook on simulator $sim_name to reset its privacy permissions"
    xcrun simctl uninstall "$sim_udid" "$DEFAULT_IOS_APP_BUNDLE_ID" >/dev/null 2>&1 || true
  fi
  log "installing Rook on simulator $sim_name"
  xcrun simctl install "$sim_udid" "$sim_app_path" >/dev/null
  local sim_url="${SERVER_URL:-http://127.0.0.1:${SERVER_PORT}}"
  log "launching Rook on simulator $sim_name with ROOK_SERVER_BASE_URL=$sim_url"
  SIMCTL_CHILD_ROOK_SERVER_BASE_URL="$sim_url" \
  SIMCTL_CHILD_ROOK_AUTH_TOKEN="${SERVER_AUTH_TOKEN:-}" \
  SIMCTL_CHILD_ROOK_SIMULATE_ARRIVAL="${SIMULATE_ARRIVAL:-}" \
  xcrun simctl launch --terminate-running-process "$sim_udid" "$DEFAULT_IOS_APP_BUNDLE_ID" >/dev/null

  cat <<EOF
[run-rook] launched on simulator $sim_name
[run-rook] server URL: $sim_url
EOF
}

run_rook_target_server() {
  log "server ready: ${SERVER_HEALTH_URL%/api/health}"
}
