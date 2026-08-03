# Current implementation summary

This section summarizes the current code as it relates to the migration described in this directory. The notes below are preserved verbatim as historical review questions and to-dos; some of them describe work that is now complete or decisions that have since changed.

## Current state

- **SQLite is the source of truth for normal environment-repository storage.** The application database (`.var/rook/rook.sqlite`) stores sessions, transcripts, session/environment membership, and durable approve/reject decisions. The canonical repository database (`environment-repository.db`) and personal repository database (`~/.rook/environment-repository.db`) store environments, bundles, immutable revisions, content hashes, and complete capability artifact file maps.
- **Bundles remain the atomic unit** for publication, preview, approval, and runtime loading. Durable approval/rejection is keyed by the exact bundle content hash. Personal bundles are user-owned and do not require approval.
- **The legacy directory repository has been removed from the live and migration paths.** `DirectoryEnvironmentRepository`, its importer command, the checked-in legacy directory tree, compatibility source-path fields, and the old personal directory tree are gone. `ProjectDirectoryEnvironmentRepository` remains as the intentional exception for project-owned `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and MCP files.
- **The runtime still consumes ordinary files through a projection.** `AgentWorkspaceMaterializer` creates `.var/rook/agent-workspaces/<session-id>/` under the server repository root, without changing the session's project `cwd`. It materializes nested skills under `.agent/skills`, generated `AGENTS.md` content, inline or pseudo-skill facts, `llms.txt` reference skills, and MCP content under `.agent/mcp-servers`.
- **Environment changes rebuild the projection.** `AgentRuntimeManager` synchronizes the current workspace, materializes the newly resolved environment set, and replaces the runtime only after the existing ACP session successfully loads in the replacement process. Persisted session/environment membership is restored before a session is resumed or used after a server restart.
- **Personal authoring uses server-mediated write-back.** Existing personal skills are read from the writable workspace and written to a new SQLite revision after prompts and before close/rematerialization. Marked personal instruction sections in generated `AGENTS.md` are mapped back to the personal bundle. Newly created skill directories containing `SKILL.md` are created as personal SQLite artifacts when exactly one personal bundle is available. A real Pi CLI run verified creation of `web:xkcd.com` → `xkcd-writeback-verification` in `~/.rook/environment-repository.db`.
- **Read-only protection is currently a policy, not a security boundary.** External skill projections receive read-only filesystem permissions, but an agent with arbitrary shell access as the same OS user can potentially bypass them. The generated aggregate `AGENTS.md` is logically mapped only for personal sections, not physically protected per section. Strong sandboxing or a separate runtime user remains future work.
- **Capability-family support is intentionally uneven.** Facts and `llms.txt` have first-pass runtime projections. MCP configuration/content is stored, previewed, and materialized, but Rook does not start MCP servers or enumerate tools, manage their authentication, or provide a complete MCP write-back/lifecycle model. Apps are represented in repository/preview data but are not a general runtime materialization path.
- **The repository API is still the migration-era API.** SQLite-backed list/search/read and personal write-back are implemented. Remote fetch, refresh, revalidation, richer filtering, publishing, conflict merging, and strong provenance/security validation remain future work.

## Current validation

- Server TypeScript typecheck passes.
- The current server suite reports 126 passing tests and 5 skipped tests.
- The ACP integration coverage exercises environment registration, approval, materialization, personal skill/instruction editing, and newly authored personal skill persistence.
- Real CLI validation was performed by restarting the server, joining `web:xkcd.com`, and having Pi create a new personal skill that was subsequently visible in the personal SQLite database.

## things to review
1. Does the agent have it's own directory? A: nope! run `./scripts/tail-logs.sh --instructions` and you'll see `Current working directory: /` instead of some more appropriate folder - probably ~/.rook/workspaces/<session_id> would be a good choice
2. What databases exist to store bundles? (and let's look at what they hold)
3. Can I write a new skill to an environment? How does it know where to save it
  - same question for AGENTS.md 
4. How did we make the agent only be able to edit some files (the user content) and not all of them (the capabilites pulled in from non-self sources)? Did we use a sub-user?
  - try to write to something like that and prove it's not writable


## Remaining to-dos
- [ ] Move the working directory to ~/.rook/workspaces/<session_id>
- [ ] Generated instructions are still injected through two paths `Current AgentRuntimeManager` includes both: EnvironmentManager.runtimeInstructionsForSession(...) and materialized AGENTS.md content. Make sure that agent workspaces AGENTS.md and skills gets rematerialized whenever a new environment is entered
  - [ ] Make sure that the per-environment agent files are there. Probably stick them in .agent/AGENTS/<bundle_specific>_AGENTS.md. Also include personal bundle files for environments that don't have personal bundles yet. AH! But only include .agent/AGENTS/<bundle_specific>_AGENTS.md for things that are writable.
  - [ ] Make sure the AGENTS.md file concatenates all the per-environment agent files and references the file that was sourced. Include even a placeholder for environments that don't have personal capabilities yet.
  - [ ] For skills, we might need to inject "this skill is editable" into the skill description and talk about creating new skills. Shit - but when the user creates a new skill, how will the agent know which environment to stick it into (e.g. if this session is in multiple environments)? Will the skill have a prefixed name (prefixed by environment) or what? THIS IS CRITICAL TO GET RIGHT
  - [ ] Probably the files in the working directory need to be symbolically linked so that no matter where they're written from, it affects a single source of truth, and we can have watchers on those files which updates the database.
- [ ] If I'm making a new user defined memory or something in a particular environment, then the natural thing for an agent to do is to write AGENTS.md in that directory, but we have to provide special instructions to tell it to stick it in the AGENTS file especially associated with that environment.
  - [ ] BUT! What if there are already other AGENTS.md content associated with that environment (but from a different publisher or environment repository)? So crap :/ I have to tell the agent to make this distinction too.
  - [ ] This means that AGENTS.md must not be writable
- [ ] Currently the agent work spaces are stuck here /Users/johnberryman/projects/github/rookkeeper/_worktrees/environment-repo-db/.var/rook/agent-workspaces/<session_id> but we need to stick them in ~/.rook/agent-workspaces/<session_id>
- [ ] Double check injected text to make sure it's what I want
  - [ ] We need to depend upon the materialized AGENTS.md instead of using the template method and appending to instructions.
  - [ ] Make injecting capabilities into an environment be a skill rather than dumping all the details into the instructions.
- [ ] Make a run at removing all legacy code
- [ ] Agent needs to be started with cwd set to the workspace dir - this will automatically load in the skills and AGENTS.md (oh! this also means that we don't have to inject skills into the runtime when we restart - we just set the CWD appropriately, this is a simplification that we need to take advantage of otherwise the skills will be injected twice)
- [ ] When I'm ready to work with MCP servers, this is probably what I store and hash ` npx -y @modelcontextprotocol/inspector@latest --cli https://hf.co/mcp --transport http --method tools/list | jq` - might need other methods to get things like prompts. Maybe walk this in order ```initialize (get basic details)
tools/list
resources/list
prompts/list
resources/templates/list   (if supported)

for every prompt:
    prompts/get

for every resource:
    resources/read (though this might be very very large!)```

## More distant or unrelated to-dos
- [ ] [#118 -- Restore session environment membership after Rook restarts](https://github.com/rookkeeper/rook/issues/118): persist each session's entered environments and restore them before resuming the runtime, so approved bundle skills, projections, and environment-specific instructions are available after a Rook restart.
- [ ] Every time the bash tool is used it says "No input or output captured."
- [ ] If one agent changes the capabilities in a personal bundle than all other agents that are currently running and using that bundle need to be re-materialized. That is their agents and skills files in their working directory need to be rewritten with the new information and they need to be restarted. maybe we can skip the restart just rematerialize their files If we restart, we have to make sure that we're not interrupting their work. 
- [ ] Move the application db into ~/.rook (probably combine environment_repository into that)
