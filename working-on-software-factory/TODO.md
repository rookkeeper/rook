# Factory skill — document plan

- [ ] `SKILL.md` — generic entry point
  - [ ] Setup vs ongoing orchestration; load relevant references only.
  - [ ] Human owns direction; orchestrator owns conversation, dispatch, integration.
  - [ ] Task-tool/harness agnostic; defaults customizable.
  - [ ] If a relevant reference is missing or underspecified, notice it, tell the user, and help fill it out during setup or when discovered later.

- [ ] `references/setup.md` — guided project setup
  - [ ] Explain PRODUCT, ARCHITECTURE, AGENTS, tasks, artifacts.
  - [ ] Create root-level `BACKLOG.md` for quick-capture items.
  - [ ] Discuss goals/invariants, stack/layers, TDD, QA, logging, scripts.
  - [ ] Establish PRODUCT/, ARCHITECTURE/, AGENTS.md; reconcile existing docs.
  - [ ] Select task/harness adapters; customize repo-specific task skill.
  - [ ] Identify missing/underspecified adapters and help the user fill them out; do not silently assume guidance.
  - [ ] Agree worker/subworker limits; default three workers.
  - [ ] Git-ignore `.worktrees/`; configure storage, registry, scripts.

- [ ] `references/orchestrator.md` — daily workflow
  - [ ] Inspect tasks, backlog, worker registry; recover interrupted work.
  - [ ] User-directed, recommendations, or authorized autonomous dispatch.
  - [ ] Promote backlog notes; clarify/split tasks; assess readiness/overlap.
  - [ ] Work with user to settle high-level scope before dispatch: product behavior/user experience, UI, architecture, and tracer-bullet design.
  - [ ] Make each assigned task sufficiently specified for a worker to proceed unaided.
  - [ ] Assign workers; track progress; route only implementation-level questions; explain process as needed.
  - [ ] Observe integration/shared bookkeeping; workers integrate their own completed work; no worker-to-worker coordination.

- [ ] `references/worker.md` — one task lifecycle
  - [ ] Receive an agreed, sufficiently detailed task; isolated branch/worktree; visible working artifacts.
  - [ ] Do not own high-level product UX/UI, architecture, or tracer-bullet design; escalate missing decisions to orchestrator.
  - [ ] Refine only implementation-level checklist/tests as needed; escalate oversized tasks.
  - [ ] Implement, test, independent QA; update docs/checklist.
  - [ ] Contradicts PRODUCT/ARCHITECTURE → blocked + visible rationale.
  - [ ] Missing specification alone → proceed consistently; exhausted options → blocked.
  - [ ] Report results for orchestrator-coordinated integration.

- [ ] `references/integration.md` — finish without permission friction
  - [ ] Worker owns task integration: bring current `main` into its branch, resolve conflicts, run tests and independent QA, then merge the completed branch into `main`.
  - [ ] No integration-slot concept; workers integrate directly and handle ordinary merge races/conflicts themselves.
  - [ ] Automated checks allowed; failures → worker fixes/retries, escalates when stuck.
  - [ ] No routine human merge gate; remote push authorization separate.
  - [ ] Worker records outcome, completes task, archives artifacts, cleans up worktree/resources.
  - [ ] Best-effort undo; larger reversals become follow-up tasks.

- [ ] `references/task-management/README.md` — generic task contract
  - [ ] Tasks: descriptions, statuses, visible comments; list/read/create/update.
  - [ ] Optional priority/subtasks/dependencies; infer from context when absent.
  - [ ] Quick-capture root-level `BACKLOG.md` distinct from official task system.
  - [ ] Promotion checkbox means captured officially, not work completed.
  - [ ] Worker registry separate; task-side assignment duplication optional.
  - [ ] If a task-system adapter is missing or underspecified, tell the user and help define it during setup or later.

- [ ] `references/task-management/directory-of-markdown-docs.md` — default adapter
  - [ ] KANBAN cards: YAML state/order/relationships/history + description/comments.
  - [ ] Main-checkout WIP artifacts; maintained detailed checklist.
  - [ ] COMPLETE artifacts; original card retained with links.
  - [ ] Human/agent inspect same files; define minimal schema/templates.
  - [ ] If guidance is insufficient for the user's Markdown workflow, tell the user and help complete it.

- [ ] `references/task-management/github.md`, `jira.md` — placeholders
  - [ ] Explicit: needed integration → discuss/specify with user first.
  - [ ] No single-page task adapter; single page is quick capture only.

- [ ] `references/agent-harness/README.md` — generic worker contract
  - [ ] Start, identify, inspect status, deliver context/questions/results, stop/resume.
  - [ ] Persistent independent registry: task, agent/session, worktree, liveness lookup.
  - [ ] Shared human-visible status; interrupted/stale worker recovery.
  - [ ] Harness-specific recommendations; user-selected nesting/concurrency.
  - [ ] If the user's harness lacks guidance or the contract is underspecified, tell the user and help fill it out.

- [ ] `references/agent-harness/pi.md` — first working adapter
  - [ ] Evaluate official subagent example vs tmux sessions.
  - [ ] Dummy workers: progress, question, completion, failure, interruption/resume.
  - [ ] Document selected mechanism + registry/status integration.
  - [ ] If Pi guidance remains insufficient, tell the user and help fill it out.

- [ ] `references/agent-harness/claude.md`, `opencode.md` — placeholders
  - [ ] Explicit: needed integration → discuss/specify with user first.
  - [ ] When the user uses one of these harnesses, notice missing guidance and help develop it rather than silently proceeding.

- [ ] `references/how-we-build/README.md` — customizable defaults
  - [ ] TDD; thin end-to-end tracer bullets; testable boundaries.
  - [ ] Describe the user's convention: optional root-level `scripts/` directory as a language-agnostic, makefile-like index of common development commands.
  - [ ] Distinguish the project's root `scripts/` from scripts inside this factory skill.
  - [ ] Logging, standard run/test/QA scripts; docs kept current.
  - [ ] Setup may revise or replace methodology.
  - [ ] If guidance is missing or underspecified for the project, tell the user and help fill it out.

- [ ] `references/how-we-build/qa.md` — independent product verification
  - [ ] Exercise actual product; code review/tests alone insufficient.
  - [ ] Scripted interaction/screenshots; browser/computer use as needed.
  - [ ] If QA is difficult or impossible, mark task blocked and push QA requirements/decisions back to the user.
  - [ ] QA affordances maintained when UI changes; project specifics in AGENTS.md.

- [ ] `references/how-we-build/{servers,services,frontends,native-applications}.md`
  - [ ] Domain boundaries, testing patterns, logging, runnable QA.
  - [ ] Start terse; if guidance is underspecified, tell the user and help fill it out during setup or when the domain is recognized.

- [ ] `references/audits.md` — periodic maintenance
  - [ ] PRODUCT clarity/invariants; architecture/code alignment/testability.
  - [ ] Remove abandoned compatibility/debris; retain justified customer paths.

- [ ] `templates/` — small starter documents
  - [ ] PRODUCT/README.md and ARCHITECTURE/README.md explain each directory's purpose.
  - [ ] PRODUCT and ARCHITECTURE templates instruct the agent to tell the user to add documents when the directory is empty.
  - [ ] PRODUCT, ARCHITECTURE, AGENTS skeletons; required QA section.
  - [ ] `BACKLOG.md` template explains quick capture vs official `TASKS/` work.
  - [ ] `BACKLOG.md` includes one generic example beginning exactly `- [ ] Create README for this repo`.
  - [ ] Repo task-management skill; task card.
  - [ ] brainstorm.md, task.md, outcome.md; checklist-maintenance instructions.

- [ ] Skill-internal `scripts/` + usage README — only necessary factory mechanics
  - [ ] Worker launch/status/registry; harness-specific where needed.
  - [ ] Worktree/integration helpers; task helpers only where useful.
  - [ ] Temp-repo tests; concurrent completion, failure, restart, cleanup.
  - [ ] If project-specific scripts or QA mechanics are underspecified, tell the user and help define them.

- [ ] End-to-end check — pause before starting
  - [ ] Tell the user the factory is ready for this review; wait while the user increases the model and requests workflow analysis.
  - [ ] Think through typical development workflows with the stronger model; identify missing coverage.
  - [ ] Setup → capture/promote → dispatch → implement/QA → merge/archive.
  - [ ] Human can inspect same tasks, assignments, progress as orchestrator.
  - [ ] Reconcile rough outline + latest brainstorming; no obsolete approval gates.
