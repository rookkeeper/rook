---
resolved: 2026-06-04
---

# Brainstorm: Environment Model and Dynamic Skill Availability

## Goal

We want a rigorous but still simple model for:
- environments
- the skills associated with environments
- live environment state
- persistent decisions about environments/skills
- how sessions gain and lose environment-derived capabilities over time

This document is intentionally in motion. The goal right now is to capture the shape of the system clearly enough that implementation choices can follow. We're going to start building out some of these concepts. With each modification of the actual code, you need to see if the requested code change is in agreement with the ideas in this doc. If they are not, that's ok, but we need to discuss and update this doc before making the code change if the disparity is too great.

---

# Core idea

The core object is the **environment**.

An environment:
- has an ID
- has metadata
- may have current live state
- may be associated with one or more skills
- may become available or unavailable over time

The agent session does **not** permanently own all of that directly.

Instead:
- the **EnvironmentManager** keeps track of environments globally
- the **SessionRooms** keep track of which skills are currently loaded for that session/runtime
- environment changes are reflected into sessions through events and runtime restarts

---

# Environment identity

For now, environment IDs should use this format:

```text
<kind>:<unique path>
```

Examples:
- `web:reddit.com/r/todayilearned`
- `web:substack.com/@somepublication`
- `loc:lowes.com/store-1234`
- `app:obsidian.md/JohnsToDoLists/Projects/BecomeBuzillionaire`

## ID rules by kind

### Web
For web environments, the unique path should be the URL shape **without** the scheme in the ID.

Examples:
- `web:reddit.com/r/todayilearned`
- `web:amazon.com/gp/product/B000123`
- `web:news.ycombinator.com/item?id=12345`

The website/operator effectively defines the URL hierarchy, and for now we can rely on that.

### Location
For location environments, use the owner/operator domain plus a path-like identifier.

Examples:
- `loc:lowes.com/store-1234`
- `loc:starbucks.com/store-9988`
- `loc:airports.com/sfo/terminal-2`

Later, partners may define richer or more canonical location identifiers, but this is good enough for now.

### App
For app environments, use the domain associated with the app plus a hierarchical path that makes sense for that app.

Examples:
- `app:obsidian.md/JohnsToDoLists`
- `app:obsidian.md/JohnsToDoLists/Projects/BecomeBuzillionaire`
- `app:figma.com/team-123/file-456/page-789`

For Obsidian specifically, a natural path is:
- app domain
- vault name
- vault-relative path beneath it

That gives hierarchical structure and lets us refer to:
- a vault
- a folder inside a vault
- a note inside a vault

If something moves, the ID changes. That is acceptable for now.

---

# Environment metadata

Every environment should also have metadata as an arbitrary blob.

Possible shape:

```ts
interface EnvironmentRecord {
  id: string;
  metadata: Record<string, unknown>;
}
```

The metadata is intentionally loose for now.

It may eventually include things like:
- display name
- human description
- locator info
- parent/child info
- geometry / lat-long / bounding boxes for location environments
- app- or web-specific details
- repository provenance
- source/provider/creator identity for the environment description and skill bundle

But the important point is:
- the ID carries the main identity
- metadata carries additional descriptive or indexing information

We should avoid over-modeling this too early.

---

# Environment state

Environments are not just associated with skills; they may also have live state.

Examples:
- Amazon: current product page, cart contents, checkout stage
- Reddit: current subreddit, current post, current filters/sort mode
- Obsidian: current vault, current note, selected text, open panes
- A location: current aisle, current inventory snapshot, current nearby services

So an environment has:
- stable identity
- mutable live state

Possible shape:

```ts
interface EnvironmentState {
  environmentId: string;
  updatedAt: string;
  data: Record<string, unknown>;
}
```

The exact schema for `data` is intentionally unresolved.
It may remain environment-specific, or we may decide that a continuously updated structured state object is the wrong abstraction for some environments.

In some cases, instead of repeatedly updating a rich `state` blob, it may be better for the environment to push small direct messages about what changed.
For example, on Reddit, switching from one post to another may be better represented as a terse update/event than as a large evolving state object.

So there is some ambiguity here:
- maybe environments keep updating current state
- maybe they mainly emit short change messages
- maybe they do both depending on the environment

Important distinction:
- **skills** describe what the agent can do
- **state** describes what is true right now in that environment

The EnvironmentManager should keep track of the current state of active environments, but we should stay open to the idea that some environments may be represented more by terse change events than by a continuously maintained state schema.

---

# Broad vs narrow environments

A broad host is often too coarse.

Examples:
- `web:reddit.com` is broad
- `web:reddit.com/r/todayilearned` is more useful
- `app:obsidian.md` is the broadest Obsidian environment
- `app:obsidian.md/JohnsToDoLists` is narrower
- `app:obsidian.md/JohnsToDoLists/Projects/BecomeBuzillionaire` is narrower still

So environments are naturally hierarchical.

That does **not** mean we need a heavy separate abstraction here.
It just means environment IDs themselves should be hierarchical enough to represent the useful scope.

Sometimes a user may feel they are in “one place” while logically the system is tracking multiple environments.

Examples:
- being inside Reddit may logically involve both:
  - `web:reddit.com`
  - `web:reddit.com/r/todayilearned`
- being inside Obsidian may logically involve both:
  - `app:obsidian.md`
  - `app:obsidian.md/JohnsToDoLists`
  - `app:obsidian.md/JohnsToDoLists/Projects/BecomeBuzillionaire`
- being physically in Lowe’s while also browsing a website on a phone may mean:
  - `loc:lowes.com/store-1234`
  - `web:reddit.com/r/todayilearned`

That is okay.

The system may track multiple overlapping environments at once even when the human experience feels singular.

This can also affect skill layering.

Examples:
- `web:reddit.com` may load generic Reddit skills
- `web:reddit.com/r/todayilearned` may add subreddit-relevant skills or context
- `app:obsidian.md` may load generic Obsidian skills like how to search/navigate content
- `app:obsidian.md/JohnsToDoLists` may load skills for interacting with a kanban/todo setup in that vault
- `app:obsidian.md/JohnsToDoLists/Projects/BecomeBuzillionaire` may further add skills specific to that project

One open question is whether parent environments should always be materialized when a narrower environment is active. We do **not** need to solve that yet.

---

# Skills

For now, the only resource we really want to associate with environments is **skills**.

That is a good simplifying choice.

So the model is:
- environments have skills
- environments may have state
- sessions load some set of skills based on environment availability and user choice

We do **not** need a more generalized layer here right now.

---

# EnvironmentManager

We should treat the **EnvironmentManager** as the central authority for environment data.

It does two major jobs.

## 1) Persistent store
It keeps a persistent store of:
- all environments and their associated skills (full bodies, references, scripts, and metadata)
- decisions we have made about them (approved, rejected for now, auto-accept, etc.)
- repository data we have learned from (sync/cache metadata for configured repos)
- indexing/search metadata over time

## 2) In-memory live store
It keeps an in-memory store of:
- environments that are available right now
- the current live state of those environments
- environment availability changes
- pending environment/session interactions

Important distinction:
- the **EnvironmentManager** tracks environments, known skills, decisions, and live environment state globally
- the **EnvironmentManager** also orchestrates what to offer each session and when to push state into the runtime (see API below)
- the **SessionRooms** track which skills are actually loaded into each running session

That split feels important.

## EnvironmentManager API

The API below is how the two jobs above connect to providers, UI, repositories, and SessionRooms. It is **not** the environment **repository** API (catalog search/read). The EnvironmentManager is the **runtime coordinator**: it merges live availability, persistent encounter/decision data, and repository lookups, then drives what each **SessionRoom** receives.

**Inbound** (environment providers and UI):

```ts
interface EnvironmentManager {
  /** Live provider says an environment is now around us. */
  registerAvailable(environment: EnvironmentRecord, initialState?: EnvironmentState): void;

  /** Live provider (or internal detection) says an environment is gone. */
  markUnavailable(environmentId: string): void;

  /** Terse state patch from a live environment (forwarded as events to entered sessions). */
  updateState(environmentId: string, patch: EnvironmentStatePatch): void;

  /** Persist a decision level for an environment (auto-accept / notify / rejected). */
  setDecision(environmentId: string, decision: EnvironmentDecision): void;

  /**
   * UI calls this when the user approves a "notify me" environment for a specific session.
   * sessionId is required because multiple SessionRooms may be open simultaneously.
   * Internally triggers the environmentEntered event to that session's subscriber.
   */
  approveEnvironment(environmentId: string, sessionId: string): void;

  /** SessionRoom registers on startup to receive environment events for its session. */
  subscribe(sessionId: string, listener: EnvironmentEventListener): void;
  unsubscribe(sessionId: string): void;
}
```

**Outbound** — events pushed to subscribed SessionRooms (not calls from outside):

```ts
interface EnvironmentEventListener {
  /** Environment is now entered in this session; skills payload is ready to load. */
  onEnvironmentEntered(environmentId: string, skills: SkillCatalogEntry[]): void;

  /**
   * Environment is no longer available (provider called markUnavailable or
   * EnvironmentManager detected it internally). Skills should be removed from runtime.
   */
  onEnvironmentExited(environmentId: string): void;

  /** Terse state update for an environment already entered in this session. */
  onEnvironmentStateChanged(environmentId: string, patch: EnvironmentStatePatch): void;
}
```

**Internal logic** (not part of the public API, but important to describe):
- When `registerAvailable` fires, EnvironmentManager checks the stored decision for that environment:
  - **auto-accept**: resolves skills from configured repositories, emits `onEnvironmentEntered` immediately to all subscribed sessions
  - **notify me**: surfaces a pending notification to the UI; waits for `approveEnvironment` call, then emits `onEnvironmentEntered` to the specified session
  - **rejected**: no notification, no event
- `resolveSkills` (internal) fetches full skill payloads from configured environment repositories

---

# SessionRooms

This is already an existing concept in the codebase (`SessionRoom` / `SessionRoomManager` in `agent-server-client/src/server/realtime/`).

Today, SessionRooms roughly own the live per-session runtime layer. They already handle things like:
- holding the current runtime for a session
- wiring agent callbacks into persisted/replayed session events
- websocket subscriber fan-out
- replay for joining clients
- serialized publish/replay behavior
- idle shutdown / room cleanup

So we should think of the new environment model as layering onto that existing structure, not replacing it.

In rough terms:
- the **EnvironmentManager** keeps track of environments, known skills, decisions, and live environment state
- the **SessionRoom** keeps track of the live runtime for one session and which skills are actually loaded there
- the **SessionRoomManager** owns the currently active rooms and their lifecycle

The SessionRoom subscribes to the EnvironmentManager on startup and receives environment events (`onEnvironmentEntered`, `onEnvironmentExited`, `onEnvironmentStateChanged`).
The SessionRoom remains the place where those events become actual runtime changes: loading skills, removing skills, restarting the runtime, and persisting environment events to the session transcript.

---

# Event model

Sessions are powered by events.

We currently have at least:
- user events
- agent events
- environment events

Environment events will become important first-class transcript/UI events.

The state-change side of this is a little tricky.
It may be the biggest vector for prompt-injection-style problems, so we should be cautious about letting environments stream large amounts of arbitrary descriptive text into the session.
A good default may be to insist that state-change messages are very terse.

## Environment event types
These session-level environment events should not be about approval/rejection.
That approval flow happens in the application/UI before environment-derived skills are allowed into the live agent session.

Inside the session itself, the agent should see these environment lifecycle events:
- environment entered
- environment exited
- environment state changed

`environment entered` means the environment is now active in the session and its associated skills have been turned on for that runtime.
`environment exited` means the environment is no longer active in the session and its associated skills have been removed from that runtime.

These names are better than skill-centric names because they describe what the agent experiences at the session level.

The display should make environment changes visible so the user can see when:
- environments appear/disappear
- environment state changes
- environment-associated skills are added/removed

But especially for state changes, the displayed/update payloads should probably be terse and constrained rather than long freeform prose.

---

# Approval and onboarding flow

## Ongoing session: environment appears
If a new environment becomes available during an existing session:
1. the environment is registered with the EnvironmentManager
2. the system determines which skills are associated with that environment
3. the client UI shows a prompt like:
   - “This environment includes these skills. Do you want to accept them?”
4. **only after approval** should the session receive the skills-turned-on event and restart/runtime update

So in an ongoing session:
- the pop-up happens before the session gets the skill activation event
- approval gates skill loading

## Ongoing session: environment disappears
If an environment goes away during a session:
1. the EnvironmentManager marks it unavailable
2. the session emits a visible environment/skill removal event
3. the SessionRoom removes those loaded skills
4. the runtime restarts in place without them

The room stays open and clients stay connected.
The runtime changes underneath them.

## New session startup
If a new session starts while we are already in one or more environments:
1. session creation checks the EnvironmentManager for currently available ambient/environmental skills
2. the user is shown which environment-associated skills are candidates for inclusion
3. the user chooses what to include
4. only then are the chosen skills loaded into the new session runtime

So the session should not blindly start with every ambient environment skill already active before user confirmation.

---

# Environment acceptance vs skill acceptance

There is an important product question here.

Originally the UX has looked more like approving individual skill injections.
But longer term, a cleaner model may be:
- the user accepts or rejects the **environment**
- the environment includes a set of skills
- accepting the environment means accepting that set of skills together

That may be better than asking separately for each skill the environment pushes.

A likely direction:
- present: “This environment includes these skills”
- user accepts the environment package
- all included skills become eligible to load

This would be a UX break from the current finer-grained injection flow, but it may be the correct abstraction.

We do **not** need to fully resolve that here, but it seems likely.

---

# Environmental decision states (LOCKED MODEL)

This section supersedes the earlier three-state sketch. Decisions are made at the
**environment** level (all of its skills inherit the decision), and the model is a
clean **2×2**: every decision answers two questions — *trust it, or not?* and
*just this visit, or always?*

|                | **Just this visit** (resets when the env goes unavailable) | **Permanent** (persists across visits) |
|----------------|------------------------------------------------------------|----------------------------------------|
| **Positive**   | **Accept** — entered + skills used while available; re-checked the next time it appears | **Approve** — auto-entered every future time it becomes available |
| **Negative**   | **Ignore** — not entered, not notified again *this visit*   | **Reject** — never notified again      |

- **Accept**: the environment is trusted *while it stays available*. If it becomes
  unavailable and later returns, it must be checked again.
- **Approve**: trusted from now on; auto-entered (silently, but with a visible
  lifecycle event) every future time it is available.
- **Ignore**: not entered, skills not used; stop notifying about it for the current
  availability episode only. Resets when it goes unavailable and returns.
- **Reject**: never notify again (until the user changes the decision in a
  management UI later).

If a user is already in an Accepted environment and chooses **Ignore**, that doubles
as "leave now and stop bugging me this visit" — the skills are removed and the
runtime restarts without them.

## Three orthogonal concepts

Keeping these separate is what makes the model easy to reason about:

- **Available** — a live signal says the user is "in this place." Global across all
  sessions. The provider (e.g. the Chrome extension) emits availability when the
  page opens and **emits unavailable when the page closes** — that close is the
  "left" signal and the boundary of an availability episode.
- **Decision** — the 2×2 above. Per-environment, global. Precedence: an ephemeral
  this-visit decision (Accept/Ignore) overrides the persistent one (Approve/Reject)
  for the current episode, so an Approved env can still be Ignored "just this once."
- **Entered** — skills actually loaded into a given runtime. **Per-session, and
  derived**: a SessionRoom enters an env *iff* it is available **and** the effective
  decision is Accept/Approve. Undecided ≠ entered.

## Operational decisions (locked)

- **Availability is global**: once available, the env is offered/applied to all open
  SessionRooms; a session opened later while it is still available picks it up by the
  same rule (Approve → silent enter; Accept → enter; undecided → notify).
- **Persistence boundary**: Approve/Reject persist in **SQLite** (via a repository-
  layer `EnvironmentDecisionStore` on Node's built-in `node:sqlite`). Accept/Ignore
  are in-memory, scoped to the current availability episode (cleared on unavailable).
- **Entry only affects open rooms**, and the runtime restart that swaps skills
  **waits until the agent is idle** (no in-flight thinking/text/tool generation)
  before restarting.
- **Offer transport is WebSocket push** (not polling): the EnvironmentManager pushes
  offer/enter/exit/resolution events to subscribed SessionRooms, which fan them out
  to their clients. When any client resolves an env (accept/approve/ignore/reject),
  the resolution is broadcast so every other client's prompt for that env closes.

---

# Environment repositories

**Today:** skill payloads for injection often live under `.var` (gitignored runtime state).

**Direction:** skills, references, and scripts belong in **environment repositories** (canonical and local). Rook discovers and loads them through the repository API.

Rook can be configured with **multiple environment repositories**.
Each repository is a **set of environments** (and everything hung off them — see data model below).
The platform merges and indexes across configured repos; precedence when the same environment ID appears in more than one repo is TBD.

## Default pair

Most installs will use **two** repositories by default:

### Canonical repository
The **official Rook environment repository** — trusted, curated skills and environment definitions (partners, community contributions vetted for the catalog, etc.).

Near-term practical step: we will likely create a new root-level directory in this monorepo that holds the canonical repository contents.
So for a while, it will simply live inside this project.
Later, it can be split out into its own GitHub repository if that becomes the better boundary.

### Local repository
A **user-owned repository** on disk where people create and maintain their own environments and skills.
Typical use: environments that correspond to **programs, software, or websites** the user cares about (including location-specific setups they have configured).
This is not a substitute for the canonical catalog; it is the place for personal/org customization, experiments, and skills that will never ship in the official repo.

Additional repositories (team share, vendor bundle, etc.) may be added later via configuration.

## Repository data model

Focus here is the **logical model**, not on-disk or Git layout (that comes later).

```text
EnvironmentRepository
  └── environments[]          # set of environment entries
        └── environment       # id + metadata (identity, description, provenance, …)
        └── skills[]          # zero or more per environment
              └── skill       # id + metadata (name, description, …)
              └── references[]  # zero or more (docs, URLs, pointers, …)
              └── scripts[]     # zero or more (supporting scripts/assets for the skill)
```

**Tools** attached at the environment or skill level might be useful; we have not committed to that yet.

## Repository API

Whether a repository is **local** (on disk) or **remote** (HTTP/Git-backed service), Rook talks to it through the **same API**. Backends differ; callers do not.

Minimum surface:

```ts
interface EnvironmentRepository {
  /** Stable id for this configured repo (e.g. "canonical", "local"). */
  readonly repositoryId: string;

  searchEnvironments(query: EnvironmentSearchQuery): Promise<EnvironmentSearchResult[]>;

  searchSkills(query: SkillSearchQuery): Promise<SkillSearchResult[]>;

  getEnvironment(environmentId: string): Promise<EnvironmentCatalogEntry | null>;

  /** Full skill payload: metadata, references, scripts, readable skill body. */
  getSkill(environmentId: string, skillId: string): Promise<SkillCatalogEntry | null>;
}
```

Search should support at least:
- free-text query across names/descriptions
- filter by environment kind (`web`, `loc`, `app`, …)
- filter skills to a specific environment (or environment ID prefix)
- pagination / limits (exact shape TBD)

`getSkill` is how the runtime and UI **read** a skill before approval, injection, or review (prompt-injection checks, preview, etc.).

A **repository registry** in Rook holds configured repos and can:
- fan out `searchEnvironments` / `searchSkills` across all repos (merge/dedupe/rank — TBD)
- resolve `getEnvironment` / `getSkill` using repository precedence when IDs collide

Remote canonical repos may expose this API over HTTP; local repos may use SQLite or plain files behind the same interface. That is an implementation detail behind `EnvironmentRepository`, not a second product concept.

One important piece of environment-level metadata is the **source of the information** for that environment entry.

Early on, this source will often not be canonical.
Examples:
- a GitHub username
- an open-source maintainer identity
- a third-party contributor

Later, once we have official partnerships, the source/provider/creator can become canonical.
Examples:
- the company website URL
- the official operator domain for that environment

So over time we may move from:
- community-authored environment descriptions/skills
into:
- official environment descriptions/skills published by the actual owner/operator

That source/provider identity should therefore be first-class on the environment (and propagated into search/index metadata) because it affects:
- trust
- display
- ranking/search
- replacement/override behavior when canonical entries become available

This matters because there is no reason we must only get a skill by physically/naturally entering the environment first.

Examples:
- we could proactively load Lowe’s skills
- we could load Home Depot and Lowe’s skills together
- we could load several airline/travel environments’ skills together for comparison shopping

So there are at least three important sources of environment/skill knowledge:
- live encountered environments
- canonical (and other configured trusted) repository environments
- local repository environments the user authored

That means “available now” and “known from a repository” are different concepts.
A skill may be known because it lives in the local repo, the canonical repo, or both.

## Storage and publication (later)

Do not lock the catalog to “one file per environment” yet.

Near term, a **local** repository backend may use **SQLite** (or similar) behind the repository API for fast search.

Longer term, for the **canonical** repository especially:
- define a **plain-text interchange format** so the whole catalog is readable on GitHub without a proprietary viewer
- host a **searchable website** in front of that catalog (browse, filter, rank) — GitHub alone is not enough for discovery

The plain-text repo and the website are publication/distribution concerns; the runtime DB is an implementation detail that can be rebuilt from repo contents.

---

# Live availability vs known environments

We need to distinguish at least these concepts:

## Known environment
An environment we have seen before or know from a repository.

## Available environment
An environment that is around us/live right now.

An available environment is just one that currently exists in the surrounding context.
By itself, that does **not** mean the session has entered it.

## Environmental decision state
An environment can have a remembered decision state such as:
- approved and auto-enter
- approved with notification/confirmation
- rejected for now

If an environment is rejected for now, we still want to know that it is available.
But it should behave as though it does not exist from the session’s perspective unless the user later changes that decision.
In other words:
- it can show up in the UI as available
- it should not automatically join the session
- it should not keep bothering the user for approval/review every time

## Entered environment
An environment the session has actually entered.

If the session has entered the environment:
- the session receives that environment’s reported changes/state updates
- the runtime gets access to that environment’s associated skills/capabilities
- the session should see the relevant environment lifecycle events (`environment entered`, `environment exited`, etc.)

This may be a better concept than talking about “loaded skills” in isolation, because the important session-level fact is really whether the environment has been entered.

Also, entered does not have to mean physically/live available right now.
A session may explicitly enter an environment from the repository even if that environment is not ambiently present.
That is the “virtually step into Lowe’s” case.

This distinction is important because:
- an environment can be known but not available
- an environment can be available but not entered
- an environment can be rejected for now but still known/available in the UI
- an environment can be entered because of explicit user choice even if it is not ambiently available
- a repository environment can be entered even if we are not physically/actually there right now

---

# Notifications and controls

The user should be notified when:
- environments become available
- an entered environment is turning on its associated skills/capabilities in the session
- an entered environment is being removed from the session because it went away

If an environment is rejected for now, it should still exist on some list somewhere.
So the user can still see that it is available/known, but it should not keep bothering them with availability prompts.

If an environment is new, that is the moment where we need to inspect it and approve or reject it.
That approval flow will be similar to the current skill-approval flow, but it will happen at the **environment** level instead.

So the future UI will likely show:
- the environment
- the skills it includes
- other relevant metadata
- some way to approve/reject/auto-enter it

We can keep the exact UI vague for now, but the main point is that approval/review moves up to the environment level rather than staying purely skill-by-skill.

And the user should be able to:
- approve an environment
- reject an environment for now
- review an environment later
- change whether it auto-enters or requires notification
- inspect what skills and metadata it includes

## Environment library / management UI
There should eventually be UI for looking through environments we know about, not just reacting to them as they appear.

That should include the ability to:
- browse known environments
- browse environments encountered in the past
- inspect environment records and their metadata
- inspect what skills an environment includes
- change an environment’s decision/approval state
- explicitly pull/enter an environment into a currently running session even if it is not ambiently present right now

This is more naturally an environment-management surface than a skill-management surface, even though the skills remain crucial underneath.

---

# Environment communication and exited-environment behavior

This whole area should stay intentionally a little vague until we define the environment/tool interaction model more explicitly.

What matters for now is the behavioral model.

## High-level requirement
The transcript may still contain prior uses of an environment, so the model may try to act on that environment again later.

Once an environment has exited:
- the session should stop using that environment’s associated capabilities
- if some stale attempt is made anyway, the attempt should fail clearly and indicate that the environment is no longer available

In other words:
- prior transcript/tool history should not imply that the environment is still usable
- once the environment has exited, fresh attempts to act on it should no longer succeed

## Communication model
Right now the environment communication path is too ad hoc.

In the Wikipedia flow, the current skill talks outward through the iframe using the `message_parent` command/tool path.

Long-term, we likely want a stronger model where:
- the environment itself pushes updates about availability and state
- there is some specific tool/path for speaking to the environment
- environment-backed capability calls are scoped to a currently active environment
- if the environment is gone, the call is rejected immediately

We should avoid getting too specific yet about the exact mechanism.
It may not be bash/curl/API-call oriented at all.
More likely there will be a dedicated environment interaction tool/path.

That stronger model would give us:
- liveness checks
- structured request/response semantics
- better observability
- cleaner security boundaries
- stronger correctness when environments disappear

This becomes even more important if we move toward:
- a standalone chat app
- Chrome/Obsidian as environment providers/launchers
- dynamically appearing/disappearing environments during a session

---

# Practical startup/session scenarios

## Scenario A: open new session while already in environments
- user is currently in one or more environments
- new session is created
- EnvironmentManager reports relevant ambient environments and associated skills
- UI asks what to include
- chosen environment-associated skills are loaded
- SessionRoom starts/runs with that selected set

## Scenario B: join existing session and new environment appears
- session is already live
- a new environment becomes available
- UI says the environment includes these skills
- user approves
- session emits skills-turned-on event
- the SessionRoom persists, but the underlying agent runtime restarts in place with new loaded skills

## Scenario C: environment disappears
- environment becomes unavailable
- UI shows that the environment-associated skills are being removed
- session emits skills-turned-off event
- the SessionRoom persists, but the underlying agent runtime restarts in without the skills associated to that environment
- stale future calls fail clearly if attempted

## Scenario D: proactive loading from repository
- user searches repository
- chooses one or more environments/skills
- session loads them even if not physically/live present
- those are treated as explicit user-selected capabilities rather than ambient live environments

This last scenario is important because it means the system is not limited to passive environment discovery.

---

# Questions

1. Should narrower environment IDs always imply parent environments, or not? ~ for now they should imply parent environments
2. Should environment approval happen at the environment level, skill level, or both? ~ it should happen at the environment level, but the skills should be visible and we'll also probably have a process to quickly read the new skills and make sure there isn't anything that feels like prompt injection
3. How should repository-selected environments differ from live ambient environments in the UI? ~ TBD
4. How much environment-state history should be persisted? ~ TBD - problem here is that we don't want to flood the environment with little transient state changes that the agent doesn't need to know about. for instance if the cursor position is changing in obsidian but when the user submits a message and they have a particular passage highlighted, then that would be very relevant to pass along at that moment. 
5. How should environment availability flapping be debounced/grace-perioded? ~ TBD
6. When the same environment ID exists in canonical and local repositories, which wins for metadata/skills, and how is that shown in the UI? ~ TBD
7. What plain-text interchange format makes the canonical repo legible on GitHub while supporting references/scripts per skill? ~ TBD
8. Exact HTTP shapes for remote `EnvironmentRepository` (auth, sync, caching)? ~ TBD

---

# Current best summary

- **Environment** is the core object.
- Environment IDs use `<kind>:<unique path>`.
- Environments have metadata and may have live state.
- Environments are associated with skills.
- The **EnvironmentManager** keeps a persistent store (encountered environments/skills, mappings, decisions, repo sync/index metadata) and an in-memory live store (availability, state, pending interactions); exposes a **runtime API** that offers skills and pushes state into SessionRooms.
- **SessionRooms** keep track of which environments (and associated skills) are actually loaded, and updates the session with environmental events (environment entered, environment exited, environment state change)
- Sessions are driven by user events, agent events, and environment events.
- Environment-associated skills should only be loaded after the relevant approval/onboarding step.
- When environments disappear, the skills should be removed from the session runtime and any stale capability call should fail clearly.
- Skills today often live in `.var`; **environment repositories** are the long-term home for skill content.
- Rook supports **multiple environment repositories**; by default **canonical** plus **local**.
- Each repository is a set of **environments** → **skills** → **references** / **scripts**; tools optional/TBD.
- **`EnvironmentRepository` API** — catalog search/read (local and remote backends).
- **`EnvironmentManager` API** — live registration, decisions, offerings per session, enter/exit, state updates into session runtime (uses repositories for skill content).
- Canonical publication eventually: **plain text on GitHub** plus a **searchable website**; local backends may use SQLite behind the same API.

That feels like a strong working direction.