# Rook client

Prototype shared UI package for the future cross-platform Rook client.

## Current state
- built with React Native-style components on top of `react-native-web`
- served by the existing Fastify backend at `http://127.0.0.1:3000`
- intended to become the shared UI base for web, then later iPhone
- now depends on root `shared/` contracts for ACP/environment/agent DTOs during the migration

## Install
```bash
cd client && npm install
```

You still also need the backend package installed:

```bash
cd server && npm install
```

## Run
From the repo root:

```bash
npm run dev
```

That starts the existing backend and serves this package as the web UI at `http://127.0.0.1:3000`.

## Scope of this first pass
This package is the first migration step only.

For now we are **not** changing:
- the menu bar app
- the environment manager
- the Mac OS bridge/runtime
- cross-device environment/host architecture
