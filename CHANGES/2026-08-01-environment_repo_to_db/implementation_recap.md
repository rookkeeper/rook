## things to review
1. Does the agent have it's own directory? A: nope! run `./scripts/tail-logs.sh --instructions` and you'll see `Current working directory: /` instead of some more appropriate folder - probably ~/.rook/workspaces/<session_id> would be a good choice
2. What databases exist to store bundles? (and let's look at what they hold)
3. Can I write a new skill to an environment? How does it know where to save it
  - same question for AGENTS.md 
4. How did we make the agent only be able to edit some files (the user content) and not all of them (the capabilites pulled in from non-self sources)? Did we use a sub-user?
  - try to write to something like that and prove it's not writable


## Remaining to-dos
- [ ] Move the working directory to ~/.rook/workspaces/<session_id>
- [ ] Make sure that agent workspaces AGENTS.md and skills gets rematerialized whenever a new environment is entered
  - [ ] Make sure that the per-environment agent files are there.
  - [ ] Make sure the AGENTS.md file concatenates all the per-environment agent files and references the file that was sourced.
- [ ] If I'm making a new user defined memory or something in a particular environment, then the natural thing for an agent to do is to write AGENTS.md in that directory, but we have to provide special instructions to tell it to stick it in the AGENTS file especially associated with that environment.
  - [ ] BUT! What if there are already other AGENTS.md content associated with that environment (but from a different publisher or environment repository)? So crap :/ I have to tell the agent to make this distinction too.
  - [ ] This means that AGENTS.md must not be writable
- [ ] Currently the agent work spaces are stuck here /Users/johnberryman/projects/github/rookkeeper/_worktrees/environment-repo-db/.var/rook/agent-workspaces/<session_id> but we need to stick them in ~/.rook/agent-workspaces/<session_id>
- [ ] Double check injected text to make sure it's what I want
  - [ ] We need to depend upon the materialized AGENTS.md instead of using the template method and appending to instructions.
  - [ ] Make injecting capabilities into an environment be a skill rather than dumping all the details into the instructions.

## More distant or unrelated to-dos
- [ ] [#118 -- Restore session environment membership after Rook restarts](https://github.com/rookkeeper/rook/issues/118): persist each session's entered environments and restore them before resuming the runtime, so approved bundle skills, projections, and environment-specific instructions are available after a Rook restart.
- [ ] Every time the bash tool is used it says "No input or output captured."
