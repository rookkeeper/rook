# Skills definitions

The Rook skills associate w/ an environment are simply [agent skills](https://agentskills.io/home). But they need some extra structure.

- The YAML needs to mention the environment they are associated with by id (e.g. location:homedepot.com/store-4321) because the environment state changes and notifications will use this id.
- The skills should _probably_ not introduce any new tools. However the skills probably should make use of a tool `interact_with_environment` (or something similarly named - TBD) that allows them to interact with the environment - see [[narrow-skills-environment-bridge]] for more info.