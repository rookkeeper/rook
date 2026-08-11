# Global Instructions

This is a mono-repo for the Rook personal agent. The agent knows its user and can interact with the surrounding environment.

# Development work

For software development tasks, follow [the development lifecycle skill](.agents/skills/development-lifecycle/SKILL.md). It is the canonical process for planning work in `CHANGES/`, creating workspaces, implementing and testing changes, maintaining product and architecture documentation, opening and merging PRs, and cleaning up afterward.

Keep tests in sync with code changes. Changes to `scripts/lib/run-rook/` must update the shell tests in that directory and run `npm run test:launcher`.

Keep run-rook tests hermetic: use temporary Git repositories/worktrees and fake processes/listeners. Never modify the real `~/.rook` state or stop a developer's running Rook instance.

When big architecture, schema, layering, or cross-package structure changes happen, update the relevant files in `AS-BUILT-ARCHITECTURE/`. If those documents no longer describe the repository, bring them up to date.

When you make obvious structural or workflow changes, update the relevant READMEs: root `README.md` and the README in whichever major package you touched (`server/`, `clients/mac/`, `clients/iphone/`, `clients/RookKit/`). Also update relevant docs in PRODUCT

# GitHub issues

I will often ask about GitHub issues, pull requests, and related work. Typically use the GitHub CLI (`gh`) to access, inspect, search, create, and manage those things.

When asked to create a GitHub issue, write it like a person speaking naturally. Do not turn it into a formal template or over-structure it unless asked.

When issue labeling is relevant, use the repo's current GitHub labels via `gh`. Preferred labels include: `bug`, `documentation`, `good first issue`, `mac-client`, `iphone-client`, `android-client`, `server`, `environment-repository`, `ui/ux`, and `datamodel`.

# Communication and Git safety

When linking to repo files in chat, prefer Zed deep links in the form `[label](zed://file/absolute/path/to/file:line)` when a line number is useful, or `[label](zed://file/absolute/path/to/file)` otherwise.

Once you're complete with a large chunk of work, use the mac `say` command to tell me what you've done. Use no more than 7 words, run it in the background when possible, and end the `say` expression with a sentence-ending punctuation.

Never push to remote or run `git push` unless I explicitly tell you to. Commit locally all you want.

# Debugging

For debugging patterns, CLI commands, scripts, mock agent usage, and Codex computer-use workflows, read `.agents/skills/debugging-rook/SKILL.md`.

# Quick launch

Run commands from the checkout you want to use. The script selects the appropriate production or isolated development profile:

```bash
# Start the backend server.
./scripts/run-rook.sh server

# Start the backend and build/launch the Mac client.
./scripts/run-rook.sh server mac

# Start the backend and build/launch the iPhone simulator.
./scripts/run-rook.sh server sim

# Start the backend and build/launch a connected physical iPhone.
./scripts/run-rook.sh server iphone

# Stop the current profile's managed server and clients.
./scripts/run-rook.sh stop

# Stop managed resources for every profile only when broad cleanup is intended.
./scripts/run-rook.sh stop --all
```

The server runs on the selected profile's local port. Worktree development profiles use isolated state and ports; copy `.env` into a worktree when remote phone/server configuration is needed, as described by the development lifecycle skill.

Run a quick diagnostic against the active profile:

```bash
source .env
rook exec --runtime MockAcpAgent --auth-token "$ROOK_AUTH_TOKEN" "tell me a joke"
```
