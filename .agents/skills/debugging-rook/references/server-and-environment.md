# Server and environment debugging

Use this lane when health, runtime discovery, environment registration, bundle offers, decisions, or managed processes are suspect. It inspects state directly instead of inferring it from a client screen.

## Launch profiles

Run from the checkout being investigated:

```bash
./scripts/run-rook.sh server       # server only
./scripts/run-rook.sh mac server   # server + Mac client
./scripts/run-rook.sh sim          # server + iPhone simulator
./scripts/run-rook.sh stop         # stop this profile's resources
```

A worktree profile has isolated ports, `ROOK_HOME`, SQLite state, and app identity. Keep launcher tests hermetic: use temporary Git repositories/worktrees and fake processes/listeners. Never modify real `~/.rook` state or stop another developer's running Rook.

## Diagnostic scripts

```bash
./scripts/interact-with-remote-agent.sh
./scripts/print-environments.sh
./scripts/print-environments.sh --raw
./scripts/dump-environment-decisions.sh
./scripts/run-tests.sh
```

- `interact-with-remote-agent.sh` exercises the remote-agent bridge and needs `server/` dependencies installed.
- `print-environments.sh` calls `GET /api/diagnostics/environments` and shows active/recent environments, status, and bundle counts.
- `dump-environment-decisions.sh` reads SQLite's `environment_decisions` table and shows decisions keyed by bundle hash.
- `run-tests.sh` runs the known server, Swift package, iPhone, and macOS checks.

## Environment storage

Environment repositories are SQLite databases, not directories:

```text
<checkout>/environment-repository.db                # canonical (ROOK_ENVIRONMENT_REPOSITORY_DB)
~/.rook/environment-repository.db                   # personal, writable (ROOK_PERSONAL_ENVIRONMENT_REPOSITORY_DB)
$ROOK_HOME/web-environment-repository.db            # web, scouted from sites (ROOK_WEB_ENVIRONMENT_REPOSITORY_DB)
```

Each has `environments`, `capabilities`, and `bundles`; the web database adds `web_scouts` and `web_scout_resources`. Project-directory content is read from the project's own files. For the storage and authoring model, read:

- `PRODUCT/environment-repository.md`
- `PRODUCT/environment-local-authoring.md`
- `AS-BUILT-ARCHITECTURE/database.md`

When a skill or instruction seems missing, query the databases directly:

```bash
sqlite3 ~/.rook/environment-repository.db "SELECT environment_id, bundle_id, publisher, deleted_at FROM bundles"
sqlite3 ~/.rook/environment-repository.db "SELECT capability_id, type, name FROM capabilities"
```

Personal writable sources are also visible under `$ROOK_HOME/global-workspace/writable/<environment-key>/`, which is where `--join` finds agent-authored artifacts.

## Web scouting

When a `web:<host>` environment shows no bundle or a stale one, check the scout state:

```bash
sqlite3 "$ROOK_HOME/web-environment-repository.db" "SELECT host, fetched_at, status, errors_json FROM web_scouts"
sqlite3 "$ROOK_HOME/web-environment-repository.db" "SELECT environment_id, bundle_id, capability_id FROM bundles"
sqlite3 "$ROOK_HOME/web-environment-repository.db" "SELECT type, name, content_hash FROM capabilities"
```

`status` is `content`, `empty` (the site publishes nothing; not re-probed until the 24 h TTL), or `error` (retried after 15 min). The server log has `scouted web environment` lines with `host`, `status`, `changed`, and error counts; `web scout disabled` at startup means `ROOK_WEB_SCOUT_DISABLED=1`.

To force a re-scout, delete the host's row and register the environment again (revisit the site or `POST /api/environments/register`), or run a dev profile with the TTL zeroed:

```bash
sqlite3 "$ROOK_HOME/web-environment-repository.db" "DELETE FROM web_scouts WHERE host = 'example.com'"
ROOK_WEB_SCOUT_TTL_MS=0 ROOK_WEB_SCOUT_ERROR_TTL_MS=0 ./scripts/run-rook.sh server
```

Without its `web_scouts` row a host serves no bundle; its old bundle rows stay in the file until the next scout replaces or clears them.

## Prompt and instruction traces

Use this when the model appears to receive the wrong system prompt, skills, tools, or environment context:

```bash
./scripts/tail-logs.sh
./scripts/tail-logs.sh --instructions
./scripts/tail-logs.sh --tools
```

These read `/tmp/pi/provider-payload.jsonl` by default, or `PI_TRACE_LOG` when set. They expose the raw provider payload, including system instructions, skill content, tool definitions, and injected environment context.

For an exact capture, start the tail in one terminal and trigger a prompt in another:

```bash
./scripts/tail-logs.sh --instructions
rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" "hi"
```
