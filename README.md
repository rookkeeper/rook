# Agent Station

Monorepo for local Pi agents, an event-native chat runtime, and host clients/providers.

## Top-level packages

| Package | Role |
|---------|------|
| [agent-server-client](agent-server-client/) | Main app at `:3000`: React UI, Fastify API, session/runtime orchestration, environment manager, and Pi bridge |
| [agent-station-chrome-extension](agent-station-chrome-extension/) | Chrome MV3 environment provider: recognizes supported sites, opens the localhost pane, and directly registers environment availability with Agent Station |
| [agent-station-obsidian-extension](agent-station-obsidian-extension/) | Obsidian sidebar host for the `agent-server-client` app |
| [dummy-client](dummy-client/) | Port-3000 postMessage debug stub |

External dependency: a sibling Pi agent package at `../my-agent/` (not checked into this repo) provides the agent/skill environment referenced by the default Pi profile.

Use the package READMEs above as the main lookup docs for each area.

## Quick start
1. Install **pi.dev / Pi** first, and make sure the `pi` CLI is on your `PATH`.
   Agent Station's default Pi-backed profile shells out to Pi directly; without that install, Pi agents will not start.
2. Make sure the sibling agent package exists at `../my-agent/`.
   This repo expects that path relative to `agent-server-client/`, so the default profile resolves it as `rookery_ai/agent-server-client/../my-agent`.
3. Install the main app deps:
   ```bash
   cd agent-server-client && npm install
   ```
4. Install the Obsidian plugin deps if you are working on that package too:
   ```bash
   cd agent-station-obsidian-extension && npm install
   ```
5. From the repo root, start the main dev stack:
   ```bash
   npm run dev
   ```
6. Open `http://127.0.0.1:3000`

## Pi agent configuration
Default Pi agent profiles live in:
- `agent-server-client/config/agent-profiles.json`

Current default profile:
```json
{
  "id": "MyPiAgent",
  "type": "pi",
  "parentId": "PiAgent",
  "args": ["-e", "../my-agent", "--mode", "rpc"]
}
```

What that means:
- `id`: the agent name shown in Agent Station
- `type: "pi"`: use the Pi bridge/runtime
- `parentId: "PiAgent"`: inherit the built-in Pi-backed agent behavior
- `args`: extra CLI args passed to Pi when Agent Station launches it

The important bit is:
- `-e ../my-agent` points Pi at the sibling agent package directory
- `--mode rpc` tells Pi to run in RPC mode so Agent Station can talk to it

## `../my-agent/` layout
`../my-agent/` is a separate sibling package, not part of this repo. Agent Station expects it to be your Pi agent/skills workspace.

Typical responsibilities there:
- agent instructions/prompts
- installed or custom skills
- skill metadata and implementations
- any Pi-specific config that belongs to the agent package itself

In short:
- configure **which Pi agent package to launch** in `agent-server-client/config/agent-profiles.json`
- configure **the contents of that agent package** inside `../my-agent/`

If you move or rename the sibling package, update `args` in `agent-profiles.json` accordingly.

## Helpful scripts
- `./scripts/inject-environment.sh demo:demo` — manually register an environment
- `./scripts/drop-database.sh --yes` — drop the current Agent Station SQLite database

## Monorepo notes
- `agent-server-client/` owns the main npm deps and lockfile for the web app/server
- `agent-station-obsidian-extension/` is a separate npm package
- `environment-repository/` holds local environment-linked skill bundles
- `scripts/` holds repo-level utilities
- `PRODUCT/` holds product notes and evolving architecture docs
