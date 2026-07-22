# Rook

Rook is a local-first personal-agent runtime built around ACP (Agent Client Protocol). The repo contains the server, native clients, and supporting docs.

## Start here

- [Docs index](docs/README.md)
- [Setup](docs/setup.md)
- [Configuration](docs/configuration.md)
- [Product notes](PRODUCT/)
- [As-built architecture notes](AS-BUILT-ARCHITECTURE/)

## Packages

- [server/](server/) — Fastify API, session/runtime orchestration, environment manager, ACP-backed agent adapters
- [clients/cli](clients/cli/) — minimal ACP-first command-line client
- [clients/mac](clients/mac/) — native macOS menu bar client
- [clients/iphone](clients/iphone/) — native iPhone client
- [clients/android](clients/android/) — native Android client
- [clients/cli](clients/cli/) — minimal ACP-first command-line client
- [clients/RookKit](clients/RookKit/) — shared Swift package for the native clients
- [skills/](skills/) — repo-local Pi skills that Rook injects into Pi sessions (currently includes `create-skills`)
- [dev-tools/](dev-tools/) — repo-local Pi development/debug extensions (currently includes provider-payload trace logging to `.var/pi-traces.jsonl`)

## Common entry points

- `./scripts/run-rook.sh server`
- `./scripts/run-rook.sh mac`
- `./scripts/run-rook.sh iphone`
- `./scripts/run-rook.sh android`
- `./scripts/run-rook.sh stop`
- `./scripts/print-environments.sh` — dump active/recent environment diagnostics from the server
- `./scripts/tail-pi-traces.sh` — inspect provider-payload traces in `.var/pi-traces.jsonl` (follows by default; use `--once` for one-shot output)
- `./scripts/run-tests.sh` — run the known server, Swift package, iPhone, and macOS test/build checks

## High-level docs map

- setup, `.env`, binding, and remote-access notes: [docs/setup.md](docs/setup.md)
- agent-profile config: [docs/configuration.md](docs/configuration.md)
- as-built architecture index: [AS-BUILT-ARCHITECTURE/](AS-BUILT-ARCHITECTURE/)
- server package details: [server/README.md](server/README.md)
- iPhone client details: [clients/iphone/README.md](clients/iphone/README.md)
- macOS client details: [clients/mac/README.md](clients/mac/README.md)
- Android client details: [clients/android/README.md](clients/android/README.md)
