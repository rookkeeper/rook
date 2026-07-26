#!/usr/bin/env bash

run_rook_target_iphone() {
  build_iphone_app "$REPO_ROOT/clients/iphone" "Rook-iphone"
}

run_rook_target_sim() {
  build_ios_simulator_app "$REPO_ROOT/clients/iphone" "Rook-iphone"
}
