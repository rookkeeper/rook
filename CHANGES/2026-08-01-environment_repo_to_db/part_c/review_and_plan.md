# things to verify
- [ ] can create skill in a web environment.
- [ ] can create agent file in web environment. 
- [ ] can create skill in a directory environment.
- [ ] can create agent file in directory environment. 
- [ ] can load skill in a web environment.
- [ ] can load agent file in web environment. 
- [ ] can load skill in a directory environment.
- [ ] can load agent file in directory environment. 
- [ ] can edit skill in a web environment.
- [ ] can edit agent file in web environment. 
- [ ] can edit skill in a directory environment.
- [ ] can edit agent file in directory environment. 
- [ ] can load non-editable skill in a web environment - but can't edit it.
- [ ] can load non-editable agent file in web environment - but can't edit it.
- [ ] Rook general instructions look correct. 
- [ ] The agent file gets inserted correctly. For example, it doesn't have a weird <projected> Tag around it for some reason. 
- [ ] The contents of the aggregate agent file looks correct. For example, it does have tags around the contents that are editable, indicating where to edit them. 
- [ ] the agent files instructions for editing things make sense. 
- [ ] All skills and agent files are appropriately injected. 


# todos
- [ ] Whenever I open the Zed window, I can see an environment pop into Rook for the Zed application, but I would expect to see an environment pop into Rook for the actual project directory because it does have things that obviously make it look like a project. So that's a code degradation. 
  - [ ] Similarly, when I open the finder to a specific directory within a project, It uses that directory as the environment rather than the place in the hierarchy that actually has some project files. 
- [ ] I'm not sure why the global workspace needs a manifest. Why can't we just use the naming convention and stick everything in ~/.rook/global-workspace/<environment_identifier>/*  (including AGENTS.md and skills there or .agents/skills so that it looks like a project directory)
- [ ] Make sure that when there is not sub AGENTS.md files that the aggregate AGENTS.md makes sense










