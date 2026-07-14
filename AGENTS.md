# Global Instructions

This is a mono-repo for the Rook personal agent. The agent knows its user AND the agent can be made to interact with the environment around it.

Product/design notes: `PRODUCT/`. When making PRs, make sure to reference anything in this directory and describe how the PR interacts with the current PRODUCT design philosophy and approach. Does it implement a missing feature that product docs is asking for? Does it create a new concept (which you definitely need to add to documentation as part of the PR)? Does it change part of the design philosophy and approach or negate it (In this case, also update the docs as part of the PR)? `PRODUCT/AS-BUILT-ARCHITECTURE.md` is also a good place to look for the current structure. If you notice the structure is being modified from what this document describes, make sure to eventually update this document too.

When making changes:
- Keep tests in sync with code changes.
- I will often ask about GitHub issues, pull requests, and related work. Typically use the GitHub CLI (`gh`) to access, inspect, search, create, and manage those things.
- When I ask you to create a GitHub issue, write it like a person speaking naturally. Do not turn it into a formal template or over-structure it unless I ask for that.
- When issue labeling is relevant, use the repo's current GitHub labels via `gh`. Current preferred labels are: `bug`, `documentation`, `good first issue`, `mac-client`, `iphone-client`, `android-client`, `server`, `environment-repository`, `ui/ux`, and `datamodel`.
- When we're working on an issue, it's usually a big enough chunk of work to create a git worktree in `../_worktrees/`. Name it after the issue and topic (for example, `issue-46-tabs`) and use that worktree for the implementation work. After creating the worktree, copy `.env` from the main repo into it (`cp ../rook/.env ../_worktrees/issue-46-tabs/.env`) — it's gitignored so the worktree starts without it, and `run-rook.sh` needs it for remote phone/server config.
- When you make obvious structural or workflow changes, update the relevant READMEs: root `README.md` and the README in whichever major package you touched (`server/`, `clients/mac/`, `clients/iphone/`, `clients/RookKit/`). Also update relevant docs in PRODUCT
- Once you're complete with a large chunk of work, use the mac `say` command to tell me what you've done. Use no more than 7 words. You can background it (e.g. `say '…' &`) so it does not block the shell. Make sure to always end the `say` expression with a sentence-ending punctuation.
- Never push to remote or run `git push` unless I explicitly tell you to. Commit locally all you want.

# Debug scripts

Use `scripts/interact-with-remote-agent.sh` to exercise the remote-agent bridge without the UI (run from repo root; needs the `server/` package deps installed — `cd server && npm install` once). Read the docs to use it.

Run Rook from the repo root with:
- `./scripts/run-rook.sh mac server`

## Debugging patterns

Prefer the **rook CLI** and the **mock agent** for fast iteration — they're much quicker than rebuilding native clients or waiting for real AI runtimes. Only reach for the mac client + Codex computer‑use when the bug really is in the native UI layer.

### Fast path: rook CLI + mock agent

```bash
source .env
rook exec --runtime MockAcpAgent --auth-token "$ROOK_AUTH_TOKEN" "tell me a joke"
rook exec --last-message-only --runtime MockAcpAgent --auth-token "$ROOK_AUTH_TOKEN" "12+34"
rook exec --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN" "what did you just say?"
rook --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN"   # interactive with transcript replay
```

The mock agent is in `server/src/server/agents/test-fixtures/mockAcpServer.mjs` — it stores a transcript and replays it on session load, streams thoughts/tool calls/assistant text, and handles common prompt patterns (jokes, ls, arithmetic, prime checking). Edit it to add new test scenarios.

If the mock doesn't support a needed behavior, fall back to a real runtime (MyPiOpenAiAgent, MyClaudeAgent, etc.).

### CLI session management

List existing sessions with metadata:
```bash
rook sessions --auth-token "$ROOK_AUTH_TOKEN"
rook sessions --limit 5 --auth-token "$ROOK_AUTH_TOKEN"
```

Create a **named** session for easy identification in the mac client and in codex instructions:
```bash
rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" --title "my-test" "do something"
```
`--title` only works with `--runtime` (new session creation), not with `--sessionId`.

Dump the full session transcript to see exactly what the runtime sends during replay:
```bash
rook --transcript --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN"
```

### Testing session replay in the mac client

The mac client's sessions list does **not** auto-refresh — you must restart the mac app to see newly created sessions:

```bash
./scripts/run-rook.sh mac server
```

Then use Codex to click into the session **by name**:

```bash
codex exec "Use computer use. Interact with the Rook app at /Users/johnberryman/projects/github/the-rooks-nest/rook/.var/run-rook/build/Rook/Build/Products/Debug/Rook.app. In the SESSIONS list, find the session named 'my-test' and click it. Describe what you see." 2>/dev/null
```

Common replay bugs to watch for:
- blocks must be cleared **before** `session/load`, not after — otherwise the runtime's replay events get wiped
- user/assistant/thinking/tool events during replay need separate buffering from active-turn streaming
- the `isRunning` state flag must stay `false` during replay so the status dot doesn't glow

### Mac client bugs: Codex + computer use

When the bug is in the native macOS client UI, use Codex to interact with it.

**Always specify the correct app path** — there are often multiple Rook builds on disk (Xcode DerivedData, run-rook build) sharing the same bundle ID, so tell Codex which one to use:

```bash
codex exec "Use computer use. Interact with the Rook app at /Users/johnberryman/projects/github/the-rooks-nest/rook/.var/run-rook/build/Rook/Build/Products/Debug/Rook.app. [instruction]" 2>/dev/null
```

Examples:
```bash
codex exec "Use computer use. Interact with the Rook app at /Users/johnberryman/projects/github/the-rooks-nest/rook/.var/run-rook/build/Rook/Build/Products/Debug/Rook.app. Tell me what screen it's on." 2>/dev/null
codex exec "Use computer use. Interact with the Rook app at /Users/johnberryman/projects/github/the-rooks-nest/rook/.var/run-rook/build/Rook/Build/Products/Debug/Rook.app. Click the session named 'my-test' and report what you see." 2>/dev/null
codex exec "Use computer use. Interact with the Rook app at /Users/johnberryman/projects/github/the-rooks-nest/rook/.var/run-rook/build/Rook/Build/Products/Debug/Rook.app. Type 'hi' into the chat input and press enter. Report what happens." 2>/dev/null
```

Key bits:
- `codex exec` for non-interactive one-shot
- `"Use computer use."` as the first sentence loads that skill
- **always include the full app path** so Codex targets the correct build
- **click sessions by name** not by position — the list order depends on when the app was last refreshed
- `2>/dev/null` suppresses the noisy startup banner

### Full debug workflow for replay bugs

1. Create a named session with the scenario you want to test:
   ```bash
   rook exec --runtime MyPiOpenAiAgent --auth-token "$ROOK_AUTH_TOKEN" --title "replay-test" "ls the directory"
   ```
2. Verify the transcript looks right:
   ```bash
   rook --transcript --sessionId <id> --auth-token "$ROOK_AUTH_TOKEN"
   ```
3. Restart the mac app so it picks up the new session:
   ```bash
   ./scripts/run-rook.sh mac server
   ```
4. Use Codex to click the session by name and report what it sees:
   ```bash
   codex exec "Use computer use. Interact with the Rook app at .../.var/run-rook/build/Rook/Build/Products/Debug/Rook.app. Click the session named 'replay-test'. Describe every message in order." 2>/dev/null
   ```
5. Compare the CLI transcript with Codex's report — they should match.

