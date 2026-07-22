# Rook As-Built Architecture

This directory replaces the old single-file architecture summary with per-surface notes for the major parts of the repo as they are currently built.

## Documents

- [server.md](./server.md) — Fastify server, ACP facade, runtime orchestration, environment system, persistence, and location identification.
- [database.md](./database.md) — SQLite tables, persistence ownership, and the current state of server-side layering.
- [mac-client.md](./mac-client.md) — native macOS app, foreground-app environment provider, Mac bridge, and server supervision.
- [iphone-client.md](./iphone-client.md) — native iPhone app, geofenced place provider, voice, and Live Activity integration.
- [rookkit.md](./rookkit.md) — shared Swift package used by the Apple clients for networking, models, chat rendering, and voice/live-activity types.
- [android-client.md](./android-client.md) — native Android app, Compose UI, ACP client, and movement/location services.

## Common system shape

Rook is built around two protocol boundaries:

1. client ↔ server: ACP over one connection-level WebSocket at `/api/ws`
2. server ↔ runtime: ACP over stdio subprocesses, one process per public session

The server is the stable broker. Clients are thin native surfaces over the same REST + ACP contract.
