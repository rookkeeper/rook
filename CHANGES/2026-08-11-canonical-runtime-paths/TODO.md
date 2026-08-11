# Canonical runtime paths

## Context

Rook currently exposes a few equivalent representations for profile state, project-owned capabilities, durable decisions, session lifecycle, and session summaries. The implementation should have one direct path for each concern.

## Decision details

Use the current profile-scoped SQLite database, standard Agent Skills project layout, bundle-specific durable decisions, server-owned session deletion, and the REST session summary shape as the sole contracts. Remove unused aliases and branches, then align tests and documentation with those contracts.

## Work checklist

- [x] Make launcher profile state direct and update hermetic shell tests.
- [x] Narrow project environment discovery to the standard files and directories.
- [x] Remove workspace projection aliases and simplify workspace tests.
- [x] Require bundle identity for durable environment decisions.
- [x] Use one session deletion operation throughout the server.
- [x] Make client session summaries consume the server response directly.
- [x] Align architecture, product, README, workflow, skill, and change documentation.
- [x] Run focused tests, typecheck, builds, and final repository searches.
