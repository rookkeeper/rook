## Todos (with estimates)
- [ ] Invite people to come watch - it'll be recorded and posted - AMA at the top of the hour. {20min}
- [ ] Create the skill that deploys itself and start working with it. - And Record it and answer QA {4 hours}
- [ ] Record demo of the final product {20 minutes}
- [ ] Create video edits including shorts {2 hours}
- [ ] Social Posts {1 hour} (shorter if this is automated)
- [ ] Blog post and Newsletter {4 hours}
- [ ] Social Posts {1 hour} (shorter if this is automated)
## Intended outcomes
- Get people into my recorded session.
- Post content on several channels (and get something to Eleanor and that other lady on LinkedIn)
- Run through process end-to-end
## Measured outcomes

## Learnings

---
## concepts
- Create this as a reusable, repo-agnostic agent skill that can set up a new repo and manage its tasks.
- Implement the factory and task-management system as one agent skill plus supporting scripts, rather than as a feature of one particular agent harness.
- Initial setup
	- Have a conversation about which task-management system this repo uses:
		- a directory of Markdown task files, an Obsidian Kanban implementation, GitHub Issues, Jira, or something analogous
		- create a repo-specific task-management skill customized from this skill for the chosen system
	- Create the requisite project files/directories:
		- PRODUCT - product goals and invariants
		- ARCHITECTURE - main modules and their APIs
		- BACKLOG.md at the project root - quick-capture `- [ ]` items, not the official task system
		- If using a Markdown-based task manager:
			- TASKS/KANBAN - Markdown task cards with board properties (source of truth)
			- TASKS/WIP - working task artifacts
			- TASKS/COMPLETE - completed task artifacts
	- If using a Markdown-based task manager:
		- store task documents in TASKS/KANBAN
		- store task state, ordering, history, and relationships in YAML headers
		- use Markdown task files with bulleted `- [ ]` checkboxes
		- put instructions at the top of the task-file template telling agents to keep the checklist up to date
		- make the task list usable directly by agents without requiring a particular UI
	- The task list described by the `obsidian-todo-board` skill and referenced by [the obsidian-kanban-board GitHub repo](https://github.com/rookkeeper/obsidian-kanban-board) is already useful for these purposes, or will be soon
	- GitHub, Jira, and other task-management systems should provide analogous behavior
	- The rest of this document uses the Markdown layout as its concrete example; the repo-specific skill adapts it to the chosen system
	- Have a conversation about logging and the development scripts directory during setup
	- Create a repo-specific AGENTS.md during setup (platform- and project-specific):
		- invariants, run/test, logging, code structure, QA affordances
		- QA section is required, not optional
	- Have a conversation about what we're actually building and create initial invariants
	- Have a conversation about the technologies to be used, but bring examples of best practices
		- Discuss testing approach up front since TDD so important
	- Have a conversation about the code structure - especially things like layered architectures that make it easier to test
- Every level of planning, hierarchically, looks the same
	- Brainstorm about the work to be done across dimensions such as:
		- UI/UX
		- architecture
		- ???
	- Create tasks:
		- store them in the TASKS/KANBAN folder
		- use frontmatter for properties like type, status, board_order, created, touched, source_issue, tags, and status_history
		- start them with a template that includes instructions for further planning, splitting, and TDD before implementation
		- Tasks shall record their relationships in their YAML headers:
			- subtasks, creating parent/child relationships
			- prerequisite tasks
			- priority, represented as a number or simply by location on the board
		- Agents can write these relationship fields directly even when using a different task-list implementation.
- Execution
	- The orchestrator is its own agent session:
		- works with the user to determine which tasks should be executed next
		- owns all human conversation
		- identifies candidate tasks, either at the user's direction or by using a script to recommend tasks that aren't blocked
		- considers a task ready when it has no known blocking tasks and is reasonably well fleshed out
		- works with the user to flesh out any task that is not ready before assigning it
		- chooses tasks that are unlikely to overlap; parallelism is limited
		- tracks which tasks are in flight and their approximate status
		- marks tasks as "in_progress" in whatever task-management system is being used
			- for Markdown task managers, this means changing the task file's YAML header
		- uses whatever sub-agent mechanism the current harness provides to start workers
	- Worker executes task
		- runs in a separate agent session
		- receives the task and context from the orchestrator
		- creates a worktree, perhaps in a special Git-ignored `.worktrees` directory
		- creates a new WIP directory in the main repository called `{date}-{task_id}-{task_name}`
		- adds and manages the task files in that WIP directory
		- **Future work: determine how the orchestrator hands off context and worker questions**
		- fleshes out the task, including the TDD tests and tracer-bullet implementation, using templates in its WIP/task directory:
			- brainstorm.md - makes sure the user and orchestrator agree in advance on any changes
			- task.md - a Markdown task file with bulleted checkboxes listing all tasks in the order they need to be completed
		- decides whether the task is one pull-request-sized unit
		- if the task is too complex, tells the orchestrator why and asks it to create more todos for the Kanban board
		- if the task is appropriately sized, executes it, including delegating to sub-agents; sub-agents cannot create their own worktrees or further subdivide the work
		- enters a loop of testing + scripted QA affordances until everything passes (prefer scripted affordances over computer-use; computer-use only if nothing else works)
		- if a merge, test, or QA step fails, iterates to fix it
		- if it is not fixable, or iteration goes on too long, marks the task as blocked
		- once complete:
			- writes outcome.md into the main repository's TASKS/WIP directory
			- merges the implementation and tests into main; the merge must succeed
			- updates the task state to "complete" in main
			- moves the task artifacts to TASKS/COMPLETE
			- keeps the original task card in TASKS/KANBAN and links it to the corresponding TASKS/COMPLETE directory
			- makes a final commit in main for the task-state and artifact changes
			- cleans up the worktree
- Always on concepts:
	- TDD
	- tracer bullets rather than implementing one layer at a time
	- basic logging for debugging
	- easy qa affordances
		- accessability features exposed for mac apps so the UI can be navigated programmatically
		- what about webapps?
		- what about other apps
		- rule: if you touch UI, keep these working; QA must check the app by different means than the code that built it — a person/agent looking and clicking, not just tests passing
		- prefer scripted QA affordances over computer-use; computer-use only if nothing else works
		- if QA is difficult or impossible, mark the task blocked and push the missing QA requirements or decisions back to the user
		- Mac: Accessibility + OSA/JXA scripts to click/manipulate; iPhone: same via Accessibility IDs; Web: stable selectors (data-testid) + helper script to list/click elements; all: scripted screenshots to verify look/layout
	- a scripts directory to rule them all for common development operations:
		- run.sh
			- runs the development environment
			- watches files when applicable
			- opens the application or website when applicable
		- test.sh
			- runs the tests
		- other common utilities, such as querying the database or creating mock data
- Special domains
	- server - layered API -> service -> repository -> datastore
	- HTML frontend - ???
	- native Mac frontend - ???
	- database - ???
	- ???
- Periodic audits and cleanup - Every 1 week (?) 
	- review the invariants in the PRODUCT folder and make sure they make sense and don't contradict and don't contain AI Slop (like making note of things that have been removed from the doc)
	- review the design in the ARCHITECTURE folder and make sure
		- the approach tends toward large, well defined modules, no leaky abstractions, every module takes care of appropriately grouped concerns
		- the architecture is layered for good testability and ease of understanding
		- the architecture follows that special domain descriptions (above)
	- review the code and make sure 
		- it matches the code matches the architecture doc - no extra high-level modules not mentioned in ARCHITECTURE, no mismatches in existing architecture
		- it has no left-over "compatibility" code - places where I changed my mind and pulled out code in the past - the exception is if we have customers who are using the old code paths, in this case it needs to be detailed in PRODUCT and ARCHITECTURE
		- ???

## platform/project-specific QA (into project AGENTS.md)
- Mac
	- OSA/JXA skill for click/manipulate via Accessibility
	- screenshots: app window only, never full screen
	- worked example (SwiftUI Mac app; may or may not generalize — evaluate later):
		- instrument: .accessibilityIdentifier("screen.control") on every Button/Picker/Toggle/TextField/Stepper/Slider; UISectionHeader(actionIdentifier:) param for link buttons; dynamic IDs keyed by template ID / draft UUID
		- menu commands unidentifiable (SwiftUI API gap) → keystrokes instead
		- screenshots: screencapture -x -l <CGWindowID>; window ID via CGWindowListCopyWindowInfo filtered by PID; never fullscreen
		- silent start: open --args --background → .accessory policy, skip activate(ignoringOtherApps:); no bounce, no focus steal; normal launches unchanged
		- navigate: AX helper scripts (dump/click/select): find by kAXIdentifierAttribute, AXPress buttons, AXSelected on AXRow ancestor for sidebar; verify by re-dump, never assumption
		- permissions: grant Accessibility + Screen Recording + Automation → System Events; note Screen Recording needs full relaunch after granting
		- known limits (measured): editor + completion identifiers compiled in but not observed live; context menus and hidden-window capture need a visible window (hidden capture returns stale frames)
		- direction: run OSA-based verification on a separate machine so it doesn't disturb the user

## etc 
- Always waiting and asking me to merge back into main is terribly annoying. Determine when I can to this automatically - hint - most of the time if we use worktrees and branches because it's pretty easy to unwind the changes if need be

- iPhone (if applicable)
	- same via Accessibility IDs
	- screenshots: app only
- Web
	- ???

## etc


## todos
- [ ] Plan content
	- [ ] Record the planning and initial creation, combining what I learned from Greg, the other person I watched on YouTube (saved in the Reads vault), and my own ideas
	- [ ] Plan a follow-up explanation video showing how it actually works and how I use it
- [ ] ?

## future work
- [ ] Make the task-list skill fully usable from Markdown files without requiring Obsidian.
- [ ] Define how worker questions are routed through the orchestrator.
- [ ] Define practical limits for iteration before blocking a task.
- [ ] Define domain-specific workflows.
