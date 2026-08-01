# Environments, skills, and the Rook agent

The Rook agent is isolated from environment internals for security. It learns what to do from skills, but the skills only provide a narrow means of communication w/ the environment (see [[narrow-skills-environment-bridge]]).

## Environment

Core object. It has a URL-like identifier: `<kind>:<unique-path>` (e.g. `web:en.wikipedia.org/wiki/Julius_Caesar`, `mac:md.obsidian/MyVault/Projects/Foo`, `location:lowes.com/store-1234`, `dir:/Users/johnberryman/projects/github/rookkeeper/rook`). And is associated w/ metadata (display name, provenance, other fields TBD). An environment has an arbitrary state which changes over time that we will _somehow_ communicate to the Rook agent (Also TBD). And an environment is associated with Skills that allow the agent to interact with it and draw information from it.

Current top-level environment kinds are:
- `location`
- `web`
- `mac`
- `dir`
- `iphone`
- `android`
- `windows`

Environment ids may still look hierarchical (`web:reddit.com/r/foo`, `dir:/Users/john/...`), but registration and entry are literal. Rook can still use observed paths/URLs to discover other known environments with attached capabilities, but it should not implicitly expand every path segment into an active environment. Multiple overlapping envs can be active at once. Skills and state can be associated w/ any explicit environment id.

For some terminology, there are many "known" environments (ones that are available in an environment repository somewhere). The "available" environments are the ones that the Rook can currently choose to enter (like if you're at Home Depot, then `location:homedepot.com/store-4321` will be available; if you're using Obsidian on the Mac, then `mac:md.obsidian/HomeProjects/ToDos` could be available; if you're browsing the Rook repo in Finder, then `dir:/Users/johnberryman/projects/github/rookkeeper/rook` could be available). And an environment is "entered" if the current session has loaded its skills and is accepting its state changes. (Though it is also possible to request to enter environments that aren't available - like if you want the Rook to know how to navigate a Home Depot even though you're not there. Implementation and UX TBD)

## Environment repositories

Catalog of environment → bundle content. SQLite is the canonical/personal storage API; directory and project sources remain import/authoring integrations.

See also: [`PRODUCT/environment-repository.md`](./environment-repository.md)

**Logical model:**

```text
EnvironmentRepository
  └── environments[]
        └── environment   # id + metadata
        └── capabilities[]
              └── skills, facts, MCP content, apps, and llms.txt references
```

**Types of environment repositories:**

- **Canonical** — curated, trusted SQLite catalog initialized from `environment-repository/`.
- **Personal** — user-owned SQLite repository; personal skills and instructions remain writable through the session workspace.
- **Project** — direct project files such as `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and `.mcp.json`.
- **External** — repositories from other providers; stronger sandboxing and publishing/signing are deferred.

And environment repository needs to be searchable so that you can find environments and skills that might be useful.

## EnvironmentManager

Runtime coordinator that serves as a connection between Rook agents, environments, and capabilities. It also remembers bundle choices.

When a new environment candidate becomes available, the environment manager can finalize it into one or more real environments by checking known repository-backed capabilities (including exact ids plus path/url-implied known environments). Then the user can review the capabilities of any finalized environment and "allow once", "allow always", "reject", "ignore".

- If "allow once" or "allow always", the skills are injected into the running session.
- If "reject" or "ignore", then the skills are not injected.
- If "allow always" then the skills are cached locally, and every time the environment becomes available, the user/agent will automatically enter it and get the cached skills. If the skills are modified by the environment provider, then the users will be again asked to approve.
- If "reject" then this decision will be saved, and when the environment becomes available, it will not be entered. The user can revisit these decisions later.
- On the UI we need some way to represent the number of environments available and entered. And when they click on this they can modify past decisions - TBD.
