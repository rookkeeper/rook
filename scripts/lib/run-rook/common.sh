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
  curl "${curl_args[@]}" "$SERVER_HEALTH_URL" >/dev/null 2>&1
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
  log "starting server in background (log: $SERVER_LOG)"
  (
    cd "$REPO_ROOT"
    nohup npm run dev >"$SERVER_LOG" 2>&1 &
    echo $! >"$SERVER_PIDFILE"
  )
}

ensure_server_deps() {
  local server_dir="$REPO_ROOT/server"
  if [[ -d "$server_dir/node_modules" ]] && [[ -f "$server_dir/node_modules/tsx/dist/cli.mjs" ]]; then
    return 0
  fi
  need_cmd npm
  log "installing server dependencies (npm install)"
  (cd "$server_dir" && npm install --no-audit --no-fund)
}

kill_server_if_owned() {
  if [[ -f "$SERVER_PIDFILE" ]]; then
    local pid
    pid="$(cat "$SERVER_PIDFILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      log "stopping server pid $pid"
      kill "$pid" || true
      sleep 1
    fi
    rm -f "$SERVER_PIDFILE"
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
    log "server already healthy at ${SERVER_HEALTH_URL}"
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
    log "server is healthy"
  fi

  if (( HAS_IPHONE_TARGET )) && listener_is_localhost_only; then
    die "server is only listening on localhost; restart it so the iPhone can reach your Mac over your chosen remote network"
  fi
}

stop_mac_app() {
  if pgrep -f Rook >/dev/null 2>&1; then
    log "stopping existing Rook mac app"
    pkill -f Rook || true
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
  log "stopping managed Rook resources"

  kill_server_if_owned

  local pids
  pids="$(lsof -tiTCP:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids || true
  fi

  pkill -f Rook 2>/dev/null || true

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
      local stop_team stop_bundle_id _stop_widget_id _stop_test_id
      stop_team="${TEAM_ID:-}"
      if [[ -z "$stop_team" ]]; then
        stop_team="$(auto_detect_team 2>/dev/null || true)"
      fi
      if [[ -n "$stop_team" ]]; then
        IFS=$'\t' read -r stop_bundle_id _stop_widget_id _stop_test_id <<<"$(phone_bundle_ids "$stop_team")"
        xcrun devicectl device process terminate --device "$udid" "$stop_bundle_id" >/dev/null 2>&1 || true
      fi
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

  log "stopped server, mac app(s), iphone app(s), and android app if present"
}

stop_requested_targets() {
  (( HAS_MAC_TARGET )) && stop_mac_app
  (( HAS_ANDROID_TARGET )) && stop_android_app
  if (( HAS_SERVER_TARGET )); then
    kill_server_if_owned
    kill_server_on_port
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

patch_iphone_project_bundle_ids() {
  local project_path="$1"
  local app_id="$2"
  local widget_id="$3"
  local test_id="$4"
  python3 - <<'PY' "$project_path/project.pbxproj" "$app_id" "$widget_id" "$test_id"
from pathlib import Path
import sys
pbxproj = Path(sys.argv[1])
app_id, widget_id, test_id = sys.argv[2:5]
text = pbxproj.read_text()
text = text.replace("PRODUCT_BUNDLE_IDENTIFIER = com.rookery.Rook.RookWidgets;", f"PRODUCT_BUNDLE_IDENTIFIER = {widget_id};")
text = text.replace("PRODUCT_BUNDLE_IDENTIFIER = com.rookery.RookTests;", f"PRODUCT_BUNDLE_IDENTIFIER = {test_id};")
text = text.replace("PRODUCT_BUNDLE_IDENTIFIER = com.rookery.Rook;", f"PRODUCT_BUNDLE_IDENTIFIER = {app_id};")
pbxproj.write_text(text)
PY
}

sanitize_bundle_segment() {
  local raw="$1"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
  [[ -n "$raw" ]] || raw="dev"
  printf '%s' "$raw"
}

phone_bundle_ids() {
  local team="$1"
  local team_segment
  team_segment="$(sanitize_bundle_segment "$team")"
  local app_id="com.rookery.${team_segment}.Rook"
  local widget_id="${app_id}.RookWidgets"
  local test_id="com.rookery.${team_segment}.RookTests"
  printf '%s\t%s\t%s\n' "$app_id" "$widget_id" "$test_id"
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

auto_detect_team() {
  local ids=""
  local prov_paths=()
  while IFS= read -r path; do
    prov_paths+=("$path")
  done < <(find "$HOME/Library/Developer/Xcode/DerivedData" "$HOME/Library/MobileDevice/Provisioning Profiles" \
    \( -path '*/Rook.app/embedded.mobileprovision' -o -name '*.mobileprovision' \) 2>/dev/null)

  if [[ ${#prov_paths[@]} -gt 0 ]]; then
    ids="$(python3 - <<'PY' "${prov_paths[@]}"
import plistlib, subprocess, sys
ids=set()
for path in sys.argv[1:]:
    try:
        xml=subprocess.check_output(["security", "cms", "-D", "-i", path], stderr=subprocess.DEVNULL)
        plist=plistlib.loads(xml)
        for team in plist.get("TeamIdentifier", []):
            if team:
                ids.add(team.upper())
    except Exception:
        pass
print("\n".join(sorted(ids)))
PY
)"
  fi

  if [[ -z "${ids//[$'\n\r\t ']/}" ]]; then
    ids="$(security find-certificate -a -c "Apple Development" 2>/dev/null | python3 -c '
import re,sys
text=sys.stdin.read()
ids=sorted({match.upper() for match in re.findall(r"Apple Development: .* \(([^)]+)\)", text)})
print("\\n".join(ids))
')"
  fi

  ids="$(printf '%s\n' "$ids" | sed '/^$/d' || true)"
  local count
  count="$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$count" == "1" ]]; then
    printf '%s' "$ids"
    return 0
  fi
  return 1
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
  xcodebuild -project "$proj" -scheme Rook -configuration Debug -derivedDataPath "$derived" build >/dev/null
  RUN_ROOK_LAST_MAC_APP_PATH="$derived/Build/Products/Debug/Rook.app"
  [[ -d "$RUN_ROOK_LAST_MAC_APP_PATH" ]] || die "missing built app: $RUN_ROOK_LAST_MAC_APP_PATH"
}

build_mac_app() {
  build_mac_app_bundle "$1" "$2"
  local app_path="$RUN_ROOK_LAST_MAC_APP_PATH"
  local url="http://127.0.0.1:${SERVER_PORT}"
  log "launching Rook with ROOK_SERVER_BASE_URL=$url"
  if [[ -n "$SERVER_AUTH_TOKEN" ]]; then
    ROOK_SERVER_BASE_URL="$url" ROOK_AUTH_TOKEN="$SERVER_AUTH_TOKEN" "$app_path/Contents/MacOS/Rook" >/dev/null 2>&1 &
  else
    ROOK_SERVER_BASE_URL="$url" "$app_path/Contents/MacOS/Rook" >/dev/null 2>&1 &
  fi
  sleep 1
  activate_mac_app "$app_path"
}

open_mac_app_bundle() {
  need_cmd open
  local app_path="$1"
  log "opening $(basename "$app_path") through LaunchServices"
  open -n "$app_path"
  sleep 1
  activate_mac_app "$app_path"
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

  if [[ -z "$TEAM_ID" ]]; then
    if TEAM_ID="$(auto_detect_team)"; then
      warn "using local Apple Development team $TEAM_ID from Keychain; teammates should pass --team or ROOK_IOS_DEVELOPMENT_TEAM"
    else
      die "could not auto-detect a single Apple Development team; pass --team TEAM_ID or export ROOK_IOS_DEVELOPMENT_TEAM"
    fi
  fi

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
  local phone_app_bundle_id phone_widget_bundle_id phone_test_bundle_id
  IFS=$'\t' read -r phone_app_bundle_id phone_widget_bundle_id phone_test_bundle_id <<<"$(phone_bundle_ids "$TEAM_ID")"
  log "using iPhone bundle ids: $phone_app_bundle_id (+ widget/test variants)"
  ensure_xcode_project "$app_dir" "$proj"
  patch_iphone_project_bundle_ids "$proj" "$phone_app_bundle_id" "$phone_widget_bundle_id" "$phone_test_bundle_id"
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
    DEVELOPMENT_TEAM="$TEAM_ID" \
    build >"$build_log" 2>&1; then
    tail -n 80 "$build_log" >&2 || true
    die "iPhone build failed (full log: $build_log)"
  fi

  local app_path="$derived/Build/Products/Debug-iphoneos/Rook.app"
  [[ -d "$app_path" ]] || die "missing built app: $app_path"

  if (( RESET_PERMISSIONS )); then
    log "uninstalling Rook on $phone_name to reset its privacy permissions"
    xcrun devicectl device uninstall app --device "$phone_udid" "$phone_app_bundle_id" >/dev/null 2>&1 || true
  fi
  log "installing Rook on $phone_name"
  xcrun devicectl device install app --device "$phone_udid" "$app_path" >/dev/null
  log "launching Rook on $phone_name with ROOK_SERVER_BASE_URL=$url"
  local launch_env
  if [[ -n "$SERVER_AUTH_TOKEN" ]]; then
    launch_env="{\"ROOK_SERVER_BASE_URL\":$(json_escape "$url"),\"ROOK_AUTH_TOKEN\":$(json_escape "$SERVER_AUTH_TOKEN")"
  else
    launch_env="{\"ROOK_SERVER_BASE_URL\":$(json_escape "$url")"
  fi
  if [[ -n "$SIMULATE_ARRIVAL" ]]; then
    log "simulating arrival at $SIMULATE_ARRIVAL (DEBUG ROOK_SIMULATE_ARRIVAL)"
    launch_env+=",\"ROOK_SIMULATE_ARRIVAL\":$(json_escape "$SIMULATE_ARRIVAL")"
  fi
  launch_env+="}"
  local launch_log="$RUN_ROOT/${derived_name}-launch.log"
  if ! xcrun devicectl device process launch \
    --device "$phone_udid" \
    --terminate-existing \
    -e "$launch_env" \
    "$phone_app_bundle_id" >"$launch_log" 2>&1; then
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

run_rook_target_server() {
  log "server ready: ${SERVER_HEALTH_URL%/api/health}"
}
