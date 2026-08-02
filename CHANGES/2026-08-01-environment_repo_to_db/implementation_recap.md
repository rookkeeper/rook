## things to review
1. Does the agent have it's own directory? A: nope! run `./scripts/tail-logs.sh --instructions` and you'll see `Current working directory: /` instead of some more appropriate folder - probably ~/.rook/workspaces/<session_id> would be a good choice
2. What databases exist to store bundles? (and let's look at what they hold)
3. Can I write a new skill to an environment?
4. How did we make the agent only be able to edit some files (the user content) and not all of them (the capabilites pulled in from non-self sources)?

## Remaining to-dos

- [ ] [#118 -- Restore session environment membership after Rook restarts](https://github.com/rookkeeper/rook/issues/118): persist each session's entered environments and restore them before resuming the runtime, so approved bundle skills, projections, and environment-specific instructions are available after a Rook restart.
