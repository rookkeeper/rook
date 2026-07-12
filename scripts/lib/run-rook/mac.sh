#!/usr/bin/env bash

run_rook_target_mac() {
  build_mac_app "$REPO_ROOT/clients/mac" "Rook"
}

run_rook_target_mac_next() {
  build_mac_app_bundle "$REPO_ROOT/clients-next/mac" "Rook-next-mac"
  open_mac_app_bundle "$RUN_ROOK_LAST_MAC_APP_PATH"
}
