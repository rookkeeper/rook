(FYI - some of John's answers and notes are text-to-speech generated and might have artifacts from that, so anticipate that and attempt to infer the actual meaning. Ask for clarification if you need to.)
# Environment repository: current-state notes

## Product intent

The product docs still describe the environment repository as a fairly broad catalog of **environment-linked capability content**:

- environments have URL-like ids (`location:...`, `web:...`, `mac:...`, `dir:...`)
- repositories can be canonical, local/personal, community, or external
- content attached to an environment is broader than skills
- the long-term idea is searchable environment/capability storage, not just a skill folder tree

The docs also already point toward things beyond plain skills:

- skills
- MCP servers
- app instructions / metadata
- AGENTS.md
- other environment-bound artifacts later

That lines up with your planned shift toward a more flexible storage model.

## What the implementation actually is today

### Core repo API is tiny

At the abstraction layer, the repo API is basically just:

- `EnvironmentRepository.getBundles(environmentId)`

So the external read API is already small and swappable.

### Current storage is mostly directory-backed

The real implementation today is:

- `DirectoryEnvironmentRepository`
- `CompositeEnvironmentRepository`
- `LocationContextRepository` (synthetic/in-memory shim)

`CompositeEnvironmentRepository` just unions multiple repos.

`DirectoryEnvironmentRepository` maps:

- `web:example.com` -> `environment-repository/web/example.com/`
- then reads `./.bundles/<bundle-id>/...`

Within each bundle it only recognizes:

- `skills/`
- `mcp-servers/`
- `apps/`
- `AGENTS.md` at bundle root

It explicitly ignores `.manifest`, but does not really use manifests yet. So the product doc talks about manifests, but the code mostly does not care.

### "Bundles" are the real storage unit today

Despite the product language around environments, the effective unit of review/approval is the **bundle**.

A bundle currently has:

- `bundleId`
- `environmentId`
- `repository`
- `bundlePath`
- `skills[]`
- `mcpServers[]`
- `apps[]`
- optional `agentsMd`
- `valid/errors`

So the implementation is still very bundle-centric, and still strongly shaped by filesystem grouping.

## What gets used downstream

### EnvironmentRepositoryService adds the important behavior

This layer is where the repo starts mattering operationally:

- `getResolvedBundles(environmentId)` filters valid bundles and computes `bundleHash`
- `getEnvironmentPreview(environmentId)` returns preview payloads used by clients
- `getBundleCollectionPaths(environmentId)` is used to ask "is this environment known?"

### Bundle hashing today

Persistent decisions are keyed by `bundleHash`.

Today the hash is:

- SHA-256
- over the whole bundle directory tree when `bundlePath` exists
- basically a Merkle-ish hash of every file path + file content

That means decisions are currently tied to the **entire reviewed filesystem payload**, not just skill text.

This is good for the current approval model, but it means if the storage model or what counts as bundle content changes, decision behavior changes too.

## Environment decisions today

There are really two layers:

- permanent: `approve` / `reject`
- ephemeral: `accept` / `ignore`

### Permanent decisions

Stored in SQLite table `environment_decisions`:

- `bundle_hash` PK
- `environment_id`
- `bundle_id`
- `decision` (`approve` or `reject`)
- `updated_at`

Important reminder:

- persistence key is **only the hash**
- `environment_id` and `bundle_id` are basically audit/context columns

So if the hashed content changes, the durable decision stops applying.

### Ephemeral decisions

These live in `SessionDecisionRegistry` in memory.

A subtlety: they are not globally app-wide in storage; they are tracked per session, though the manager may fan a decision out to all currently entered sessions for that environment when no session id is provided.

## How environments become available

`EnvironmentManager` is the coordinator.

Important current behavior:

- candidate env registration is **literal**
- observed paths / observed URLs are used only to discover additional known repo-backed env ids
- those implied envs are only added if the repository already has bundles for them
- entering is also literal; parent envs are not implicitly entered

So today the repo is used for two distinct purposes:

1. content lookup
2. existence/known-environment detection

That second role matters for a SQL migration too.

## What actually gets injected into a session

This is a very important current constraint:

- only **skill paths** are turned into runtime-loaded capabilities
- `AGENTS.md` is injected into the runtime instructions/system prompt
- MCP servers and apps are previewed and approved, but they are not really first-class runtime-loaded things yet in the same way skills are

So the current runtime path is still heavily optimized around filesystem-backed skills.

That means a future SQL-backed repository probably needs to answer at least one of these questions:

- do we still materialize reviewed skills to disk?
- or do we create a richer runtime capability abstraction that is not "path to a skill dir"?

Right now `EnvironmentManager.skillPathsForEntry()` literally builds paths like:

- `<bundlePath>/skills/<skillId>`

That is one of the biggest hidden filesystem couplings.

## Personal/local authoring today

When an environment is entered, Rook auto-creates a local writable personal bundle under:

- `~/.rook/environment-repository/<kind>/<path>/.bundles/personal/`

And prompt injection tells the agent it can write:

- skills
- AGENTS.md
- MCP servers

So user-local authoring is also currently bundle-shaped and filesystem-shaped.

## Synthetic/special cases already exist

The repo abstraction is already being stretched a little:

- `LocationContextRepository` synthesizes a bundle programmatically
- location context skill content is written/generated and then served through the repo facade

That is a good sign for a future non-directory backend: the system already tolerates repo implementations that are not just "read a folder from disk".

## Mismatch / friction points I noticed

### 1. Product is broader than implementation

Product language suggests:

- repository metadata
- searchability
- multiple repo types
- flexible environment-bound artifacts

Implementation is still mostly:

- scan a directory tree
- produce bundle previews
- load skill dirs by filesystem path

### 2. Bundle model is carrying too much conceptual weight

Today a bundle is simultaneously:

- review unit
- hash unit
- persistence grouping
- filesystem directory
- runtime load source
- local authoring container

That is probably why it feels too heavy/confusing.

### 3. The stored artifact types are still hard-coded

Recognized groups are literally hard-coded to:

- `skills`
- `mcp-servers`
- `apps`

`AGENTS.md` is another one-off special case.

So if you want to store things like:

- community-contributed capabilities
- remote assets
- `llms.txt`
- richer metadata blobs
- references to online MCP servers or online skill packs

...the current model will fight you pretty quickly.

### 4. Environment manifests are mostly aspirational right now

The docs mention `.manifest`, but the repo reader mostly skips them. The meaningful environment metadata in practice is currently coming from runtime registration metadata, not repository manifests.

## What seems likely to matter for your redesign

If you keep the current high-level API shape, the main design questions seem like:

1. **What replaces bundles as the primary persistence/review unit?**
   - maybe "artifacts attached to an environment"
   - maybe "content sets" or some lighter review unit

2. **What exactly should be hashed for decisions?**
   - the whole reviewed content set?
   - normalized artifact payloads?
   - only executable/agent-visible content?
   - include metadata / provenance / remote URLs / fetched snapshots?

3. **What is the runtime load contract?**
   - today it is `skillPaths[]`
   - that is likely too narrow if the repo becomes SQL-native and stores more than filesystem skills

4. **How should remote/community assets be represented?**
   - first-class stored artifact rows
   - references to external sources
   - fetched snapshots plus provenance
   - reviewable metadata distinct from executable content

5. **How do permanent decisions survive content-model changes?**
   - today they are beautiful in one sense: "same hash, same decision"
   - but they are brittle if the reviewed object or canonicalization rules change

## Short bottom line

Today the environment repository is conceptually broad in PRODUCT, but operationally it is still a **filesystem-scanned bundle catalog whose main useful outputs are bundle previews, bundle hashes, and skill directory paths**.

The most important couplings to keep in mind for a storage-layer rewrite are:

- durable decisions are keyed by `bundleHash`
- known-environment detection depends on repo lookup
- runtime capability loading still depends on filesystem `skillPaths`
- local authoring still depends on a writable personal bundle directory
- recognized artifact types are hard-coded and narrow

---

## Notes from John
- I'm thinking about putting all of the implementations into a database so that it's easier to query them by whatever means.
- One challenge with this is that the agent needs to be able to write to some of the skills, so we have to set up the agent to start in it's own temp directory, populate the directory with skills, when skills are modified then write back to the actual location on desk.
- ALSO, some skills are not writable, so we have to make sure that these can't be written to.
- I want to be smarter with how I deal with MCPs
- We need to get rid of the bundle grouping because it introduces an extra layer of abstraction ... but maybe this only applies to when eveerything was in the file structure and it required a strange new level of abstraction... but what's good?

I don't know... maybe bundle is a good abstraction :/ What is a bundle - it's a list of related functionality. Maybe it's only a skill. Or maybe it's several skills associated with one another. Or a skill and an app. Or a skill and an MCP. Or just an MCP.

How about a table for every base capability thing (skill, MCP, AGENTS.md, app, something new in the future). And then a table for bundles which should be reviewed at once, and a JOIN table to connect the bundle with all its capabilities.

What to do with llms.txt?

If a user writes capabilities, then they don't need to be approved. The user written capabilities don't have to be bundled (they are written to their default bundle), but they can be bundled and named which will make them easier to manage and publish and delete.

If the bundle is from a 3rd party, then they must be approved.

## I'll try to write it as a process:

### Read public capability bundle
If the bundle of capability is from the public, then it's not necessarily to be trusted quite yet. So we have to make sure that we allow the user to see everything that's in the bundle. the skills, mcp server, whatever that means, and whatever they've laid eyes on and approved, and those text files get hashed and that becomes part of the approval. And if that text changes, then we have to make sure we re-approve. 

- user enters environment that has capabilities. The capabilities could be from their personal capabilities that they have attached to this environment, which never need to be reviewed. Surely they trust themselves. bundles, but it could also come from third party bundles. And so for every bundle it's going to be where it came from like the publisher. where it is stored like which environmental repository which currently is only two their personal one or the canonical Rook one, but eventually could be other repositories I guess. the hash of the bundled content that all the skills and stuff that we're making the user approve which of course if it's your personal love they won't have that or need that. environment decision maybe that goes in this table I have to move it from its current table but like have and it's not really an environment decision anymore It's like a bundle decision, but it's like has the user approved for this stuff. It will also need to have the approval date. And maybe the time to revalidate that the bundle is still what we think it is, because the publisher might have updated it. Let's stick a bundle version in there too. 
- If it's not yet time to recheck and revalidate the content, then we just look at the environment decision. Sorry, the bundle decision. The bundled decision can be always approve or always reject. that he stored in the database.
- If the bundle decision is approved, that tire bundle gets injected into the agent. It's still an open question as to what a bundle can have in it. and how to inject that into an agent. But basically, we're going to shut down the agent, add its skill to its skill directory, and add the MCP servers, add all that stuff so that when it wakes back up it has them there and that's of course going to rewrite its prompt. I think the way this works This will work is we take the agent and stick them into a temp directory or maybe it's not even temp directory. It could be a persistent directory, but it's not something that users should typically lay eyes on. And the temp directory, or this agent directory, we'll call it that, to be generic, it's going to have all the agentic capabilities these in the normal place like AGENTS.md and .agent/skills (I still don't know exactly what to do with the MCP servers). If the skills are the user's created skills then they're gonna be in writable directories. if they are skills that were bundled with some external producers and it doesn't make sense to rewrite them so they'll be in read-only directories.  
- If it is time to check on the capabilities and refresh them or maybe we just this is the first time we've seen it then we have to go back to the source, which could be an environmental repository, or it could be directly attached to a website. If all of the capabilities have the same hash and the same version number, then we don't have to bother the user again for them. Because whatever the user's decision was still stands. Their bundled decision. If there is no decision, Then we pull down the data about the bundles, present a bundle request, what we used to call an environment request to the user if they approve this time only then we're not gonna save anything if they approve forever whatever we call that. Then we're going to actually pull all the content that we've just had had them review into a local cash of the environment repository so that we don't have to look up all this information every time we need it. If they reject for forever then we create an entry for that, but we don't bother pulling down all the data, all of the skills and capabilities because it doesn't matter anyways. 



## Outstanding questions and comments:
- What's the new environment repository API? Sometimes we will need search-like behavior. Sometimes we will need get-like behavior or fetch. 
- We need to enumerate all the different types of capability artifacts such as skills, llms.txt, AGENTS.md, MCP servers, apps etc. and describe how they will be treated individually and make sure they all work with this mindset.
- we can probably reduce the number of re-environment repository types, especially if everything is just supported in a database going forward. 
- AGENTS.md shuoldn't feel liek a special case
- What will the manifest have in it?

---

## Remaining questions to work through

### Bundle semantics

1. Is a bundle primarily a publication unit, a review unit, a runtime loading unit, or some combination? A: I think it's a combination of all of these things because it's the same capabilities in each one. Is there any reason that I shouldn't do that? I think it's a good idea so far. 
2. Can one capability belong to multiple bundles without being copied? A: One capability cannot belong to multiple bundles without being copied.
3. Should bundles be immutable versioned snapshots, or mutable named collections? A: This is a tricky question. Some bundles are going to be behaviors that the user is building themselves in a and those should be completely editable, modifiable in any way you can imagine. but if a capability bundle came from an environment repository or online or something then it needs to be immutable. The user is not going to be able to change it for the time being. 
4. Does a bundle need a stable identity separate from each version's content hash? A: We should probably talk about this, but I was thinking that the primary key for a bundle is effectively the environment ID, the version number. The name of the environmental repository (need to talk about), the publisher's name (need to talk about), and the md5 hash of the content (which content should still be discussed on a per-capability type basis). Somehow this feels like overkill to me though, so maybe you can help me brainstorm. For example, the MD5 hash and the version number feel overlapped (But that might be okay.). And one thing I'm not sure about is the notion of a bundle name. I think most of the time the publishers will just publish all the skills and everything thing is just one chunk, one bundle. But some publishers might want to name them and some others won't. So do we have a default? The bundle name should be part of the identity of the bundle. 
5. If a user creates a named bundle, which management operations matter: rename, clone, update, publish, archive, delete? A: rename, update, delete are the important ones for now
6. Can a capability be attached directly to an environment without belonging to a bundle? A: No, but for user generated capabilities, they'll automatically have a default bundle that I I think we're calling "personal" right now.

### Capability model

7. What are the complete first-class capability types: skills, MCP servers, AGENTS/instructions, apps, `llms.txt`, references, scripts, prompts, and future types? A: skills (references and scripts are part of this - look up "agent skills" online if you have not heard of that concept - it is important to understand), MCP servers, AGENTS/instructions, `llms.txt`, random facts (such as websites to refer to for information) – Let's not worry about prompts for now.
8. What fields should every capability share: identity, name, description, type, publisher, source, version, content hash, metadata, and permissions? A: We need to keep track of the content of the capability itself. So if it's a skill, we need to know all the files and their content and their nested structure. if it's an MCP server. And that's actually a good question that we should talk about like will we even know when the server has changed. I don't know. For llms.txt it will be the full content of that file.
9. Which capability types are executable, prompt content, reference-only, or merely discovery metadata? A: skills will have executable scripts sometimes and will often ask the agent to run shell commands. MCP servers are just bunches of tools that issue remote API requests. AGENTS.md will just be added to the context. We need to brainstorm in more detail about these to make sure we've got all of our bases covered. 
10. Should each capability type have its own content model, or should all content be represented as files/blobs plus metadata? A: It would be nice to represent all the skills using the same exact format (e.g. blobs plus metadata), but we need to make sure that that's possible. 
11. What does “user-written” mean after a capability is imported, published, or shared? A: If a user has written some capabilities, then once they're imported, then they will be writable by that user user. I'm not going to worry about publishing or sharing user-written capabilities quite yet. If the capability is pulled in from an external environment repository, then it is considered immutable for the time being. 

### Sources, versions, and caching

12. What are the supported sources: personal content, canonical Rook content, community repositories, Git, HTTP URLs, direct website assets, and generated content? A: for the time being, Rook can interface with anything that adheres to the EnvironmentRepository class API or maybe more strictly it _is_ an EnvironmentRepository subclass. Beyond that, it doesn't matter what's behind the environmental repository. Eventually it could be Git or another service that's addressable by an HTTP API or whatever. Currently. it will be talking to SQLite databases - one in ~/.rook/environment_repository.db that houses the user's created and cached bundles, and one in environment_repository.db in the rook repo (it will be a different file than the application database though) 
13. What is the distinction between a source, repository, publisher, and cached local copy? A: The original source of a bundle of capabilities is "Whoever wrote it?" which might sometimes be the community, it might sometimes be the owner of a website, It could be individual contributors and I don't have a good way of officially signing their name so I don't know we're gonna fake that one for a little bit probably. The repository is the place that stores it, and there will be a canonical Rook repository like the official one with everything that's approved. But there could also be other repositories as well, just other people that have started collecting environments. And really the official repository and the user's local repository, those are two different types of repositories, two different repositories. not they'll be kind of the same type but Publisher and source, maybe I'm conflating. I'm not sure what the distinction you need there. They're the same thing as far as I'm concerned. The cached local copy is going to be a repository, it's just the first place we look. It will house the users created capabilities but also stuff from offline that they've cashed locally and I guess it'll house the decisions of whether or not we want to permanently approve this or permanently reject it. Also, I said something different earlier, but if the user doesn't decide to permanently accept something that maybe we still want to cash the content so we don't have to look get up again. I don't know.  
14. Is a version publisher-supplied, inferred from a commit or URL, or generated from content? A: Publisher supplied. 
15. Do we cache untrusted content for preview before approval, or only after approval? A: I think maybe let's cash it before approval
16. How do we detect remote changes without downloading all executable content every time? A: I don't know how you detect remote changes without actually downloading the content. The content hashed is what determines whether there is a change. So we must always download the content in order to determine if it's been changed. Different hash means different content. 
17. What happens when a source disappears, becomes unreachable, or returns content different from its advertised version? A: If a source disappears or becomes unreachable, the user is still free to use their cached content. And for now, we won't worry about notifying the user, maybe in the future. If the content provider offers different content for the same version, then that is a violation. and at some point in the future we should reprimand them for that. But for now, oh well. 
18. Should approval apply to an exact content snapshot, a publisher/version, or a bundle identity whose content may change? A: See above where we talked about the full identification of a bundle. That includes the publisher, the environment, maybe the bundle name. and we need to re-approve if anything has changed. So if the hash is different for that specific bundle, we need to re-approve. Approval applies to a bundle, Not an individual capability Not a complete environment. not everything associated with a publisher.

### Decisions and trust

19. Should the decision table be renamed from environment decisions to bundle or capability decisions? A: Either "bundle decision" OR maybe just "bundle" and keep the decision in that table.
20. Is approval scoped to a bundle version, or can users approve individual capabilities inside a bundle? A: Approval is scoped to bundles, not individual capabilities. And like you said it should be a bundle version which should correspond to the hash for that bundle as well. 
21. Do MCP servers need a stronger or different approval flow than Markdown skills and instructions? A: MCP servers should fall into the same approval flow. But I'm not sure how transparent they are in terms of the tools they provide. Maybe that's something we should talk about like can we instantiate the MCP server and and get a listing of its tools, etc. etc. and cache that text?
22. Exactly what participates in the approval hash: bytes, filenames, metadata, source URL, publisher identity, configuration, and manifest? A: This differs from types for For skills, then the skill directory downward, every piece of content is going to be hashed. And I guess we use something like a Merkle Tree style hash for llms.txt then the full text of llms.txt needs to be hashed. For MCP servers, the text from turning on the server and asking it for it's contents should be cached (help me think through that). For arbitrary random data, then anything that will be injected into the agent context should be cached. And that's generally a good rule of thumb. whatever is going to be injected into the agent runtime's context should require approval. 
23. Should changing descriptive metadata require reapproval, or only changing agent-visible or executable content? A: Again, anything that is injected into the context. That's the type of stuff that needs to be approved. other metadata that doesn't go into the context does not need to be approved. This probably indicates something about how the manifest files for each bundle should be organized. Maybe there's a section for what's directly injected into the agent in another section for other stuff. 
24. Should the hash include a schema/canonicalization version so future hashing changes are explicit? A: Let's not worry about this for now. worst case scenario we have to re-approve all the bundles that we've already approved but that's not a big deal yet. 
25. What happens to existing decisions when the bundle model or hash algorithm changes? A: see above
26. Do user-authored capabilities bypass approval forever, or only while their provenance remains personal? A: User-author capabilities will bypass approval forever because their proven knots will remain personal There's currently no way for a user to publish their capabilities, so we just don't have to worry about this right now. 
27. What is the lifetime and scope of “approve once” versus “always approve” across sessions, visits, and environments? A: This is one thing that we'll keep as it currently is in code right now  – approve once and ignore apply to the current session only. always approve and reject forever apply to all future sessions until that decision is updated by the user. (Please take a look at our naming scheme for these decisions. I'm not sure what we use. )

### Runtime materialization and mutability

28. What is the agent-directory contract for each runtime, and which capabilities must be materialized to disk? A: I'm thinking there will be an `.agent/skills` directory with all of the skills, AGENTS.md for the direct instructions, and we should check online to see if there is a good pattern for MCP servers and do that. NOTE that the contents for these won't always be a 1-1 mapping with the capabilities associated with the environments that are in this session. If the active capability bundles have skills, then those skills will be dumped into .agent/skills directly, but for llms.txt we'll probably wrap them in pseudo skill of some sort. the AGENTS.md file will be the concatenation of all AGENTS.md files associated with active bundles. Maybe just-in-time MCP servers will be materialized as local services too. -- UPDATE One challenge with what I just said there is that the agent will need to rewrite some of these files so if we dump all of the instructions for individual bundles into AGENTS.md, and the agent attempts to edit that file, then how do we take the agent's changes back into the original AGENTS.md associated with that bundle?
29. Which things can be passed through runtime configuration instead of becoming files? A: Everything that the agent needs to know about will be represented in the files we inject to the agent's runtime directory. For example, if the bundle manifest points to a canonical website, that will need to be injected into the AGENTS.md so the agent can be aware of it.
30. How do we make externally sourced capabilities read-only in a way the agent cannot circumvent? A: This is a good question. I was thinking about creating a special Rook user and then giving them full access to some files and only read access to others - but I don't know if that's a good idea.
31. How do we expose writable user capabilities while keeping the database as the source of truth? A: When a file is written to, we need to have a file watcher and upon write we go back and modify the source of truth. This feels very complicated. I wish there was an easier solution. 
32. When the agent edits a writable skill, when and how is the change detected, validated, versioned, and written back? A: Same as last question, but we probably need to discuss it if it's complicated. It seems like it is. 
33. What happens if the agent edits a capability while its upstream source has changed? A: This could happen. Imagine a user has two sessions running, both incorporating the same user defined bundle. If the user edits the capabilities from one session, then they won't be visible in the other session without extra work and I don't know if we want to do something complex. So maybe we just let it go. But if in that other session the user also updates the same capabilities, then maybe we We reject the right. This gets complicated. Maybe we would want to make that file no longer editable for that agent in the second session. But this is tricky. 
34. Are generated runtime files part of the content hash, or only the canonical stored content? A: The generated runtime files are generated from the content in each bundle. bundle. And so we only need to hash the content that's originally in each bundle.  
35. Do we need separate materialized directories per session, runtime, or capability version? A: Each session has a working directory. One per session. 

### MCP servers and `llms.txt`

36. Is an MCP record just configuration, or does it include server code, credentials, installation instructions, and permitted tools? A: repeating the above but we need to talk about it and figure out how to query the MCP server to figure out what is going to be injected into the agent at runtime. time and that's what we're going to hash. 
37. How are MCP servers started, isolated, stopped, and permissioned for a session? A: I will need your guidance here. I think the permissions should work across all sessions. It's kind of like using cursor. Once you've all sent in to the MCP server, it didn't matter how many sessions you have, you're still authed in in each session.
38. Is `llms.txt` a capability artifact, environment metadata, a discovery pointer, or a source document? A: We will pull in the text from that file, cache it locally, and use that for the hash content. 
39. Should `llms.txt` be stored as fetched content, a URL reference, or both with provenance? A: We will pull in the text from that file, cache it locally, and use that for the hash content. 
40. When should `llms.txt` be exposed to the agent: always, on demand, or only as searchable reference material? A: Repeating my answer from above. We'll just wrap it in a skill so that the contents of the skill has all of llms.txt. But if you know of any other way that's better than tell me, maybe there's some better way of doing this. 
41. Do online assets need a distinction between a trusted snapshot and a live/followed URL? A: No. Now, a live URL is the place to get the asset, I think. 

### Repository API and schema

42. What operations are needed beyond `getBundles`: search, list environments, fetch metadata, fetch content, resolve versions, refresh sources, and materialize content? A: We'll have to shape this into a more mature API and I want to see the API signatures we come up with. This is very important to me. But here's the types of behavior that we'll want. We will want to list all environments. search for environments, search for bundles based on its environment, its publisher, its environmental repository or maybe even based on text associated with it. We will want to fetch the content for a bundle and really there's a couple ways that we We want to do this. One is we want to fetch the content for a bundle that we are going to present to the user in order to make their bundle decision of approving it or rejecting it etc. but also we need to fetch the content for a bundle or really fetch the content for a set of bundles when we're about to inject that content into to a working directory for a session, an agents directory. 
43. Should search return environments, capabilities, bundles, publishers, or separate result types? A: We should have a search for environments and a search for bundles. And those two searches should be different API endpoints. Maybe later we can also introduce searches for capabilities or publishers, but not yet.
44. Which operations are read-only repository queries versus synchronization, caching, or materialization operations? A: I don't quite know what you mean. 
45. Do we want one logical repository over personal, canonical, community, and remote sources, or explicit source-specific APIs? Yes, there will be one logical repository. But you'll be able to search. based on which environment repository the information is coming from so you can and like look for just personal bundles. and when fetching will fetch the cached version first unless it's time to revalidated and at that point we'll look at the upstream environment repository or the website or wherever we originally got the data from. 
46. What are the core database entities and relationships: environments, capabilities, versions, bundles, bundle members, sources, publishers, and decisions? A: We need to flesh this out. but there is going to be... Maybe we call it the bundles database, although I've been calling it environmental repository database so I don't know but there will be a table for bundles there will be a table for capabilities. There will be a join table so that you know which capabilities are associated with which bundle. I I think the bundle table can hold the metadata associated with all the capabilities but also maybe that should hold the decisions well. I think that the capabilities table should hold the content that's being hashed and it's going to be polymorphic so that we can store the content of a skill and also store the content of of MCP server stuff and also store llms.txt, and we can store arbitrary data, and we can store AGENTS.md.
47. Should environment associations be versioned and auditable? A: I don't know what you mean here. 
48. What compatibility projection, if any, should preserve the current `EnvironmentBundle` API during migration? A: I don't know what you mean here. 

### Manifests and publishing

49. What problem does a manifest solve: discovery, validation, display metadata, provenance, dependency declaration, or all of these? A: We're still trying to flesh out what goes in the manifest, but so far there's three things. 1) There is a short human readable description about what this bundle is named and what it does. We can use agent skills headers as a good pattern here. 2) Optionally, there is text that gets dumped into the agent instructions... but maybe we just use AGENTS.md for that instead. 3) Sometimes the contents of this bundle is really just a pointer to where this bundle is defined in a project. For example, imagine a coding project that already has its own .agents/skills AGENTS.md CLAUDE.md .mcp servers etc. ... In the future there will be other things to stick here. I like the idea of sticking metadata here associated with discovery. I like the idea of sticking metadata here for display. I don't think we'll need dependency declaration because the idea of a bundle is everything in it is associated with everything else in it. That's why it's accepted or ejected as a whole. 
50. Is the manifest publisher-authored, repository-generated, or both? A: The manifest is publisher authored. maybe eventually we stick repository authored contents in there as well such as like information about the review process that it went through or something. 
51. Should manifests declare capabilities and versions, or only describe a bundle/package? A: The manifest should include the version. There is no need for the manifest to declare capabilities because the actual capabilities associated with that bundle declare themselves. 
52. Do we need dependencies between capabilities, such as a skill requiring an MCP server or another skill?
53. How do we validate a published bundle before making it discoverable? A: We won't worry about that for now, but in the future we'll have an internal validation process to make sure that the bundles aren't doing prompt injection stuff. 
54. What does publishing mean for a personal capability: copying it, changing its provenance, freezing a version, or making it publicly searchable? A: There's no notion of publishing for user-created capabilities. We'll consider that in the future. 

---

## More notes from John
- depending on the type of capability the way it gets injected into the agent session is going to be different. Some are like new instructions (AGENTS.md), Summer skills. skills. Some things are going to be turned into pseudo skills. For example, I imagine we'll take a llms.txt and wrap a skill around them so that we don't polute the context by just dumping in the entire llms.txt. MCPs will also be different.
- We also need to talk about the instructions that should be injected into the prompt to guide the agent from editing existing skills.
- We haven't talked about how to get information out of the data store and into the agent runtime. and also if the agent starts editing those files that are associated with capability we need to get that information back into the database. Keep in mind all of this needs to follow the layered approach of API>Service>Repository>Datastore.
- We already have an application database. the environment repository database inside the Rook repo will be a separate database because eventually we'll probably move it to its own repo and the users personal repo in ~/.rook/environment_repository.db will be a third thing ... though maybe it should be the same thing as the application database. Let's talk.
- One of the challenges of this project we're getting into right now is it's huge. There's a lot of decisions to make. So, let's figure out how to stage it so that we can do it in chunks. and make sure we do the most important stuff first. and clearly detail what we're going to delay for future work. Actually, it might be a good idea to go ahead and break up this into chunks, because that I'm already feeling a little bit overwhelmed with the size of this. It might be good to figure out what we can do first. 
- We need to make sure we clarify the data layout in the table. 
- We haven't really talked about the user experience, user interface changes that are implied by some of the work that we're doing. Hopefully not much right now, but like re-approval or changing the bundle decisions would require some updates to the UI. 
- Oh, here's a big one that we haven't talked about yet is sometimes the The environment is a directory and that directory might, for example, might correspond to a coding project which has it's own .agents/skills AGENTS.md CLAUDE.md .mcp servers etc. In the data we store in the user's environment repository we just need to point to those items and use them when we interact with an agent. If the agent needs to update those skills and AGENTS.md then it needs to directly modify those files - maybe we make this work by symlinking those items to the agent's working directory?
- Whenever starting up an agent's runtime or restarting it later, if the agent is associated with bundles then we need to re-inject all the files into the working dir rather than depending upon what is currently there.
- When creating the AGENTS.md file for the working directory, I want to show where the injected text came from using readable pseudo-markdown structure rather than exposing machine-oriented identifiers:

  ```markdown
  # Rook environment context

  <environment name="Gmail">

    <context>
      <website>https://mail.google.com</website>
      <description>Gmail in the user's web browser.</description>
    </context>

    <bundle name="Gmail workflows">

      <instructions>
        Use Gmail's search syntax when locating messages.
        Confirm before sending or deleting email.
      </instructions>

    </bundle>

    <bundle name="Personal Gmail preferences" editable="true">

      <instructions>
        The user prefers concise email drafts.
        Never archive messages without confirmation.
      </instructions>

    </bundle>

  </environment>
  ```
- If creating the sub user that has different read and write capabilities is complex then a different way that we can do it is to swap out the right and edit tools to make our own version of them that would neatly handle the different files different ways. But this has its own problem in that different agent runtimes will not allow me to replace those critical tools with my own version of them so we might be limited to just Pi if we do that which might be okay 