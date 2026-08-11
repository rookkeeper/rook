# Rook

Rook is a local-first personal-agent runtime built around ACP (Agent Client Protocol). The repo contains the server, native clients, and supporting docs. Session discovery is REST-backed, and live session interaction uses one ACP WebSocket per active session.

## Start here

- [Docs index](docs/README.md)
- [Setup](docs/setup.md)
- [Configuration](docs/configuration.md)
- [Product notes](PRODUCT/)
- [As-built architecture notes](AS-BUILT-ARCHITECTURE/)
- [Environment repository migration design log](CHANGES/2026-08-01-environment_repo_to_db/)
- [Environment repository migration recap and verification guide](CHANGES/2026-08-01-environment_repo_to_db/recap.md)

## Packages

- [server/](server/) — Fastify API organized by domain (`infrastructure`, `sessions`, `runtime`, `environments`, `location`), with three-table environment repositories, shared per-environment writable sources, and per-domain layering only where needed
- [clients/cli](clients/cli/) — minimal ACP-first command-line client
- [clients/mac](clients/mac/) — native macOS menu bar client with bundle-scoped environment inspection and browser-specific Accessibility handling
- [clients/iphone](clients/iphone/) — native iPhone client
- [clients/android](clients/android/) — native Android client
- [clients/RookKit](clients/RookKit/) — shared Swift package for the native clients
- [.agents/skills/](.agents/skills/) — repo-local agent skills for coding-agent work; Rook runtime workspaces materialize their own standard `.agents/skills/` projection
- [dev-tools/](dev-tools/) — repo-local Pi development/debug extensions (currently includes provider-payload trace logging to `/tmp/pi/provider-payload.jsonl`)

## Common entry points

- `./scripts/run-rook.sh server`
- `./scripts/run-rook.sh mac`
- `./scripts/run-rook.sh iphone`
- `./scripts/run-rook.sh android`
- `./scripts/run-rook.sh stop`

The launcher uses the main checkout as the production-like local profile. Running the same command from a Git worktree starts an isolated development profile with its own port, `ROOK_HOME/rook.sqlite` application database, `~/.rook-<worktree-slug>` state directory, logs, and Mac app identity. The slug includes a short hash of the canonical worktree path so same-named worktrees remain distinct. Development profiles are initially seeded by copying `~/.rook` into their profile home when it does not exist, but the copied application database is removed so the development profile starts without the production session history. After that, configuration and session/server state remain isolated. The main checkout likewise defaults its application database to `~/.rook/rook.sqlite`. Use `ROOK_RUN_MODE` or `ROOK_PRODUCTION_ROOT` for explicit profile selection, and `RUN_ROOK_HOME` / `RUN_ROOK_DATABASE_PATH` for launcher-specific overrides.
- `npm run test:launcher` — run hermetic worktree-profile and launcher-lifecycle tests
- `./scripts/print-environments.sh` — dump active/recent environment diagnostics from the server
- `./scripts/tail-logs.sh` — inspect provider-payload traces in `/tmp/pi/provider-payload.jsonl` (use `--instructions` and/or `--tools` for structured output)
- `./scripts/run-tests.sh` — run the known server, Swift package, iPhone, and macOS test/build checks

## CI checks

Pull requests include a guard against adding compatibility markers to executable or configuration files. Configure the workflow's status check as required in GitHub branch protection to block merges when it fails.

## High-level docs map

- setup, `.env`, binding, and remote-access notes: [docs/setup.md](docs/setup.md)
- agent-profile config: [docs/configuration.md](docs/configuration.md)
- as-built architecture index: [AS-BUILT-ARCHITECTURE/](AS-BUILT-ARCHITECTURE/)
- server package details: [server/README.md](server/README.md)
- shared environment workspace design/review: [CHANGES/2026-08-01-environment_repo_to_db/part_b/](CHANGES/2026-08-01-environment_repo_to_db/part_b/)
- iPhone client details: [clients/iphone/README.md](clients/iphone/README.md)
- macOS client details: [clients/mac/README.md](clients/mac/README.md)
- Android client details: [clients/android/README.md](clients/android/README.md)
