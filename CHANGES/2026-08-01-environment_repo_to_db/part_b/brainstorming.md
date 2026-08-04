# Part B: Shared capability workspace

## Purpose

Part A completed the SQLite migration and the first file-based runtime projection. Part B is about changing that projection so writable capability files have one shared on-disk representation instead of one independent copy per session.

The current implementation still materializes separate copies under:

```text
.var/rook/agent-workspaces/<session-id>/
```

That is the behavior to replace.

## Direction decided so far

### Source of truth

- SQLite remains the durable source of truth for SQLite-backed canonical and personal capabilities.
- Project directories remain the source of truth for project-directory environments.
- The global workspace is a temporary, shared materialization of SQLite content. It exists so agent workspaces can link to real files on disk.
- The global workspace can be discarded and rebuilt while Rook is running or when Rook starts. We do not need reference counting or cleanup policy yet.
- External/community content is immutable and does not need to be placed in the global writable workspace. It can be materialized directly into an agent workspace with writes disabled.

### Proposed file topology

For SQLite-backed writable content:

```text
SQLite
  ↓ materialize
shared global capability workspace
  ↓ symlink
agent working directory
```

For project-directory content:

```text
project file
  ↓ link or mapped global entry
shared global capability workspace
  ↓ symlink
agent working directory
```

The goal is that an edit made through an agent-workspace symlink edits the shared underlying file. Multiple sessions then see one live file rather than independently synchronized copies.

Two agents can still edit the same file concurrently, but the system no longer has two asynchronous copies that can silently overwrite one another during later synchronization. Conflict handling can remain simple for now; team-scale concurrent editing is deferred.

## Global workspace design

The global workspace needs stable names for the files and directories it contains. Personal content should have stable mutable paths. External content, when it is materialized at all, should use immutable revision-specific paths.

A global entry also needs an internal mapping to its source:

```text
repository
  environment
  bundle
  artifact
  source kind
  revision or content hash
```

The mapping does not need to be exposed in full to the agent. Human-readable environment names can be shown in instructions, while the server retains stable machine identifiers.

The global workspace is a shared live working area, not a second permanent repository. SQLite-backed changes still need to be serialized back to SQLite. Project-backed changes need to remain in the project directory and must not be imported into SQLite.

### Open questions

1. What stable naming convention should be used inside the global workspace?
2. Should names be readable slugs, path-safe environment IDs, generated opaque IDs, or a combination?
3. Should a global materialization be retained until the temporary workspace is discarded, regardless of which sessions currently use it?

## Project-directory environments

`ProjectDirectoryEnvironmentRepository` is still the repository adapter for project-owned files. It reads project skills, `AGENTS.md`, `CLAUDE.md`, and `.mcp.json`, but it does not make the project content SQLite content.

The intended shared-workspace behavior is that project-backed global entries point to the real project files. When an agent edits the link, the project file changes directly.

There is a current identity issue to resolve before implementing this design:

- project bundles currently use `bundleId: "personal"`;
- environment registration can also create a SQLite personal bundle;
- composite write routing currently chooses by bundle ID alone.

Project bundles probably need an identity such as `project` or `directory`, or write routing must include both repository identity and bundle identity.

We also need to decide whether registering a project environment should create an empty SQLite personal bundle. The current direction is that capabilities attached to a directory environment belong in the project directory, including newly authored project skills and instruction changes, rather than being persisted to SQLite.

## Agent workspace and runtime

The agent workspace should contain links such as:

```text
.agent/skills/<skill>       → global capability file/tree
.agents/AGENTS/<source>.md  → global or project instruction source
AGENTS.md                   generated read-only aggregate
```

The runtime should use the agent workspace as its current working directory. This allows ordinary runtime discovery of `AGENTS.md` and `.agent/skills`. Project files will need to remain available from that workspace for coding tasks, either through links or an explicitly defined project-root arrangement.

This must be validated across Pi, Claude, Cursor, and generic ACP runtimes. The current launch path passes skill paths and prompt text explicitly and does not yet use the proposed shared workspace as the runtime cwd.

## AGENTS files

The aggregate `AGENTS.md` should be generated and read-only. It should not be the editable source of any instruction content.

Each environment/bundle should have an individual source file, including an empty personal placeholder when no personal instructions exist yet. For example:

```text
.agents/AGENTS/gmail-personal_AGENTS.md
```

The individual file should be linked to the actual global or project source. The aggregate should include the full text and identify its source:

```xml
<agent_instructions
  environment="Gmail"
  source=".agents/AGENTS/gmail-personal_AGENTS.md">
  ...full source file text...
</agent_instructions>
```

The agent should be instructed to edit the individual linked file, not the aggregate. Stable source identifiers are required, but it is acceptable to expose an environment ID if hiding it creates unnecessary routing complexity.

If the individual source file changes, the global source and aggregate file can be updated without restarting the server. The runtime may already have loaded the aggregate into its system prompt, so the file update and the runtime's current system instructions are separate concerns. It is acceptable for the changed instructions to affect a later reload/restart while the changed file remains immediately visible to the agent.

An unresolved question is whether environment capability guidance should remain in `AGENTS.md` or become a dedicated skill so it can be read dynamically without relying on prompt reinjection.

## New skills and instruction files

Existing skills and instruction files have known source mappings, so they can be linked when the agent workspace is built.

A newly created skill or instruction file has no inherent environment ownership. The server cannot reliably infer its destination from the file contents alone, and skill frontmatter should not be the authoritative routing mechanism because an agent can omit or change it.

The simplest automatic rule is:

- exactly one writable environment/bundle is active: assign the new content there;
- multiple writable targets are active: do not guess;
- no writable target is active: keep the content unassigned until it is resolved.

The unresolved design problem is how to select the destination when multiple writable environments are active. Options include:

- ask the user directly and remember the answer for the session;
- use a human-readable environment name in an authoring instruction;
- use the machine-readable environment ID in a preamble or metadata field;
- provide an authoring API/tool;
- use a server-managed hidden authoring context.

The user prefers avoiding small special-purpose tools, so the least intrusive option may be an agent/user prompt plus a server-managed session choice. This still needs to be designed.

When a new file appears in the agent workspace, a short debounce is acceptable. The watcher can wait for the file or skill directory to settle, determine its destination, move/materialize the source in the global workspace, and replace the workspace file or directory with a symlink.

A normal filesystem watcher cannot intercept the first write synchronously. Truly synchronous replacement would require controlled write tools or filesystem virtualization, which is not justified yet.

## Watching and persistence

The watcher should watch the shared global workspace rather than maintaining one independent watcher per agent workspace. It needs to:

- debounce and settle writes;
- handle atomic temporary-file writes;
- process additions, edits, renames, and deletions;
- avoid feedback loops caused by Rook materialization;
- validate paths and symlinks;
- serialize SQLite-backed changes as new revisions;
- leave project-backed changes in the project directory;
- reject or quarantine edits to immutable external files;
- retry dirty files when SQLite is unavailable;
- perform startup reconciliation because filesystem events are not perfectly reliable.

The runtime should continue using a dirty global file while persistence retries. A stronger synchronous guarantee is not required for the first implementation.

The shared file itself is visible to other sessions immediately through their links. Other runtimes do not need to be reloaded or restarted just because a shared personal capability changed. Runtime-specific caching may mean that file visibility and runtime behavior are not identical, which is acceptable for now.

Conflict detection, file locks, and team-scale concurrent editing are deferred. For now, a simple shared-file/last-write-wins model is acceptable because the user is the expected editor of personal capabilities.

## Permissions and safety

The current same-user permission model is acceptable for this phase. External files can be written directly into the agent workspace with read-only permissions, while writable files are linked to personal or project sources.

This is not a strong security sandbox. An agent with arbitrary same-user shell access may still bypass permissions. Stronger OS isolation is deferred.

The watcher must nevertheless reject or quarantine:

- symlinks that escape approved roots;
- unexpected temporary files;
- incomplete writes;
- agent-created links whose destination cannot be assigned safely.

## MCP and other capability families

MCP runtime lifecycle remains deferred. Before implementing it, the stored/reviewed representation may need to include results from operations such as:

```text
initialize
tools/list
resources/list
prompts/list
resources/templates/list
prompts/get
resources/read
```

The amount of resource content and the exact approval hash boundary still need a separate design pass.

## Historical items and resolved migration work

The following items from the initial brainstorm are now resolved or superseded:

- canonical and personal repository content is in SQLite;
- newly authored personal skills can persist through SQLite;
- the legacy directory repository and importer have been removed;
- session environment membership is persisted and restored;
- project directories remain direct-file sources rather than SQLite repositories.

The application database remains separate from the environment repository databases for now. Combining them or moving the application database under `~/.rook` is deferred.

## Implementation gates

Before coding the shared workspace, settle:

1. stable global workspace naming;
2. project bundle identity and whether project environments receive SQLite personal bundles;
3. agent workspace cwd and project-file availability;
4. individual AGENTS source-file mapping;
5. multiple-target new-file attribution;
6. watcher debounce, retry, and reconciliation behavior.

Then implement and test in this order:

1. global workspace materialization and mapping;
2. links for existing writable skills and project files;
3. read-only aggregate and linked individual instruction files;
4. watcher persistence for existing files;
5. new skill/instruction attribution and link replacement;
6. restart, crash, and multi-session tests.

## Next design pass: global workspace identity and ownership

The next thing to settle is the identity and ownership model for files in the global workspace. Without this, we cannot safely create links, watch changes, or know where a newly created file belongs.

The global workspace should not expose raw database rows or require the agent to understand repository internals. It needs stable internal paths and a server-owned mapping from each path to its source:

```text
source kind
repository
environment
bundle
artifact
revision or mutable source identity
```

A path-safe human-readable slug may make the workspace easier to inspect, but the mapping must remain correct if names collide, environments are renamed, or two environments provide an artifact with the same name. Project-backed entries also need to identify the project source without turning the project into SQLite content.

### Questions

1. Should the global workspace use readable paths such as:

   ```text
   <environment-slug>/<bundle-slug>/skills/<skill-name>/
   ```

   with a server-owned manifest for the authoritative identity, or should the path itself contain a generated opaque identity?

   A: Do the bundles and sequel have unique identifiers? Maybe we can just use those. . The file names in this directory don't have to be easily readable, but they just need to be easily traceable back to where they belong for debugging purposes. And they need to be consistent, as you said. 

2. Should personal mutable content keep one stable global path across revisions, while immutable external content uses revision-specific paths—or do we want external content excluded from the global workspace entirely as currently proposed?

   A: The immutable external content should be excluded from the global workspace entirely. The global workspace is only for the purpose of creating a shared concrete file that could be some linked into all the agent workspaces. an immutable file has no purpose there. 

3. For project-directory content, should the global workspace entry be a symlink to the actual project file, with the server manifest recording the project path, or should project files be represented another way?

   A: for the product directory content. content. I'm not immediately sure why we would want to sim link that content into the global workspace. Why not directly simlink from the project directory itself directly into the agent workspaces. 

4. Should project-directory bundles use a distinct bundle ID such as `project` or `directory` rather than `personal`?

   A: Yes, I already answered this. You don't have to ask questions more than once unless there is still ambiguity. It's very time consuming. 

5. When a `dir:` environment is registered, should the server stop automatically creating an empty SQLite personal bundle for it, since newly authored capabilities for that environment belong in the project directory?

   A: Yes, we shouldn't create server bundles for directory environments. 

6. If two active environments expose the same skill name, should materialization reject the collision as it does today, or should the global workspace and agent links namespace the skills by environment/bundle?

   A: I guess we should namespace the skills. But I don't know what a good naming convention is for namespacing them. I'm not totally against just using the bundle ID As a prefix to the actual skill name 

## Next design pass: capability ownership metadata and naming

The AGENTS case has a clear ownership path: the aggregate names a specific source file, and the agent edits that linked source file. A newly created skill is harder because a file under `.agent/skills/` does not inherently say which environment or bundle owns it.

The central problem is:

```text
agent creates .agent/skills/my-new-skill/SKILL.md
                                      ↓
                         which environment/bundle owns it?
```

The watcher cannot safely infer ownership from the skill name alone. Human-readable environment names can collide, and the same skill name may be useful in multiple environments.

### Naming and identity inventory

These are the unusual naming cases that need one coherent policy:

1. **Environment IDs** have different forms: `web:...`, `mac:...`, `location:...`, and `dir:/absolute/path`.
2. **Bundle IDs** are only unique within a repository and environment. The effective database identity is the repository/environment/bundle combination, not the bundle ID alone. Q: should bundle ids be unique in the database ... we should probably have a unique primary key
3. **Project-directory bundles** are not SQLite bundles and need a distinct identity such as `project` or `directory`. They should not use `personal`. A: go with `directory`
4. **Skill IDs** are currently flat names. Two active bundles can provide the same skill ID. A: Think we should handle this naively for now, first skill of a particular name is materialized/linked in the agent workspace directory with it's normal name. The next time we encounter a skill with the same name, then for the name of the folder containing it we put an underscore two but we don't modify anything about that skill. This does make the preamble yamble in the SKILL.md inconsistent (b/c the name will be different than the folder name) - but I don't care for now.
5. **Generated skills** use derived IDs such as `fact-<name>` and `llms-<name>`. Q: What does this mean? I have no idea what you're talking about here. It sounds important and I have no clue. 
6. **MCP, app, and fact artifacts** have their own artifact IDs and can collide in the same way. A: We're going to be similarly naive here. Also, we don't know too much about the behavior of apps and fax yet. I mean, facts is really going to be information that you stick in AGENTS.md So we shouldn't talk about it as its own entity 
7. **AGENTS source files** need stable, path-safe names even when their source environment or bundle has an unsafe or very long identifier.
8. **New skills and new instruction files** initially have no repository, environment, bundle, or source mapping.
9. **Project files** may be shared across machines, so embedding a local absolute `dir:` path into a committed skill may be undesirable. A: Let's not worry about this right now. 

The global workspace and agent workspace do not necessarily need to expose the same name. A server-owned mapping can use a stable internal source key while the agent sees a readable skill name whenever there is no collision.

### Candidate ownership approaches

#### 1. Rook metadata in the skill preamble

A newly created skill could be required to include a Rook-owned YAML block:

```yaml
---
name: my-new-skill
description: ...
rook:
  environment_id: web:xkcd.com
  repository_id: personal  NOTE: Repository ID and bundle ID are not necessary because if it's an environment ID that uniquely specifies where it goes. It will always be either personal or directory depending if it was found in a directory environment versus any other environment. and it will be associated with the environment of that environment ID. repository is always also personal so that we just don't need these two. 
  bundle_id: personal
---
```

The watcher would validate this metadata before moving the skill into the global workspace and replacing the agent-workspace directory with a symlink. If the block is missing or invalid, the skill would remain unassigned and the agent could be alerted. N: I like this. 

This is attractive because the ownership travels with the skill. The risks are that the agent may omit, edit, or copy the metadata, and a project skill containing a local absolute `dir:` environment ID may not be portable. N: The directory environments will always have an absolute local path. We don't care if they're portable. They are supposed to reside on this machine. 

A possible rule is that the metadata is required only for new unassigned skills. Once the server has created the source mapping and symlink, the mapping—not editable frontmatter—becomes authoritative. N: This is absolutely right. 

#### 2. A source-key naming convention
N: I've decided I hate this idea. We're definitely not going to do it. 

The system could prefix new skills with a source key, for example:

```text
<source-key>__my-new-skill
```

The source key could be derived from the repository/environment/bundle identity. This is unambiguous, but it makes agent-visible skill names ugly and may alter how runtimes display or select skills.

A compromise would preserve the readable name when it is unique and add the source prefix only when two active skills collide.

#### 3. An authoring directory or creation slot
N: I find this idea to be attractive in several ways. It does get rid of the metadata, which is kind of nice, although I'm not as worried about that as you seem to be but also we can make I think we can make it tell me if I'm wrong, but I think we can make it so that the .agent/skills directory is not writable in that you can't create new files but the the individual skills within that file would be completely writable. I think we can do that right? And then we could also set up directories such as .agent/new-skills/<environment_nickname> for each of the environments that IS writable. This would guide the agent to place the the skill in the appropriate location. For instance the agent could make a skill like .agent/new-skills/Gmail/summarizing_emails (in the web:mail.google.com environment).The only thing weird is what to do when we symlink the skill to where it's supposed to be. Maybe just symlink the dir to both .agent/new-skills/Gmail/summarizing_emails and .agent/skills/summarizing_emails. This approach also means that we don't have to notify the agent when they've screwed up because the agent can't create a new skill Unless they go through this route They'll just be blocked and that's probably better because we can put instructions into their preamble of their system message or whatever that explains how to do this appropriately. And I think they'll follow the instructions. 

The workspace could expose source-specific authoring locations such as:

```text
.agent/authoring/<source-key>/skills/
```

The agent would create new skills there, and the watcher would know their destination from the directory. This avoids metadata in `SKILL.md`, but it requires the agent to understand a nonstandard authoring path.

#### 4. Server-managed authoring context

The server could record the current writable environment/bundle for the session. With exactly one writable target, creation is automatic. With multiple targets, the server could ask the user which target applies and remember that choice for the session or until the next environment change.

This keeps ownership out of the skill content, but it requires a way for the agent or user to trigger destination selection. A dedicated tool is possible, but the goal is to avoid adding a small special-purpose tool unless it becomes necessary.

N: I'm not terribly in love with this either because it's weird for the agent to automatically create AGNETS.md We're appropriate but not SKILL.md.


### Current likely direction

The most promising combination appears to be:

- use a server-owned composite source key internally;
- namespace only when skill IDs collide;
- require a Rook metadata block for a new unassigned skill when ownership cannot be inferred;
- default automatically when exactly one writable target exists; N: Since it's off in the case that there will be multiple environments, then I don't want to have a default for when there's exactly one writable target. I want the way that we deal with skills and AGENTS.md to always be the same. 
- keep a new skill unassigned when multiple writable targets exist; N: Now this is the point if the agent writes a skill then under this concept he would have to write it with metadata. This... it should be assigned. So I guess if he doesn't write it with metadata pointing to the environment, then it can't be assigned. That makes sense. But I think I might be going for the other idea anyways - #3
- use a user-facing alert or message when required metadata is missing;
- make the established source mapping authoritative after linking.

The project-directory case still needs a portable identity strategy. A local `dir:/absolute/path` environment ID is unambiguous on the current machine but may be inappropriate inside a shared project file.

### John UPDATE
We've decided to go with option 3 from above.