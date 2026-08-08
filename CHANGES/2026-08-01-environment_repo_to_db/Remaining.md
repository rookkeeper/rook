# things to verify
- [x] can create skill in a web environment.
- [x] can create agent file in web environment. 
- [x] can create skill in a directory environment.
- [x] can create agent file in directory environment. 
- [x] can load skill in a web environment.
- [x] can load agent file in web environment. 
- [x] can load skill in a directory environment.
- [x] can load agent file in directory environment. 
- [x] can edit skill in a web environment.
- [x] can edit agent file in web environment. 
- [x] can edit skill in a directory environment.
- [x] can edit agent file in directory environment. 
- [x] can load non-editable skill in a web environment - but can't edit it.
- [x] can load non-editable agent file in web environment - but can't edit it.
- [x] can delete AGENTS.md files and have it removed
- [x] can delete skill and have it removed
- [ ] Rook general instructions look correct. 
- [x] The agent file gets inserted correctly. For example, it doesn't have a weird <projected> Tag around it for some reason. 
- [ ] The contents of the aggregate agent file looks correct. For example, it does have tags around the contents that are editable, indicating where to edit them. 
- [ ] the agent files instructions for editing things make sense. 
- [ ] All skills and agent files are appropriately injected. 


# todos
- [x] Whenever I open the Zed window, I can see an environment pop into Rook for the Zed application, but I would expect to see an environment pop into Rook for the actual project directory because it does have things that obviously make it look like a project. So that's a code degradation. 
- [ ] Make sure that when there is not sub AGENTS.md files that the aggregate AGENTS.md makes sense
- [ ] Maybe the .agents/editable/ directories need to be combined somehow
- [ ] Review server/src/environments/support/RookIdentityPrompt.ts
- [ ] See if I should change the structure of the agent workspaces to more closely follow how the global workspace has been rewired, e.g. so that editable AGENTS.md and skills are in the same linked directory
- [ ] Make sure all of the above are represented in tests.
- [ ] See if I should shrink server/src/runtime/CapabilityWorkspaceManager.ts (or maybe we just need to remove all the acrued compatibility code)
- [ ] Need to add instructions about deleting skills and AGENTS.md b/c the agent just tried to do it and got confused - if we could make linkes look like files that would be great too
- [ ] Make sure the environment repository boundary isn't leaky b/c I might want to rip out everything and do it differently at some point
- [ ] Put the explanation into Rook instructions
- [ ] Create a new issue for future work here
  - [ ] Get rid of the database again?
  - [ ] Instead create a permanent global workspace that has a single folder that contains `.agents/skills`, `AGENTS.md`; have a manifest file with descriptions of the bundle that points to their global workspace stuff; have manifest of all the environments (includes an environment description)
  - [ ] Make agent workspace just symlink to appropriate global workspace folders
  - [ ] Ideal situation: no database; no file watchers - not sure if this is possible.
  - [ ] Problems to resolve before I start - 
    - [ ] How do I deal with local MCP servers that need to be installed somewhere permanently in a place that is hidden from the agents so he can't see keys and stuff
    - [ ] How do I deal with llms.txt which have to be wrapped in a skill most likely.
    - [ ] Need to more clearly understand how all this will work on phone
- [ ] Make new issue for mobing the rook db
- [ ] Create an integration test that spins up a new session enters directory, web, and mac app environments, and creates skills and instructions. AND THEN it starts a new session, enters those same environments, and then checks if the agent workspace is properly formed (AGENTS.md which contains text of sub AGENTS.md files and also the expected .agents/skills). Then we instruct the agent to modify those skills and instructions associated with each environment. WE MAKE SURE not to check if the special symlinked directories are there, and we don't instruct the agent to use those. But then we open up a new session to the same environments and we check that the changes are persisted. Finally we ask them do be deleted. New session against the same environments should show they really are deleted. Every time we make a modification, we want to take a new look at the AGENTS.md and .agents/skill directories to make sure they appropriately represent the changes. We also need to make sure that we can enter into environments that are not rideable so they have skills and agent files associated with a canonical environment repository.

# Note: agent confusion around deleting environment skills and instructions

What happened:
- While removing the cold-sample environment skills, the agent correctly treated the aggregate `AGENTS.md` as generated/read-only, but then got confused about which files were the real things to edit/delete.
- The agent went looking for underlying targets, source-of-truth locations, and eventually even the database, instead of just modifying the visible projected files inside the entered environment.
- The confusion got worse because the aggregate `AGENTS.md` did not refresh instantly from the agent's perspective, so the agent interpreted stale text as evidence that the deletion had not propagated. (We shuld check that there isn't an actual bug here.)

Sources of the confusion:
- The current `## Skill editing` section explains where to create skills, but does not clearly say that deleting and editing should also happen directly in the projected environment paths.
- The aggregate file currently encourages the agent to reason about writable "source files" and symlink targets instead of treating the visible projected paths as authoritative.
- The file does not clearly state that projected `.agents/skills` and aggregate `AGENTS.md` may refresh asynchronously and that the agent should trust that eventual refresh.
- The file does not explicitly forbid rummaging around in the environment repository implementation details (SQLite, backing storage, watcher behavior, etc.).

What the agent should have done:
- Delete/edit only the projected files that are visible in the current agent workspace.
- For instructions/memories, edit the path shown in the aggregate `AGENTS.md` (for example `.agents/editable-per-environment/zed/AGENTS.md`) without resolving the symlink target.
- For skills/processes, add/edit/delete directories directly under the visible projected environment skill authoring path.
- Trust that Rook will propagate the change and rematerialize the aggregate `AGENTS.md` and `.agents/skills` inventory shortly afterward.
- Never inspect or modify the database or other hidden implementation details.

How the aggregate `AGENTS.md` template should change:
- Add a short orientation section near the top that says the visible projected paths are the paths the agent should treat as authoritative.
- Move `## Environment skills` near the top, right after `## Environment instructions`, so the current skill inventory is easy to see.
- Replace `## Skill editing` with something like `## Adding, editing, and deleting skills (or processes)`.
- Add a parallel section `## Adding, editing, and deleting instructions (or memories)`.
- In both explanation sections, explicitly say:
  - edit/delete the visible projected files;
  - do not resolve symlinks or search for deeper backing stores;
  - do not inspect the database;
  - projected files may appear stale briefly, but refresh will happen automatically.
- Keep the explanation short and behavioral. The agent does not need wiring details about watchers, persistence, or repository internals.

## Example organization for the aggregate AGENTS.md

### `# Rook environment instructions`
- A very short orientation.
- Explain that this file is generated/read-only.
- Explain that when the agent needs to change things, it should treat the visible projected paths in the current workspace as authoritative.
- Briefly note that visible projected files may refresh shortly after edits, deletions, or creations, and the agent should trust that.

### `## Environment instructions and memories`
- Contain the per-environment `<environment_instruction ...>` blocks.
- These should just expose the instruction content for each entered environment plus the editable path when relevant.
- Keep this section focused on environment-specific content, not editing theory.

### `## Environment skills and proceedures`
- Show the current skill inventory for each entered environment.
- Put this near the top so the agent can quickly see what skills currently exist.
- This is especially useful before adding, editing, or deleting a skill.

### `## Adding, editing, and deleting instructions and memories`
- Explain how to edit/delete instruction files.
- Tell the agent to use the visible path shown in the aggregate file.
- Explicitly say not to resolve symlinks or hunt for backing storage.
- Explicitly say not to inspect implementation details like databases.

### `## Adding, editing, and deleting skills and processes`
- Explain how to add/edit/delete skills using the visible projected environment skill directories.
- Include the visible path pattern for where skills should live.
- Explicitly say that deleting a visible projected skill directory is the correct way to remove a skill.
- Explicitly say to trust automatic rematerialization rather than verifying every propagation step.

### General style goals for the whole file
- Keep it short.
- Keep it behavioral.
- Avoid implementation details.
- Optimize for helping the agent do the right thing quickly, not for teaching how the wiring works.

