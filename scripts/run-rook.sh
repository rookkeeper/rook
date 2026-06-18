#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ROOT="$REPO_ROOT/.var/run-rook"
BUILD_ROOT="$RUN_ROOT/build"
SERVER_LOG="$RUN_ROOT/server.log"
SERVER_PIDFILE="$RUN_ROOT/server.pid"
SERVER_PORT="${ROOK_SERVER_PORT:-3000}"
SERVER_HEALTH_URL="http://127.0.0.1:${SERVER_PORT}/api/health"

mkdir -p "$RUN_ROOT" "$BUILD_ROOT"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run-rook.sh server
  ./scripts/run-rook.sh mac
  ./scripts/run-rook.sh sim [--simulator NAME_OR_UDID] [--server-url URL]
  ./scripts/run-rook.sh phone [--device NAME_OR_UDID] [--team TEAM_ID] [--server-url URL]
  ./scripts/run-rook.sh stop

What it does:
  - starts the Rook server if needed
  - regenerates Xcode projects from project.yml
  - rebuilds the selected app incrementally
  - launches the selected target

Notes:
  - mac uses localhost by default
  - sim uses http://127.0.0.1:3000 by default
  - phone uses your Mac's LAN IP by default
  - phone builds are intentionally NOT committed with a fixed team id;
    pass --team / ROOK_IOS_DEVELOPMENT_TEAM or let the script auto-detect
    your local Apple Development team from Keychain when possible.
  - stop shuts down the server, mac app, simulator app, booted simulators,
    and the phone app when reachable.
EOF
}

stop_everything() {
  log "stopping managed Rook resources"

  if [[ -f "$SERVER_PIDFILE" ]]; then
    local pid
    pid="$(cat "$SERVER_PIDFILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" || true
    fi
    rm -f "$SERVER_PIDFILE"
  fi

  local pids
  pids="$(lsof -tiTCP:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids || true
  fi

  pkill -f AgentStationMenuBar 2>/dev/null || true

  local booted
  booted="$(xcrun simctl list devices booted -j 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin).get("devices",{}); ids=[]
for _,arr in d.items():
  ids += [x["udid"] for x in arr if x.get("state")=="Booted"]
print("\\n".join(ids))' 2>/dev/null || true)"
  if [[ -n "$booted" ]]; then
    while IFS= read -r udid; do
      [[ -n "$udid" ]] || continue
      xcrun simctl terminate "$udid" com.rookery.Rook 2>/dev/null || true
      xcrun simctl shutdown "$udid" 2>/dev/null || true
    done <<< "$booted"
  fi

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
      xcrun devicectl device process terminate --device "$udid" com.rookery.Rook >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$tmp"

  log "stopped server, mac app, simulator app(s), booted simulators, and phone app if present"
}

log() { echo "[run-rook] $*"; }
warn() { echo "[run-rook] warning: $*" >&2; }
die() { echo "[run-rook] error: $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

TARGET="${1:-}"
[[ -n "$TARGET" ]] || { usage; exit 2; }
shift || true

SIMULATOR_FILTER=""
DEVICE_FILTER=""
TEAM_ID="${ROOK_IOS_DEVELOPMENT_TEAM:-}"
SERVER_URL=""
RESTART_SERVER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --simulator)
      SIMULATOR_FILTER="${2:-}"
      shift 2
      ;;
    --device)
      DEVICE_FILTER="${2:-}"
      shift 2
      ;;
    --team)
      TEAM_ID="${2:-}"
      shift 2
      ;;
    --server-url)
      SERVER_URL="${2:-}"
      shift 2
      ;;
    --restart-server)
      RESTART_SERVER=1
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

case "$TARGET" in
  server|mac|sim|phone|stop) ;;
  *) usage; exit 2 ;;
esac

need_cmd curl
need_cmd python3
need_cmd lsof

json_escape() {
  python3 - <<'PY' "$1"
import json,sys
print(json.dumps(sys.argv[1]))
PY
}

health_ok() {
  curl --silent --show-error --fail "$SERVER_HEALTH_URL" >/dev/null 2>&1
}

listener_is_localhost_only() {
  local out
  out="$(lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$out" ]] || return 1
  if grep -Eq 'localhost:|127\.0\.0\.1:' <<<"$out" && ! grep -Eq '\*:|0\.0\.0\.0:|\[::\]:' <<<"$out"; then
    return 0
  fi
  return 1
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

ensure_server_deps() {
  local server_dir="$REPO_ROOT/server"
  if [[ -d "$server_dir/node_modules" ]] && [[ -f "$server_dir/node_modules/tsx/dist/cli.mjs" ]]; then
    return 0
  fi
  need_cmd npm
  log "installing server dependencies (npm install)"
  (cd "$server_dir" && npm install --no-audit --no-fund)
}

start_server() {
  if (( RESTART_SERVER )); then
    kill_server_if_owned
  fi

  if health_ok; then
    log "server already healthy at http://127.0.0.1:${SERVER_PORT}"
  else
    if lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      die "port ${SERVER_PORT} is already in use, but /api/health is not healthy"
    fi
    ensure_server_deps
    need_cmd npm
    log "starting server (log: $SERVER_LOG)"
    (
      cd "$REPO_ROOT"
      nohup npm run dev >"$SERVER_LOG" 2>&1 &
      echo $! >"$SERVER_PIDFILE"
    )
    if ! wait_for_health 90; then
      tail -n 80 "$SERVER_LOG" >&2 || true
      die "server did not become healthy"
    fi
    log "server is healthy"
  fi

  if [[ "$TARGET" == "phone" ]] && listener_is_localhost_only; then
    die "server is only listening on localhost; restart it so the phone can reach your Mac over LAN"
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

current_lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
}

resolve_simulator() {
  xcrun simctl list devices available -j | python3 -c '
import json,sys
want=sys.argv[1].strip().lower()
data=json.load(sys.stdin)
cands=[]
for runtime, devices in data.get("devices", {}).items():
    if "iOS" not in runtime:
        continue
    for d in devices:
        if not d.get("isAvailable", False):
            continue
        name=d["name"]
        udid=d["udid"]
        state=d.get("state","Shutdown")
        rec=(name,udid,state)
        if want:
            hay=f"{name} {udid}".lower()
            if want in hay:
                print(f"{name}\t{udid}\t{state}")
                raise SystemExit(0)
        cands.append(rec)
for name,udid,state in cands:
    if state == "Booted" and "iPhone" in name:
        print(f"{name}\t{udid}\t{state}")
        raise SystemExit(0)
for preferred in ("iPhone 17 Pro", "iPhone 16 Pro", "iPhone 15 Pro"):
    for name,udid,state in cands:
        if name == preferred:
            print(f"{name}\t{udid}\t{state}")
            raise SystemExit(0)
for name,udid,state in cands:
    if "iPhone" in name:
        print(f"{name}\t{udid}\t{state}")
        raise SystemExit(0)
raise SystemExit(1)
' "$SIMULATOR_FILTER"
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

build_mac() {
  need_cmd xcodebuild
  local app_dir="$REPO_ROOT/clients/mac"
  local proj="$app_dir/AgentStationMenuBar.xcodeproj"
  local derived="$BUILD_ROOT/AgentStationMenuBar"
  ensure_xcode_project "$app_dir" "$proj"
  if pgrep -f AgentStationMenuBar >/dev/null 2>&1; then
    log "stopping existing AgentStationMenuBar"
    pkill -f AgentStationMenuBar || true
    sleep 1
  fi
  log "building AgentStationMenuBar"
  xcodebuild -project "$proj" -scheme AgentStationMenuBar -configuration Debug -derivedDataPath "$derived" build >/dev/null
  local app_path="$derived/Build/Products/Debug/AgentStationMenuBar.app"
  [[ -d "$app_path" ]] || die "missing built app: $app_path"
  log "launching AgentStationMenuBar"
  open "$app_path"
}

build_sim() {
  need_cmd xcodebuild
  need_cmd xcrun
  need_cmd open
  local sim
  if ! sim="$(resolve_simulator)"; then
    die "no available iPhone simulator found"
  fi
  local sim_name sim_udid sim_state
  IFS=$'\t' read -r sim_name sim_udid sim_state <<<"$sim"
  log "using simulator: $sim_name ($sim_udid)"
  open -a Simulator >/dev/null 2>&1 || true
  if [[ "$sim_state" != "Booted" ]]; then
    xcrun simctl boot "$sim_udid" >/dev/null 2>&1 || true
  fi
  xcrun simctl bootstatus "$sim_udid" -b >/dev/null

  local app_dir="$REPO_ROOT/clients/iphone"
  local proj="$app_dir/Rook.xcodeproj"
  local derived="$BUILD_ROOT/Rook-sim"
  ensure_xcode_project "$app_dir" "$proj"
  log "building Rook for simulator"
  xcodebuild -project "$proj" -scheme Rook -configuration Debug -destination "id=$sim_udid" -derivedDataPath "$derived" build >/dev/null
  local app_path="$derived/Build/Products/Debug-iphonesimulator/Rook.app"
  [[ -d "$app_path" ]] || die "missing built app: $app_path"

  local url="${SERVER_URL:-http://127.0.0.1:${SERVER_PORT}}"
  log "installing Rook into simulator"
  xcrun simctl install "$sim_udid" "$app_path" >/dev/null
  log "launching Rook in simulator with ROOK_SERVER_BASE_URL=$url"
  SIMCTL_CHILD_ROOK_SERVER_BASE_URL="$url" \
    xcrun simctl launch --terminate-running-process "$sim_udid" com.rookery.Rook >/dev/null
}

build_phone() {
  need_cmd xcodebuild
  need_cmd xcrun
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

  local lan_ip
  lan_ip="$(current_lan_ip)"
  [[ -n "$lan_ip" ]] || die "could not determine your Mac's LAN IP for the phone"
  local url="${SERVER_URL:-http://${lan_ip}:${SERVER_PORT}}"

  local app_dir="$REPO_ROOT/clients/iphone"
  local proj="$app_dir/Rook.xcodeproj"
  local derived="$BUILD_ROOT/Rook-phone"
  ensure_xcode_project "$app_dir" "$proj"
  log "building Rook for $phone_name"
  local build_log="$RUN_ROOT/rook-phone-build.log"
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

  log "installing Rook on $phone_name"
  xcrun devicectl device install app --device "$phone_udid" "$app_path" >/dev/null
  log "launching Rook on $phone_name with ROOK_SERVER_BASE_URL=$url"
  xcrun devicectl device process launch \
    --device "$phone_udid" \
    --terminate-existing \
    -e "{\"ROOK_SERVER_BASE_URL\":$(json_escape "$url")}" \
    com.rookery.Rook >/dev/null

  cat <<EOF
[run-rook] launched on $phone_name
[run-rook] server URL: $url
[run-rook] if iOS says the developer certificate is untrusted:
[run-rook]   Settings -> General -> VPN & Device Management -> trust your developer app certificate
EOF
}

if [[ "$TARGET" == "stop" ]]; then
  stop_everything
  exit 0
fi

start_server

case "$TARGET" in
  server)
    log "server only: http://127.0.0.1:${SERVER_PORT}"
    ;;
  mac)
    build_mac
    ;;
  sim)
    build_sim
    ;;
  phone)
    build_phone
    ;;
esac
