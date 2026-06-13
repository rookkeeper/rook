# Global Instructions

Monorepo layout:

| Path | Role |
|------|------|
| `agent-server-client/` | React UI, Fastify API, and Pi bridge; owns npm deps and lockfile |
| `agent-station-chrome-extension/` | Chrome MV3 extension (per-site environment provider + agent panel) |
| `agent-station-obsidian-extension/` | Obsidian sidebar plugin (iframe to agent-server-client); separate npm package |
| `scripts/` | Repo-level utilities |
| `package.json` (root) | Orchestrator only; delegates dev/test/build to `agent-server-client` |
| `.var/` | Local runtime state (session logs, injected skills); gitignored |

External dependency (not in this repo): sibling Pi skills package at `../my-agent/`, referenced by `agent-server-client/config/agent-profiles.json`.

Product/design notes: `PRODUCT/`.

Install: `cd agent-server-client && npm install`; Obsidian: `cd agent-station-obsidian-extension && npm install`. Obsidian plugin dev symlink: `~/.config/obsidian/plugins/agent-station-obsidian-extension`.

- Keep tests in sync with code changes.
- When you make obvious structural or workflow changes, update the relevant READMEs: root `README.md` and the README in whichever major package you touched (`agent-server-client/`, `agent-station-chrome-extension/`, `agent-station-obsidian-extension/`).
- Once you're complete with a large chunk of work, use the mac `say` command to tell me what you've done. Use no more than 7 words. You can background it (e.g. `say '…' &`) so it does not block the shell. Make sure to always end the `say` expression with a sentence-ending punctuation.

# Debug scripts

Use `scripts/interact-with-remote-agent.sh` to exercise the remote-agent bridge without the UI (run from repo root; installs deps in `agent-server-client` once).

New session:

```bash
./scripts/interact-with-remote-agent.sh --agent MyPiAgent "prompt here"
# or: npm run agent:cli -- --agent MyPiAgent "prompt here"
```

Less noisy (hide streaming deltas):

```bash
./scripts/interact-with-remote-agent.sh --omit-deltas --agent MockAgent "hello"
```

Continue an existing session:

```bash
./scripts/interact-with-remote-agent.sh \
  --agent MyPiAgent \
  --session '<SESSION_JSON>' \
  "prompt here"
```

Filter flags: `--omit-deltas`, `--omit <types>`, `--only <types>`, `--no-session`, `--no-replay`. Run with `--help` for the full event-type list.

Register an environment as available (while dev server is running):

```bash
./scripts/inject-environment.sh demo:demo
# or approve directly for a session:
./scripts/inject-environment.sh --session-id '<SESSION_ID>' --approve demo:demo
```

- Prints filtered lines to stdout as JSONL.
- The session record is `{ "type": "session", "event": ... }` unless `--no-session`.
- ACP messages are `{ "type": "acp_message", "event": ... }`.
- HTTP replay (with `--replay`) is `{ "type": "replay", "event": ... }` unless `--no-replay`.
