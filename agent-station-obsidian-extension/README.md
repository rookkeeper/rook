# Agent Station Obsidian Extension

Obsidian plugin that embeds the **agent-server-client** web app in a right-sidebar panel.

## TL;DR

When this plugin opens, it loads `http://localhost:3000` inside an iframe. That iframe hosts the chat UI and handles agent communication. From the Obsidian side, this extension mostly just creates and manages that embedded view.

You do **not** need to know the lower-level messaging details to use or develop this plugin right now.

## What this extension is for

This plugin gives you an in-Obsidian entry point for chatting with your agent without leaving your notes workflow.

- Open a sidebar chat panel directly in Obsidian
- Reuse the existing `agent-server-client` UI and runtime behavior
- Keep Obsidian plugin logic thin (view/container shell)
- Iterate quickly on agent UX in one place (`agent-server-client`)

In short: **Obsidian provides the host panel; `agent-server-client` provides the actual app experience.**

## How it works (high level)

1. Plugin registers a custom Obsidian sidebar view.
2. The view renders an iframe.
3. The iframe points to `http://localhost:3000`.
4. The loaded app handles the chat UI + agent interactions.

That’s the architectural contract for now.

## Communication model (what talks to what)

Today, the Obsidian plugin itself is intentionally minimal:

- `agent-station-obsidian-extension/src/main.ts` creates the iframe and points it at localhost
- It does **not** implement a custom message bus in the plugin shell yet

Cross-window messaging is handled inside `agent-server-client` when needed:

- during agent runs, a special tool call (`message_parent`) can relay JSON payloads to the parent window via `postMessage`
- environment availability is now modeled through the server-side `EnvironmentManager`, not a client-side skill-injection flow

So at a practical level: the plugin hosts the iframe; the iframe app (`agent-server-client`) owns runtime chat behavior and any parent-window messaging.

## Monorepo context

Part of the [agent-station](../README.md) monorepo.

- `agent-station-obsidian-extension/` has its own `package.json` and `node_modules`
- `agent-server-client/` runs the web UI loaded by the iframe
- the main app should be running at `http://127.0.0.1:3000`

## Development

1. From repo root, run the shared dev stack (includes agent-server-client on port 3000):

```bash
npm run dev
```

2. In this package:

```bash
npm install
npm run dev    # watch → main.js
npm run build  # production main.js
```

3. In Obsidian:
- Enable **Agent Station Obsidian Extension**
- Reload after shell changes (`main.ts`, `styles.css`):

```bash
obsidian plugin:reload id=agent-station-obsidian-extension
```

## Obsidian install path

`~/.config/obsidian/plugins/agent-station-obsidian-extension` should symlink to this directory:

```bash
ln -sf "$(pwd)" ~/.config/obsidian/plugins/agent-station-obsidian-extension
```

(Use an absolute path if you run the command from elsewhere.)

## Source layout

- `src/main.ts` — Obsidian plugin shell + iframe view
- `src/components/` — local React chat UI experiments/mocks (not the primary runtime path today)
- `main.js` — esbuild output (commit after build so a fresh clone works)

## Current status

Early prototype (`v0.0.1`).

Primary runtime UX is delivered by `agent-server-client` through the iframe.
