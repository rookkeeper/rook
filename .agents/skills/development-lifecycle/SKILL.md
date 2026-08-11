---
name: development-lifecycle
description: >-
  Plan, implement, validate, review, merge, and clean up substantial Rook development work
  as one adaptable lifecycle.
---

# Rook development lifecycle

This is the main lifecycle for carrying substantial Rook development work from an idea to
its completion. It combines the planning, implementation-worktree, product and
architecture review, pull-request, merge, and cleanup practices that otherwise
live in separate instructions.

The process is strongly advised, not a rigid form. Adapt the detail to the work,
but keep the lifecycle record current. The lifecycle checklist is
[`references/WORKSTEPS.md`](references/WORKSTEPS.md); copy it into the change
directory as `WORKSTEPS.md` and check off each completed phase there.

The change directory normally contains:

- `WORKSTEPS.md` — the lifecycle checklist copied from
  [`references/WORKSTEPS.md`](references/WORKSTEPS.md).
- `BRAINSTORM.md` — optional exploration, using
  [`references/BRAINSTORM.md`](references/BRAINSTORM.md) as a starting point.
- `TODO.md` — the decisions and implementation checklist, using
  [`references/TODO.md`](references/TODO.md) as a starting point.
- `OUTCOMES.md` — the terse completion record added after merge.

Each lifecycle phase below ends by requiring its checkbox to be updated in
`WORKSTEPS.md`. The detailed work checklist belongs in `TODO.md`, not in
`WORKSTEPS.md`.

## Development lifecycle

### Orient to the project

Read `AS-BUILT-ARCHITECTURE/` to understand the current system shape, then read
the relevant files under `PRODUCT/` to understand the intended product behavior.
Become familiar with the boundaries before proposing or changing an
implementation. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Create the change directory and lifecycle record

Create `CHANGES/YYYY-MM-DD-topic-slug/` in the **main checkout**, not in a
worktree. Copy [`references/WORKSTEPS.md`](references/WORKSTEPS.md) into that
directory as `WORKSTEPS.md`. This makes the plan visible in the primary
checkout while it is being discussed. This is the record of the lifecycle
phases, not the detailed implementation plan. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Brainstorm to work

Brainstorming is an advised starting point, not a fixed form: every task has
different needs. When the problem or solution needs exploration, create
`BRAINSTORM.md` in the change directory from
[`references/BRAINSTORM.md`](references/BRAINSTORM.md). Use it to investigate
the problem, understand the relevant code and docs, compare options, record
risks and open questions, and make the work legible to the user and future
agents. Keep, remove, or add sections as the task requires. Bypass this phase
when the work is simple or obvious. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Record the decision and TODO

Create `TODO.md` in the change directory from
[`references/TODO.md`](references/TODO.md). Keep its three main sections:

1. **Context** — very concisely what we are doing and why it matters now.
2. **Decision details** — what we decided to do and why, based on the
   investigation or discussion.
3. **Work checklist** — actionable `- [ ]` bullets describing the work, which
   can be grouped into major categories when useful.

Keep `TODO.md` current as the implementation changes the plan. Once the
brainstorm and TODO are agreed, commit the change directory to the **main
checkout** before creating the implementation workspace. This is the planning
checkpoint: do not start implementation until that commit exists. When
complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Prepare the implementation workspace

After the planning commit exists on main, create a dedicated worktree and
feature branch from that main commit under `../_worktrees/`, copy `.env` into
it, and do the implementation there rather than in `main`. The committed
change directory will therefore also be present in the worktree, but its
primary planning record remains visible in main. Subsequent TODO and
WORKSTEPS updates belong to the implementation branch and are merged with the
code. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Implement and test

Implement the work in the workspace, updating `TODO.md` as decisions or scope
change. Add tests for new surface areas and regression tests for intermediate
bugs that should never recur. Run focused checks while working. When complete,
check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Maintain product and architecture documentation

Keep `PRODUCT/` and `AS-BUILT-ARCHITECTURE/` accurate without adding needless
churn for ordinary implementation details. If the product or architecture was
explicitly changed, update the documents to describe the new decision rather
than forcing the code to conform to an outdated description. Update relevant
package or root READMEs when structure or workflow changes. When complete,
check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Run final validation

Run the relevant tests, typechecks, builds, and smoke tests. Inspect the final
diff, whitespace, commit history, and TODO exit criteria. Remove abandoned
experiments and temporary implementation debris. When complete, check off this
phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Synchronize with main before submitting

Before pushing or opening or updating a PR, fetch `origin` and merge
`origin/main` into the feature branch. Resolve conflicts deliberately while
preserving the intended current work, then rerun the relevant checks. Do not
submit a branch that is behind or conflicting with `main`. When complete, check
off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Open and validate the PR

Draft a concise PR explaining what changed, why it matters, the relevant
product and architecture context, tests, and any rollout notes. Push the branch
and open the PR with `gh`. Confirm that required tests and GitHub Actions pass
and that GitHub reports the PR as mergeable.

If an action fails or merge is blocked, read the exact message from GitHub and
follow those instructions. Do not bypass, reinterpret, or work around the
failure. Make the requested changes and rerun the action. When complete, check
off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Merge with approval

Ask whether the developer wants the PR merged; opening a PR is not approval to
merge. After explicit approval, use a merge commit rather than squash or rebase
unless the developer specifically requests another method. Verify the PR is
actually merged and record the merge commit. When complete, check off this phase
in [`WORKSTEPS.md`](WORKSTEPS.md).

### Record outcomes and clean up

After merge, create a very concise `OUTCOMES.md` in the change directory. It
should focus on accomplishments and decisions, mention any missed, deferred,
or follow-up work, and include the merged PR plus the starting and ending
commits. Stop servers, clients, simulators, and other worktree resources.
Remove the implementation worktree, delete local and remote feature branches,
and remove isolated development state when it is no longer needed. Never reset
or overwrite dirty or local-only work on `main`. When complete, check off this
phase in [`WORKSTEPS.md`](WORKSTEPS.md).
