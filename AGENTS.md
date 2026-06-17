# Global Instructions

This is a mono-repo for the Rook personal agent. The agent knows its user AND the agent can be made to interact with the environment around it.

Product/design notes: `PRODUCT/`. When making PRs, make sure to reference anything in this directory and describe how the PR interacts with the current PRODUCT design philosophy and approach. Does it implement a missing feature that product docs is asking for? Does it create a new concept (which you definitely need to add to documentation as part of the PR)? Does it change part of the design philosophy and approach or negate it (In this case, also update the docs as part of the PR)?

When making changes:
- Keep tests in sync with code changes.
- When you make obvious structural or workflow changes, update the relevant READMEs: root `README.md` and the README in whichever major package you touched (`server/`, `clients/mac/`, `clients/iphone/`, `clients/RookKit/`). Also update relevant docs in PRODUCT
- Once you're complete with a large chunk of work, use the mac `say` command to tell me what you've done. Use no more than 7 words. You can background it (e.g. `say '…' &`) so it does not block the shell. Make sure to always end the `say` expression with a sentence-ending punctuation.

# Debug scripts

Use `scripts/interact-with-remote-agent.sh` to exercise the remote-agent bridge without the UI (run from repo root; needs the `server/` package deps installed — `cd server && npm install` once). Read the docs to use it.
