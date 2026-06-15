# Goals for moving things to GitHub issues

We will take each item below **one at a time** and:

1. **Review it** — does it still make sense?
2. **Cross-check context** — against the source documents in my Obsidian TiddlyWiki vault, everything else in `PRODUCT/`, and the codebase as it exists today.
3. **Clarify before filing** — if anything is ambiguous or under-specified given that context, resolve it here first. An issue must be clear enough that someone else can pick it up and work on it without guessing.
4. **Create the GitHub issue** — write an appropriate issue title and body from the clarified item. Apply **GitHub labels** at filing time (see [Labels](#labels) below) — type and areas come from the todo block, not the issue body. The issue should be clear enough that someone else can run with it (but assume that they have good grounding in this repo and project too)
5. **Link back** — add a bullet at the top of that item's block: `- issue: <GitHub issue URL>`.

## Issue template

Each GitHub issue should read like a **lightweight ADR plus implementation brief** — high-level intent first, enough detail that a human or coding agent can execute without guessing. Inspired by [MADR](https://adr.github.io/madr/) (context → decision → consequences), [Microsoft's agentic-agile story template](https://github.com/microsoft/agentic-agile-template) (spec-first scope and invariants), and our own [`pr-template.md`](../.agents/skills/product-architecture-pr/pr-template.md).

Copy the block below into the issue body and fill every section. Delete guidance comments. If a section truly does not apply, say so in one line — do not leave placeholders.

```markdown
## Summary

[2–4 sentences: what we are building or changing, and the outcome for users or the system.]

## Problem / context

[What is broken, missing, or unclear today? Tie to user workflow or system behavior. 2–5 sentences or a short bullet list.]

## Why we need this

[Rationale — security, product philosophy, cross-device consistency, moat, etc. This is the "decision drivers" section: what forces this work now?]

## Product & architecture alignment

**Classification:** [Implements | Extends | New concept | Modifies | Supersedes]

**How this fits Rook:** [1–3 sentences — agent + environment model, ACP, skills, bridge, etc.]

## Scope

### Invariants to preserve

- [Behaviors, security boundaries, or protocol contracts that must not regress]

## Approach

[Recommended direction — not a full design doc, but enough to steer implementation. Mention options only when the choice was non-obvious.]
```

**Issue title:** `[type/area] Short outcome-oriented title` — e.g. `product/Environment: Narrow environment bridge via postToEnvironment`. Use `type` and primary `area` from the todo block for the prefix.

### Labels

Tag each issue **when creating it on GitHub** — not in the issue body. These labels **already exist** in the repo; apply the matching type and area labels from the todo block when filing. If a new `areas:` value appears in a todo block, create that label on GitHub before filing.

**Type** (one per issue, from the todo's `type:` field):
- `product_change`
- `architectural_change`
- `bug`
- `business`
- `personal`
- `future_work`

**Area** (one or more, from the todo's `areas:` field):
- `UI`, `Service`, `Environment`, `Clients`, `web-client`, `obsidian-client`, `chrome-extension`, `agent-station-menu-bar-app-mac` — create new area labels on GitHub as they appear in todo blocks

# BYOA / Rookery Todos Gathered from TiddlyJohn



## Build the narrow environment bridge (`interact_with_environment` / `postToEnvironment`)
- issue: https://github.com/arcturus-labs/rookery/issues/3
- type: product_change
- areas: Environment, Service, agent-station-menu-bar-app-mac
- source: `narrow-skills-environment-bridge.md`, `skills-definitions.md`
- original:
```
- [ ] Give the Rook one narrow tool for all environment interaction — like cURL: GET or POST to a named endpoint within an environment (e.g. `interact_with_environment("app:obsidian/reading_list", "POST", "new_reading_item", {…})` or `postToEnvironment`). Skills describe those endpoints; the agent never learns platform mechanics directly.
- [ ] Wire that tool into every agent backend the client can talk to — it must be available on each session, not something skills simulate with shell/curl:
	- [ ] **Pi** — add a dedicated Pi extension whose only job is exposing `interact_with_environment` / `postToEnvironment` (PiAgent already loads extension dirs alongside skills; see [[Make other agent backends reload with skills]]).
	- [ ] **Claude Code, Cursor, OpenCode, …** — usually an MCP server that registers the same tool surface and forwards to EnvironmentManager / the bridge (same pattern as other company MCPs we may adopt or convert).
- [ ] In EnvironmentManager, implement bridge software that receives that single tool call and does the right thing behind it:
	- [ ] **OS bridge** (`os:macintosh`, iOS, Android, Chrome OS, Windows, Linux?) — AppleScript, Accessibility, screen capture, synthesized input, etc.
	- [ ] **Web bridge** — translate endpoint calls to HTTP requests, manage login and tokens
	- [ ] **IoT bridge** — Nest, garage door, doorbell, alarm, etc.
- [ ] A Rook running on Mac and Android at the same time addresses environments the same way (`os:macintosh`, `app:slack`, …); only the bridge on the relevant device runs OS-specific code.
- [ ] Turning off an environmental skill should make `postToEnvironment` fail with a clear error (see also [[Make current, disabled, and unapproved skills visible and controllable]]).
```
- migration callout — **menu bar app skills bypass the bridge today.** Skills under `environment-repository/app/` teach the agent to shell/`curl` directly against the menu bar app's local MacBridge (`http://127.0.0.1:<MacBridgePort>`, token from `~/.agent-station/mac-bridge.json`). That is deeply Mac-specific and must move behind the bridge:
	- `environment-repository/app/cursor/cursor-companion/SKILL.md` — `/context`, `/window-text`, `/ax-elements`, `/input`
	- `environment-repository/app/google-chrome/web-reader/SKILL.md` — `/window-text`, `/screen-text`, `/screenshot`
	- `environment-repository/app/google-chrome/web-writer/SKILL.md` — `/input`, `/applescript` (System Events keystrokes)
	- `environment-repository/app/slack/slack-companion/SKILL.md` — `/context`, `/window-text`, `/applescript`
	- Implementation today: `agent-station-menu-bar-app-mac/Sources/Services/MacBridge.swift` (and README tier-3/4 docs). These routes stay — but the agent should reach them only via `interact_with_environment` / `postToEnvironment`, not raw curl in skill text.
- contrast — `environment-repository/web/wikipedia/wikipedia-discovery/SKILL.md` is closer to the target model (skills describe endpoints; client/extension handles the wire).

## Rename Agent Station to Rook
- issue: https://github.com/arcturus-labs/rookery/issues/4
- type: product_change
- areas: UI, Service, web-client, obsidian-client, chrome-extension
- source: `BYOA TODOs.md`
- original:
```
- [ ] Change naming to Rook (there are some agent station things?)
```

## Allow queued and steering prompts while the agent is running
- issue: https://github.com/arcturus-labs/rookery/issues/5
- note: Queuing and Pi mid-turn steering are already built. The issue is scoped down to adding mid-turn steering for ClaudeAgent (and future agents).
- type: product_change
- areas: UI, Service, web-client, obsidian-client
- source: `BYOA TODOs.md`
- original:
```
- [ ] Allow session/prompts to sent while the agent is still chugging and inject them as queued or steering prompts.
	- [ ] Needs UI update for both modes (steer/queue)
	- [ ] Needs different adapters for each agent ([see this discussion](https://chatgpt.com/share/6a2ddefb-4df4-83ea-be7c-2e57cf2638fc))
```

## Simplify session handoff to one active client
- issue: https://github.com/arcturus-labs/rookery/issues/7
- type: product_change
- areas: Service, web-client, obsidian-client, chrome-extension
- source: `BYOA TODOs.md`
- original:
```
- [ ] Instead of having multiple clients active for a single agent, when a session is continued in a different place, then don't worry about support the other clients. The old sessions is closed down (though with a button that allows you to continue - in which case the other shuts down and then one replays all of its messages).
	- Why?
		- The message replay isn't working.
		- Managing multiple clients for a single session is confusing (we need to clean up the pub-sub model as well!)
```

## Port the product to Expo and React Native
- type: product_change
- areas: UI, Clients
- source: `BYOA TODOs.md`
- original:
```
- [ ] Port code to Expo + React Native ([see here](https://chatgpt.com/share/6a2dbe30-5d3c-83ea-a307-4518ba3c537b))
```

## Turn planning into GitHub issues and a task factory
- type: business
- areas: Service
- source: `BYOA TODOs.md`
- original:
```
- [ ] Move a lot of this stuff to GitHub issues and start a factory of sorts like Ryan Vice demoed.
```

## Make other agent backends reload with skills
- type: bug
- areas: Service, Environment
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make sure the other agents can reload w/ skills.
```
PiAgent can easily load up a skills or extension directory and incorporate new skills temporarily. I'm not quite sure what to do for Claude and the others.

We probably need to also add some documentation on the BaseAgent that describes the things that are required of all implementing subclasses

## Build opencode, Cursor, and Claude Code versions and move to ACP
- type: product_change
- areas: Service, Clients
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make opencode and [cursor](https://cursor.com/docs/cli/acp) and claude code versions of this
	- [x] Check on better standards
		- [x] [Agent Client Protocol](https://agentclientprotocol.com/get-started/introduction) ~ [see the end of this conversation](https://chatgpt.com/share/6a26fe72-b2c0-83ea-93fa-8e8b7d62fd1a) this is probably exactly what I want - but I'd need to extend it a bit ~ might be what I want!
		- [x] [Agent Communication Protocol](https://agentcommunicationprotocol.dev/introduction/welcome) ~ got pulled into A2A
		- [x] [A2A is higher level than what I need](https://chatgpt.com/share/6a26f861-1b7c-83ea-a9ea-4722e1349bd8)
	- [ ] Move over to ACP
```

## Refactor the codebase into layered architecture
- type: product_change
- areas: Service, Environment
- source: `BYOA TODOs.md`
- original:
```
- [ ] Refactor to layers: API, business logic, repository (db access)
```

## Keep the base agent minimal and load context-aware skills only where needed
- type: personal
- areas: Environment, Service, obsidian-client
- source: `BYOA TODOs.md`
- original:
```
- [ ] Pull my-agent skills and all the skills associated to a particular environment into my personal environment repository so that I can edit them w/ my Obsidian agent
``` 
and
```
- [ ] Make my agent really have just the base skills, and make the obsidian plugin embue the agent with obsidian skills only in that context.
	- [ ] But also make my agent be able to load in its own context aware skills, when it's in Peeps I want it to have extra skills for that.
```
these need to be combined


## Reload agents and clean context when environments change
- type: product_change
- areas: Environment, Service
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make agents reload when we change location so that the skills they inherited from one place don't get transferred to a new place. (And since we have the same context in both locations we might want to do something smart to "wash away" the old skills so their call sites aren't in the context.)
```

## Push environment state into the client and user messages
- type: product_change
- areas: Environment, Service, obsidian-client, chrome-extension
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make the agent aware of the context right off the bat. "You are in the Peeps vault" Is there a user message or agent message that we can stick in there?
	- [ ] But also make it aware as the context is changing. When a message is sent have a hook that checks the current state of the context app and inject that into the user message. For example, tell which pages are open on Obsidian.
```
and
```
- The environment constantly pushes it's state to the client upon every important state change. The client injects this into the user message (or at least the delta) whenever the user sends a message.
```
These need to be combined into a single TODO

## Support special agent hyperlinks and browser-aware link handling
- type: product_change
- areas: UI, web-client, obsidian-client, chrome-extension
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make it so that hyperlinks with a special format can be used to send messages to the parent app.
	- [ ] As a special case, if the agent is in a place that has a browser, then normal hyperlinks will open those pages.
```


## Build mobile native client
- type: product_change
- areas: Clients, UI, Environment
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make phone app that is geo aware and knows when I walk into Lowes
```

## Build desktop native client
- type: product_change
- areas: Clients, UI
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make a stand-alone app for the mac. Make browser icon for my agent.
```

## Add login protection, Google Docs sync, and accessibility
- type: product_change
- areas: Service, UI, web-client
- source: `BYOA TODOs.md`
- original:
```
- [ ] Put login protection (pulled from my form login), get google docs sinking on bustedscreen, make my agent accessible
```

## Productionize installation, onboarding, and remote connectivity
- type: product_change
- areas: Service, web-client, chrome-extension, Environment
- source: `BYOA TODOs.md`
- original:
```
- [ ] Productionize this thing and incorporate onboarding skill into the agent 
	- [ ] make an easy install – this is tricky because we need several things
		- [ ] browser plug-in
		- [ ] make the agent-server-client run
		- [ ] have a tunnel daemon set up like cloudflare that sends messages from agentstation.com to your actual agent (websites will send messages to us)
	- [ ]  [[Make "participatory workflow creation, improvement, and execution" skill]] 
	- [ ] It also needs an onboarding skill. 
```

## Build environment skills at scale
- type: product_change
- areas: Environment, Service, chrome-extension
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make skills for all the environments I can find so that it's actually useful
	- [ ] [Use Hamel's skill to make any website an API]([https://www.youtube.com/watch?v=rOaaibIFf8o](https://www.youtube.com/watch?v=rOaaibIFf8o)
	- [ ] Convert skills and MCPs from companies.
```

## Add cron jobs, events, and user update pings
- type: product_change
- areas: Service, UI
- source: `BYOA TODOs.md`
- original:
```
- [ ] Make my agent deal with cron jobs (like summarizing emails every week)
- [ ] Make my agent deal with events (like circleback)
- [ ] For both of the above (events and scheduled tasks), the agent would need to ping the user with updates. Maybe they would just be the end of the thread.
```

## Polish the chat UI and tooling display
- type: bug
- areas: UI, web-client, obsidian-client
- source: `BYOA TODOs.md`
- original:
```
### Smaller Things

- [ ] Make the Tool output more legible (do I need a callback for formatting the final tool call and tool response)
- [ ] Make the queued messages go in as soon as there's an opening (steerable), make them cancelable.
- [ ] Make images paste able.
- [ ] Make it the extremely long user or assistant messages truncated (and scrollable)
- [ ] Make actual tools for web search and fetch – make it cycle through free tiers services and fall-back if we hit 429s. And internal to the tool it would not run all searches in parallel.
- [ ] Add some indicator of money and tokens and requests spent.
- [ ] Make the lists formatted better (they're too tight right now)
- [ ] If I scroll back to the bottom of the chat window make it again become sticky and keep at the bottom as the text is generated
```

## Let agents create artifacts and richer interfaces
- type: future_work
- areas: UI, Service
- source: `BYOA TODOs.md`
- original:
```
### Important Later TODOs
- [ ] Make it possible for the agent to create it's own artifacts which are custom UI/UX SaaS replacements.
- [ ] [Lobby ACP to get environmental inputs wired into the protocol](https://agentclientprotocol.com/rfds/about)
- [ ] Make it possible to speak to the agent.
- [ ] Make it possible to control any app on the computer. (see https://github.com/farzaa/clicky)
- [ ] [[Make "participatory workflow creation, improvement, and execution" skill]]
```

## Add general extension support, conversation search, and multiagent workflows
- type: future_work
- areas: Service, Environment, UI, chrome-extension
- source: `BYOA TODOs.md`
- original:
```
### Maybe Later TODOs

- [ ] [[Make red-green diff that works in VSCode for any Agent that implements ACP]]
- [ ] Combine the chrome plugin into AgentStation and make it be able to see the contents of the page and the URL
- [ ] Make it easy to plug in extensions rather than just skills when the agent arrives in a particular context
- [ ] Create search over previous conversations (maybe using rg).
- [ ] **Multiagent interactions** 
	- [ ] Be able to click a node and have the agent fork a subagent at that point in the conversation.
		- [ ] Example - "read back on the past exchange and see if you can figure out why you had trouble accomplishing the result and then if it makes sense repair the `xyz` skill"
		- [ ] It's tricky - sometimes I want that agent to notify me of updates, sometimes I want it to notify me alone, sometimes I want it to give feedback to my current agent, sometimes I want it fire and forget, sometimes I want the messages to be reviewable later
```

## Add interactive environment-driven UI controls
- type: future_work
- areas: UI, Environment, Clients
- source: `BYOA Strategy.md`
- original:
```
- Eventually
	- The environment can inject multi-choice or text question boxes into the agent which will be represented on the screen. (Ex. Useful for approving menu orders from Wendy's.)
	- The environment can make it possible to provide autocompletion for items in the environment.
```

## Build environment repositories, search, and acceptance tracking
- type: product_change
- areas: Environment, Service
- source: `BYOA Strategy.md`
- original:
```
- EnvironmentManager
	- manages EnvironmentRepositories (which hold lists of environments and associated skills)
	- tracks state of environments, and somehow facilitates the state changes being pushed into the SessionsRooms (pubsub?)
	- tracks acceptance status of environments
	- allows for search of environments
```

## Define the environmental update protocol for agents
- type: product_change
- areas: Service, Environment
- source: `BYOA Strategy.md`
- original:
```
- Agent – the base agent can be anything, but it needs to be augmented w/ the ability to interaction w/ the environment. This is a set of instructions about what to expect in messages (probably a new `<environmental_updates>` tag), and a tool for communicating with the environment.
```
- more detail - now since we're using ACP, I can make use of the protocol extensibiility here https://agentclientprotocol.com/protocol/v1/extensibility

## Add mobile support and auth handshakes for environments
- type: product_change
- areas: Clients, Environment, Service
- source: `BYOA Strategy.md`
- original:
```
- An iPhone or android app is probably warranted soon.
- There needs to be some sort of auth handshake when being logged in is required.
```

## Keep artifacts visible and support participatory workflows
- type: future_work
- areas: UI, Service, Clients
- source: `BYOA Business Strategy.md`
- original:
```
**Features:**
- There is importance applied to keeping the "artifacts" of work visible so that you and the agent are looking at the same thing and so that work is transparent and well-understood by both parties.
- You work *with* the agent rather than just giving it tasks. This is the "participatory" user experience. The agent knows how to learn from you during the execution of a task, and eventually you *can* just give the agent tasks once you're certain it will typically do the right thing.
```
