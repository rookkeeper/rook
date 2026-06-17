#!/usr/bin/env bash
# Drive the Rook iOS app in a booted simulator.
#
# iOS apps can't background themselves (no public API), so to exercise Rook's
# scenePhase lifecycle (place-env re-announce, socket reconnect, Live Activity)
# you "minimize" it by foregrounding another app. This wraps that:
#
#   ./scripts/sim-rook.sh bg     # minimize Rook (foregrounds Safari)
#   ./scripts/sim-rook.sh fg     # bring Rook back to the foreground
#   ./scripts/sim-rook.sh shot   # screenshot the simulator to /tmp/rook.png
#
# Equivalent manual gesture: Simulator menu → Device → Home (⇧⌘H).
#
# Env: ROOK_SIM (simulator udid/name, default "booted"), ROOK_BUNDLE.
set -euo pipefail

BUNDLE="${ROOK_BUNDLE:-com.rookery.Rook}"
SIM="${ROOK_SIM:-booted}"

case "${1:-}" in
  bg|background|minimize)
    # Foreground Safari → sends Rook to the background (scenePhase .background).
    xcrun simctl openurl "$SIM" "https://example.com" >/dev/null
    echo "Rook minimized (Safari foregrounded). Use 'fg' to bring it back."
    ;;
  fg|foreground|open)
    # Re-foreground Rook (scenePhase .active). The rook:// deep link also opens
    # straight into the chat if a session is live.
    xcrun simctl launch "$SIM" "$BUNDLE" >/dev/null
    echo "Rook foregrounded."
    ;;
  shot|screenshot)
    out="${2:-/tmp/rook.png}"
    xcrun simctl io "$SIM" screenshot "$out" >/dev/null
    echo "$out"
    ;;
  *)
    echo "usage: $(basename "$0") {bg|fg|shot [path]}" >&2
    exit 2
    ;;
esac
