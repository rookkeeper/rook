# Software factory brainstorming

This is the evolving discussion after [the rough outline](rough_outline_of_factory.md), not a finalized implementation plan. Record user preferences, possible approaches, and unresolved questions distinctly. Nothing here authorizes implementing the factory yet.

## Direction and user preferences

### Source precedence and worktree location

- When the original factory outline supersedes the deprecated lifecycle, follow the outline: it describes what we are trying to implement. The old lifecycle is historical source material, not an overriding requirement. Subsequent explicit decisions in this brainstorming document refine the outline.
- **Decided:** Put implementation worktrees inside the repository in a Git-ignored `.worktrees/` directory, not the old lifecycle's sibling `../_worktrees/` directory.
- Working task documents remain in the main checkout, separate from the implementation worktrees.

### Generic core, project-specific setup

- Build a reusable skill plus supporting scripts, independent of both agent harness and task-management system.
- Always establish `PRODUCT/`, `ARCHITECTURE/`, and project-specific `AGENTS.md`. For existing projects, reconcile existing documentation rather than blindly replacing it.
- Task and artifact storage are conditional on the chosen task system; do not automatically impose the Markdown directory layout.
- Establish a scripts directory for run, test, QA, and other common development operations. Discuss the actual commands and affordances per project and user.

### Harness and task-management references

Keep platform-specific guidance separate from the generic workflow. Proposed reference structure:

```text
references/
  agent-harness/
    pi.md
    claude.md
    ...
  task-management/
    jira.md
    github.md
    directory-of-markdown-docs.md
    single-page.md
    ...
  how-we-build/
    README.md
    servers.md
    services.md
    frontends.md
    native-applications.md
    ...
```

These are proposed files, not references that already exist. Start platform/system references as placeholders where necessary. Each placeholder must explicitly say: **If you need this integration, talk to the user to specify it before proceeding.** Do not silently invent a supported integration.

### Orchestrator and workers

During setup, discuss:

- How the orchestrator runs and starts or coordinates workers.
- How many workers may operate concurrently.
- Whether workers may invoke their own subworkers, and under what limits.
- How worker context, questions, progress, and results travel through the orchestrator.

Harness references should eventually supply default recommendations, but ask the user about their preferences rather than imposing those defaults.

The current harness is Pi. The working premise is that native sub-agent support is unavailable; we may begin with a small shim providing a weak notion of sub-agents and improve it later. The actual mechanism remains undecided. Worker setup is a near-term discussion, not something to assume from the old outline.

### Shared visibility is essential

The human and orchestrator must be able to see the same operational picture:

- What tasks exist and what is ready or blocked.
- What is in flight.
- Who owns each task and which worker is doing it.
- Current progress and outcomes.

Do not hide the factory's working state inside agent sessions. The task-system integration and worker mechanism must make this shared visibility practical; the exact representation is still open.

### How we build

TDD and tracer-bullet implementation are strongly preferred defaults. Build thin end-to-end slices rather than completing one architectural layer at a time.

Capture this approach in a dedicated `how-we-build` reference area, with application-specific documents for servers, services, frontends, native applications, and other domains as needed.

During setup, explicitly discuss the user's working preferences. They may revise or completely rewrite this aspect of the skill—or the skill itself. Strong defaults are not immutable requirements for every user or project.

### Independent quality assurance

QA must exercise the actual product independently of its implementation. Rereading code and declaring it correct is not QA, and passing implementation tests alone is insufficient.

Browser or computer interaction will likely be needed for UI work. Scripted interactions and other affordances remain useful when they actually operate and observe the product. Choose suitable independent verification per project; do not confuse code inspection with evidence that the application works. If QA is difficult or impossible, the worker marks the task blocked and pushes the missing QA requirements or decisions back to the user.

### Missing guidance and project documentation

- Every reference that is missing or underspecified must say so explicitly. When the orchestrator notices that the user's harness, task system, application domain, scripts, or QA approach lacks adequate guidance, it should tell the user and help fill the reference out—during setup or later when the gap appears. Do not silently pretend the placeholder is sufficient. This applies to harnesses such as OpenCode as well as the listed task systems and application types.
- Templates create `PRODUCT/README.md` and `ARCHITECTURE/README.md` explaining each directory's purpose. If either directory has no substantive files, the template/instructions tell the agent to ask the user to add them.
- The root-level `BACKLOG.md` template explains that it is quick capture, distinct from official `TASKS/` work, and includes one generic example beginning exactly `- [ ] Create README for this repo`.
- The user's preferred project convention is an optional root-level `scripts/` directory: a language-agnostic, makefile-like index of common commands. This is distinct from scripts inside the factory skill and belongs in the editable `references/how-we-build/README.md`, not as a universal factory requirement.
- Before the factory's end-to-end check, pause and tell the user it is ready for review. The user will increase the model and then ask for analysis of typical development workflows and missing coverage.

### Easy, reversible integration

Repeated requests for merge permission have been disruptive. The intended default is to integrate successful work back into main without asking about every routine merge.

Keep each task on its own branch and make the integrated change easy to identify, extract, and undo. Discuss the merge policy explicitly during setup, including validation gates and cases that still require human input. The exact merge strategy and rollback record remain undecided.

Automatic local integration is distinct from authorization to push or publish remotely.

## Differences from the initial outline

- Markdown task/artifact directories are an option, not universal setup.
- Worker concurrency and subworker permissions are configurable; the original prohibition on further worker delegation is not settled policy.
- Harness integration cannot assume a built-in sub-agent mechanism.
- Shared human/orchestrator visibility is a central design requirement.
- Building practices are strong, customizable defaults, not a fixed methodology imposed on every project.
- Routine merge approval should stop being a bottleneck, while preserving recoverability.

## Questions for the next discussion

- What is the smallest useful Pi worker shim? A: If the user is using clawed, then it has subworkers automatically. If we're using pi, then Probably the easiest thing to do is to use Tmux to spin up another Pi session. There is some documentation online from Mario Zechar about how he would recommend do this. Actually, this might work quite well https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent 
- How do worker questions and context handoffs work without fragmenting the human conversation? A: We might have to experiment with this briefly with some dummy workflows that are just sleeps and make sure that this works.
- Where does shared worker/task status live, and how does the human inspect it?
  - **Answered:** The original outline already specifies this for the Markdown task system. Shared task status lives in `TASKS/KANBAN/`; detailed progress lives in the linked `TASKS/WIP/{date}-{task_id}-{task_name}/task.md` as an ordered, maintained checklist. The backlog card remains the board-level record while the selected task expands into working documents. On completion, artifacts move to `TASKS/COMPLETE/` and the original card links to them. Human and orchestrator inspect the same board and files. Other task systems provide analogous visibility. Small details such as the worker-assignment field remain to be specified, but this is not an unresolved design question. 
- What concurrency and subworker defaults should we start with? A: During initial setup, ask the user, but the default for concurrent subworkers should be three and then it's up to them if they want to spin off any sub workers of their own. But we need to guide them to make sure they stay the That they only tackle small enough tasks. If the tasks are too hard or too big, then they need to roll it back up to the supervisor. And maybe the combo board that we're talking about needs a a blocked status to deal with that. Or they can explain that the task needs to be broken up into smaller bits.
- Which validation gates allow automatic merging, and which situations need escalation? A: For now, for simplicity, let's have no validation gates. Once the agent believes a task is complete, then it can merge everything in from its worktree. 
- How do we preserve task-level reversibility after integration and cleanup? A: We will just use best effort. If everything goes in from its work tree branch, at least it'll be kind of stuck together, and as long as we don't d get too far ahead, we can undo it. If we get too far ahead, then we'll just have to create a new task to reprogram it the way it should be and unwind it manually.
- What limits on retries or elapsed effort cause a worker to mark a task blocked? A: This will be up to the worker. If we have trouble with it, we can provide guidance. It just needs to know that if it runs out of options, it shall move the task into blocked. 
- How autonomous is dispatch? Does the orchestrator keep pulling ready tasks while the user is away, or only execute a batch selected together? A: The orchestrator could work in either mode. Actually, here are some good modes for the orchestrator. the orchestrator needs to be able to look at the upcoming tasks that are not done and be able to organize them by prioribility and doability. Like if one is blocking another one, then it can't be done. They need to be able to understand the Kanban board, whatever tool are you using sufficiently so that they can answer questions like that, or at least get a good idea. They need to be able to comment on what is in progress and its status. The orchestrator is to work with the user and flesh out details for For a given task, or break down a complex task into subtasks and create new tasks on the Kanban board and The user might just tell the orchestrator which task they want to work on, ask the orchestrator to recommend a task to or some tasks to work on or could tell the orchestrator you see the priorities, just go ahead and get things done. --- In the back of my mind, there is also a concern that we don't have a good model for what the Kanban board is. I'm going to start off with a bunch of markdown documents in a directory, but someone else might start with a list of to-dos, and someone else might start with JIRA, and someone else might start with GitHub. What are the unifying behaviors that we want to target? We need to be simple because I don't want to spend all day on this, but a to-do platform, a task tool is going to have tasks, have statuses, which are like columns in the Kanban board, have priorities, which in the Kanban board might just be how close it is to the top of the column, but it could also have priorities that are directly ascribed to it, P0, P1, whatever that's optional. Priorities are optional. Also, optional is whether a task can have sub-tasks. I know GitHub issues can have sub-issues. Whether tasks can be blocked on other tasks. These give the agent more things to work with. And so probably this skill will be written with a generic task application in mind, but if we have a real task application, then we can use a skill to help the agent become familiar with that and how it maps into this stuff. And we'll have some defaults built in as little sub-documents inside this task.
- What changes require user input? If a worker discovers it needs to change product behavior, architecture, or agreed scope, when should it stop and ask versus decide and report afterward? A: if anything directly opposes established specifications in the PRODUCT directory or ARCHITECTURE directory, Then it needs to mark the task as blocked and present its rationale in the issue or the ticket. So there needs to be like a way for the agents to do that. Something that is going to be visible by the orchestrator. So we need to make sure that it can see what it needs to see, and it not be all locked up in the work tree. Unless we tell the orchestrator that that's the place to look. Just whatever. We need to figure out a good answer there. I guess that's part of the previous conversation about the task tool. Every task will have a description but you also need to make it where the task can have comments from user or agent. That's a pretty general thing that task applications need. The worker shouldn't be over picky. For example, the worker needs to create new product and new architecture. So just the fact that it's missing doesn't mean that that task could be blocked pending a discussion. Instead, the worker needs to build something that is consistent with the style indicated in those two directories.
- Who coordinates integration? Workers can finish simultaneously, and worktrees do not isolate their edits to main or shared task documents. **A:** The worker owns integration of its completed task: it brings current `main` into its branch, resolves merge conflicts, runs tests and independent QA, and merges the completed branch into `main` when ready. There is no integration-slot concept; workers integrate directly and handle ordinary merge races/conflicts themselves. The orchestrator observes shared task bookkeeping rather than coordinating merges. If integration or conflict resolution needs a high-level product/architecture decision, the worker marks the task blocked and reports it visibly.
- What happens after interruption? When Pi closes or a worker crashes, should the next orchestrator session discover unfinished work and offer to resume it? A: Yes, that's a good idea. So, ideally the orchestrator needs to know which agent is currently assigned to a task and needs to have an indication of whether or not that agent is still working. This might be something analogous to the conversation we're having around the task application or the task tool. We also need a pluggable notion of agents and sub-agents, which will have Some basic principles about how sub-agents operate that generalize to most agent setups.
- What is the minimum task-system contract? Proposed baseline: list/read/create/update tasks, descriptions, status, and visible comments or an activity log. Priorities, subtasks, and dependency links are optional capabilities. Worker assignment and liveness could live in linked factory metadata if the task system cannot represent them. Is that enough, including for a single-page checklist? A: If some of the optional things don't exist, then the orchestrator will probably have to do a little bit more work and determine from context clues in this description: Whether one task should be blocked by another task, or one task is a subtask of another task, etc. Worker assignment is not going to be present in the task metadata. That needs to be independent. It could be duplicated in the task metadata if you can like assign a user or assign an agent to getting a task done. But I wanted that's optional. I want the orchestrator to be able to look up a task and in a different place look up what tasks are in flight and the agents that are working on them, and that's probably just going to be a file somewhere. The orchestrator is going to be the one that spins up the sub-agent to work on a particular task, and they are going to be on the same machine as the orchestrator, or at least addressable by the orchestrator. I mean, I guess he could spin up something in Tmux on a different server or something. But that's metadata that we want to track separately from the task and definitely agnostic of the task tool. As for the single page checklist, a lot of times I am working on a project and I don't want to be interrupted to create an official task. So I just want to drop something in a backlog somewhere. Let's introduce the notion of a root-level BACKLOG.md, which is a list of `- [ ]` items Where I can just drop stuff as I think of it. So we've also discovered another purpose of the orchestrator. I no longer want there to be a single document version of the task backlog as an official task tool that would go say in the place of a true Kanban board or Jira or GitHub board. It just serves as a quick note as defined here. If the user truly does not have any task tool, then we default to using the TASKS/KANBAN directory, which is a directory of Markdown documents and we can flesh out what they look like and their YAML schema at the top whenever. Whenever it's time to do a task to identify a new task, then the orchestrator should ask if we want to pull one off of the Kanban board, or do we want to look through the backlog and get some of them stuck into the Kanban board as official tasks. Once they have been stuck on the Kanban board, then the checkbox needs to be checked. If they're on the Kanban board, then it means that the task has been now richly described and is officially in the system. But it still might need more discussion when it's actually time to work. That's up to the orchestrator as well. Make sure you have a good feeling about how the orchestrator will choose new tasks. Typically, it's an ad hoc behavior where the orchestrator asks the user, what they want to do. The orchestrator can find a task, orchestrator can recommend tasks, the user could ask for a specific task to be done or a specific set of tasks. The orchestrator could also recommend that we pull some of the items off of the backlog and promote them to official tasks.
- Does “no validation gates” mean no additional approval or automated enforcement before merging, while workers still perform the agreed tests and independent QA before declaring completion? That is my proposed interpretation; it preserves the building practices without reintroducing merge-permission friction. A: We can definitely have automated enforcement before merging, such as running tools or GitHub hooks. Those are great ideas. Even GitHub actions might be appropriate here. But I just don't want to stop the workflow and complain to the user. It's much better to have the agent believe that it's finished and attempt to push the work through and then, like, fail on QA, correct the QA problem, and go ahead and complete it.
- During the setup, I want the agent, the orchestrator, to to walk the user through what all these documents mean. The product file, architecture, task files, etcetera. and in the behavior of getting a project done, if the user asks anything or shows a confusion, the orchestrator should be able to answer questions or even point out misconceptions about the process. Of course, the orchestrator does not need to be annoying with this and talk about it all the time.