---
name: development-lifecycle
description: Plan, implement, validate, review, merge, and clean up substantial Rook development work as one adaptable lifecycle.
---

# Rook development lifecycle

This is the main lifecycle for carrying substantial Rook development work from an idea to its completion. It combines the planning, implementation-worktree, product and architecture review, pull-request, merge, and cleanup practices that otherwise live in separate instructions.

The process is strongly advised, not a rigid form. Adapt the detail to the work, but keep the lifecycle record current. The lifecycle checklist is [`references/WORKSTEPS.md`](references/WORKSTEPS.md); copy it into the change directory as `WORKSTEPS.md` and check off each completed phase there.

We often use brainstorming to figure out what we want to do and how we want to do it. Sometimes the path is obvious and we can skip it, but always check with the developer before creating `TODO.md` to make sure we agree on the approach.

The change directory normally contains:

- `WORKSTEPS.md` — the lifecycle checklist copied from [`references/WORKSTEPS.md`](references/WORKSTEPS.md).
- `BRAINSTORM.md` — optional, explicitly provisional exploration, using [`references/BRAINSTORM.md`](references/BRAINSTORM.md) as a starting point.
- `TODO.md` — the agreed decisions and implementation checklist, using [`references/TODO.md`](references/TODO.md) as a starting point; do not create it before the decision gate.
- `OUTCOMES.md` — the terse completion record added after merge.

Each lifecycle phase below ends by requiring its checkbox to be updated in `WORKSTEPS.md`. The detailed work checklist belongs in `TODO.md`, not in `WORKSTEPS.md`.

## Development lifecycle

If this lifecycle list changes materially—such as adding or removing a step, or substantially changing a step—update `references/WORKSTEPS.md` in the same change so newly copied lifecycle records stay in sync.

### Orient to the project

Read `AS-BUILT-ARCHITECTURE/` to understand the current system shape, then read the relevant files under `PRODUCT/` to understand the intended product behavior. Become familiar with the boundaries before proposing or changing an implementation. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Create the change directory and lifecycle record

Create `CHANGES/YYYY-MM-DD-topic-slug/` in the **main checkout**, not in a worktree. Copy [`references/WORKSTEPS.md`](references/WORKSTEPS.md) into that directory as `WORKSTEPS.md`. This makes the plan visible in the primary checkout while it is being discussed. This is the record of the lifecycle phases, not the detailed implementation plan. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Brainstorm to work

Brainstorming is an advised starting point, not a fixed form: every task has different needs. When the problem or solution needs exploration, create `BRAINSTORM.md` in the change directory from [`references/BRAINSTORM.md`](references/BRAINSTORM.md). Use it to investigate the problem, understand the relevant code and docs, compare options, record risks and open questions, and make the work legible to the user and future agents.

Keep the brainstorm explicitly provisional. Distinguish user requirements, observations, agent suggestions, decisions, and unresolved questions. Recommendations in the brainstorm are not decisions, and a preferred direction is not an agreed direction. Update the document as the conversation evolves. Do not create `TODO.md`, a planning commit, an implementation workspace, or code based only on the agent's recommendation. Bypass this phase when the work is simple or obvious. This phase is complete only when the developer confirms the direction or explicitly asks to proceed without further exploration; until then, leave its checkbox unchecked in [`WORKSTEPS.md`](WORKSTEPS.md).

### Record the decision and TODO

Wait for an explicit decision gate: the developer must confirm the direction, approve the stated scope, or clearly instruct the agent to proceed with a named approach. Do not treat silence, a request for more brainstorming, or an unchallenged suggestion as approval. If important questions remain open, continue brainstorming instead of creating `TODO.md`.

Only after that agreement, create `TODO.md` in the change directory from [`references/TODO.md`](references/TODO.md). Keep its three main sections:

1. **Context** — very concisely what we are doing and why it matters now.
2. **Decision details** — only what was explicitly agreed, including important boundaries and non-goals; do not present hypotheses as decisions.
3. **Work checklist** — actionable `- [ ]` bullets describing the agreed work, which can be grouped into major categories when useful.

Keep `TODO.md` current as the implementation changes the plan. Once the brainstorm and TODO are agreed, commit the change directory to the **main checkout** before creating the implementation workspace. This is the planning checkpoint: do not start implementation until that commit exists. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Prepare the implementation workspace

After the planning commit exists on main, create a dedicated worktree and feature branch from that main commit under `../_worktrees/`, copy `.env` into it, and do the implementation there rather than in `main`. The committed change directory will therefore also be present in the worktree, but its primary planning record remains visible in main. Subsequent TODO and WORKSTEPS updates belong to the implementation branch and are merged with the code. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Implement and test

Implement the work in the workspace, updating `TODO.md` as decisions or scope change. Add tests for new surface areas and regression tests for intermediate bugs that should never recur. Run focused checks while working. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Mark compatibility surfaces

Before finalizing implementation or opening a PR, inspect every changed file—not just source code—for legacy shims, fallback paths, migration bridges, retained file formats, deprecated configuration, compatibility documentation, or other behavior preserved for existing users. This includes code, tests, documentation, configuration, manifests, schemas, workflows, and scripts.

Mark each retained compatibility surface with a valid, format-appropriate annotation whose marker text is exactly:

```text
THIS IS FOR BACKWARDS COMPATIBILITY
```

Follow the marker with an explanation of what is preserved and why it remains. Use comments or admonitions valid for the file format; never invalidate configuration or data files to add a marker. If a format has no safe annotation syntax, record the surface in the PR review notes. If none are present, record that explicitly. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Maintain product and architecture documentation

Keep `PRODUCT/` and `AS-BUILT-ARCHITECTURE/` accurate without adding needless churn for ordinary implementation details. If the product or architecture was explicitly changed, update the documents to describe the new decision rather than forcing the code to conform to an outdated description. Update relevant package or root READMEs when structure or workflow changes. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Run final validation

Run the relevant tests, typechecks, builds, and smoke tests. Inspect the final diff, whitespace, commit history, and TODO exit criteria. Remove abandoned experiments and temporary implementation debris. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Synchronize with main before submitting

Before pushing or opening or updating a PR, fetch `origin` and merge `origin/main` into the feature branch. Resolve conflicts deliberately while preserving the intended current work, then rerun the relevant checks. Do not submit a branch that is behind or conflicting with `main`. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Open and validate the PR

Draft a concise PR explaining what changed, why it matters, the relevant product and architecture context, tests, and any rollout notes. Push the branch and open the PR with `gh`. Confirm that required tests and GitHub Actions pass and that GitHub reports the PR as mergeable.

If an action fails or merge is blocked, read the exact message from GitHub and follow those instructions. Do not bypass, reinterpret, or work around the failure. Make the requested changes and rerun the action. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Merge with approval

Ask whether the developer wants the PR merged, and get explicit consent immediately before running the merge; opening a PR is not approval to merge. After explicit approval, use a merge commit rather than squash or rebase unless the developer specifically requests another method. Verify the PR is actually merged and record the merge commit. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

### Record outcomes and clean up

After merge, create a very concise `OUTCOMES.md` in the change directory. It should focus on accomplishments and decisions, mention any missed, deferred, or follow-up work, and include the merged PR plus the starting and ending commits. Stop servers, clients, simulators, and other worktree resources. Remove the implementation worktree, delete local and remote feature branches, and remove isolated development state when it is no longer needed. Never reset or overwrite dirty or local-only work on `main`. When complete, check off this phase in [`WORKSTEPS.md`](WORKSTEPS.md).

## Tangential development tasks

### Updating skills during worktree work

If a task completed in a worktree requires an instruction or skill change, update the worktree version of that skill so the change travels with the implementation branch. Sometimes an observation from worktree behavior is a general correction to the shared process; in that case, update the skill in `main` instead. If it is unclear whether the change belongs to the worktree or `main`, ask the developer before editing it.
