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
- [ ] Review server/src/environments/support/RookIdentityPrompt.ts
- [ ] Create an integration test that spins up a new session enters directory, web, and mac app environments, and creates skills and instructions. AND THEN it starts a new session, enters those same environments, and then checks if the agent workspace is properly formed (AGENTS.md which contains text of sub AGENTS.md files and also the expected .agents/skills). Then we instruct the agent to modify those skills and instructions associated with each environment. WE MAKE SURE not to check if the special symlinked directories are there, and we don't instruct the agent to use those. But then we open up a new session to the same environments and we check that the changes are persisted. Finally we ask them do be deleted. New session against the same environments should show they really are deleted. Every time we make a modification, we want to take a new look at the AGENTS.md and .agents/skill directories to make sure they appropriately represent the changes. We also need to make sure that we can enter into environments that are not rideable so they have skills and agent files associated with a canonical environment repository.
- [ ] Keep working on the spinny beachball of doom (currently I've got logging standardized and I'm tracking possibilities in /Users/johnberryman/projects/github/rookkeeper/rook/CHANGES/2026-08-11-mac-client-stall-investigation/BRAINSTORM.md)
