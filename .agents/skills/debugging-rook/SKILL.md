---
name: debugging-rook
description: Choose and follow the right debugging workflow for the Rook monorepo, especially CLI sessions, server state, Apple clients, and unified logs.
---

# Debugging Rook

Use this as a menu. Pick the cheapest lane that can answer the question, then
escalate only when its evidence points elsewhere. The detailed procedures live
in the linked references; read the relevant reference before running a longer
workflow.

## Before you start

- Work from the checkout that owns the behavior under test.
- Source `.env` before using `rook`; CLI calls need `--auth-token "$ROOK_AUTH_TOKEN"`.
- Prefer a worktree's isolated profile. Never modify real `~/.rook` state or stop
  another developer's Rook instance.

## Pick a debugging lane

| Choose this | When | Why | Reference |
| --- | --- | --- | --- |
| **CLI / protocol** | A runtime, ACP, prompt, tool, or server response looks wrong | Fast, deterministic, and avoids native rebuilds | [CLI and protocol](references/cli-and-replay.md) |
| **Transcript / replay** | A session works on the server but renders or hydrates incorrectly | Compares the server-owned transcript with client replay | [CLI and protocol](references/cli-and-replay.md) |
| **Server / environment** | Health, environments, bundles, decisions, or managed processes look wrong | Inspects state directly instead of guessing from UI | [Server and environment](references/server-and-environment.md) |
| **Prompt construction** | The agent seems to receive the wrong instructions, tools, or skills | Shows the exact provider payload sent to the model | [Server and environment](references/server-and-environment.md#prompt-and-instruction-traces) |
| **Apple client logs** | Mac/iPhone networking, lifecycle, location, voice, or performance is suspect | Shared structured logs usually identify the failing boundary | [Apple client logs](references/apple-client-logs.md) |
| **Native UI** | The bug is visual, interaction-specific, or cannot be explained by logs | Computer use observes the actual rendered app; use last | [Native client UI](references/native-client-ui.md) |

## Escalation order

1. CLI + `MockAcpAgent`
2. CLI + the real runtime
3. Server/environment diagnostics or Apple unified logs
4. Codex computer use, and `sample` for a Mac beachball

For a native hang, capture logs and a stack sample before trying to reproduce it
through UI automation. For a client/server disagreement, compare the CLI
transcript and client logs before inspecting the view.

## Quick entry points

```bash
rook exec --last-message-only --runtime MockAcpAgent \
  --auth-token "$ROOK_AUTH_TOKEN" "12+34"
./scripts/run-rook.sh server
./scripts/run-rook.sh mac server
./scripts/run-rook.sh stop
```

## Reference map

- [CLI and replay](references/cli-and-replay.md) — commands, mock-agent scenarios,
  named sessions, transcript comparison, and replay failure modes.
- [Server and environment](references/server-and-environment.md) — launcher
  profiles, diagnostics, environment storage, tests, and prompt traces.
- [Apple client logs](references/apple-client-logs.md) — Unified Logging capture,
  categories, event vocabulary, performance interpretation, and iPhone/Mac
  diagnostics.
- [Native client UI](references/native-client-ui.md) — Mac launch/Codex usage,
  beachball capture, and privacy cautions.
