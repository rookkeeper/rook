---
name: outlining-work
description: Create and maintain CHANGES work-planning documents for real chunks of work in the Rook repo. Use when the user wants to plan, scope, brainstorm, or outline implementation work before or during execution.
---

# Outlining work in `CHANGES/`

Use this skill when the user is asking for a real chunk of work to be planned or tracked in this repo.

A "real chunk of work" means more than a tiny one-off tweak: a bug investigation, refactor, feature, migration, cleanup, workflow change, or any implementation effort that we expect to think about, execute in steps, or hand off.

## Core rule

When we are talking about a real chunk of work, create a subdirectory under `CHANGES/` named:

`YYYY-MM-DD-topic-slug`

Use the current date and a short, descriptive topic slug.

Examples:

- `CHANGES/2026-08-08-capability-workspace-manager-split/`
- `CHANGES/2026-08-08-environment-join-run-interruption/`

If the user already has a topic/directory in mind, use that instead of inventing a new one.

## File conventions

Inside that directory, use one or both of these files depending on the stage of work:

- `BRAINSTORM.md`
- use when we are still exploring ideas, tradeoffs, constraints, or possible shapes
- keep it open-form and easy for the user to edit, react to, and paste into
- `TODO.md`
- use when we are ready to track actionable work
- this is the execution document and should be detailed enough that a sub-agent could pick it up and complete the work

Sometimes we will skip `BRAINSTORM.md` and go straight to `TODO.md`.

## Brainstorm documents

When creating `BRAINSTORM.md`:

- keep it lightweight and collaborative
- capture candidate approaches, questions, risks, and decisions
- prefer plain language over formal structure
- let the user reshape it freely
- once the direction is clear, either create `TODO.md` or update it with the conclusions

## Before writing the plan

Before creating or fleshing out the document:

1. Read the relevant code and docs.
2. Make sure you understand the current behavior and boundaries.
3. Look at nearby tests and adjacent modules so the plan reflects how the repo actually works.
4. Then write the planning document.

Do not write a fake plan based only on the user's rough description when the code needs to be inspected first.

## `TODO.md` required shape

A `TODO.md` should usually contain these sections, in this order.

### 1. Title

Use a short descriptive title.

### 2. Context

Start with a concise explanation of:

- what is changing
- why we are doing it
- what part of the system it affects
- any key constraints or non-goals

This should orient someone quickly.

### 3. Details

Then add more implementation detail as needed so a sub-agent could execute the work. Depending on the task, include things like:

- current behavior
- desired behavior
- architectural boundaries
- important files/modules
- tricky edge cases
- migration or cleanup expectations
- decisions already made with the user

The top can be short; this section is where the practical detail goes.

### 4. Steps

Add an implementation checklist using only `- [ ]` bullets.

These should be concrete, actionable steps. They are not just themes; they should describe the actual work to do.

Keep this checklist up to date while executing the work:

- mark finished items as `- [x]`
- add newly discovered necessary work
- remove steps only when they are truly no longer needed

#### Always include these end-of-file checklist items

At the end of the `TODO.md`, include the recurring wrap-up work as `- [ ]` items in the checklist flow (either in the main steps or in a dedicated final steps subsection):

- tests/build/typecheck appropriate to the change run and pass
- review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code
- remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around
- update `AS-BUILT-ARCHITECTURE/` as needed
- update `PRODUCT/` as needed

Do not treat compatibility cleanup as optional polish. It is part of finishing the work.

### 5. Exit criteria

Add an `Exit criteria` section that also uses only `- [ ]` bullets.

These are not a copy of the steps. They describe what must be true for the work to count as done.

Examples of good exit criteria:

- behavior is correct from the user's point of view
- old paths/shims are gone
- docs reflect the final architecture
- tests cover the intended behavior

## Executing the plan

Once the planning document is in good shape and we are moving from planning to implementation:

1. Commit the `CHANGES/` planning files to the main branch.
- This is one of the rare cases where you do **not** need to ask the user before committing.
- The goal is to preserve the plan/brainstorming work on main before implementation begins elsewhere.
2. Create a git worktree in `../_worktrees/` for the implementation work.
- For issue-sized work, use a descriptive name like `issue-46-tabs`.
- If there is no issue number yet, use a concise descriptive slug consistent with the planned work.
3. Copy `.env` from the main repo into the worktree:
- `cp ../rook/.env ../_worktrees/<worktree-name>/.env`
4. Do the implementation work in the worktree, not in the main checkout.

While executing the work:

- keep the `TODO.md` current as you go
- mark completed items with `- [x]`
- add newly discovered required work
- leave a clear record when something is blocked or deferred
- treat the document as the current truth of where the work stands

### Execution stopping conditions

Stop the current implementation pass when of these are true:

- all todo items are complete or you have reached a natural stopping point where no more boxes should be checked yet
- you are stuck and need the user's help or a decision

In all of those cases, use the macOS `say` command to tell the user where things stand. Make it a short sentence followed by a period and run it in the background.

Examples:

```bash
say 'The workspace split is ready for review.' &
say 'I am blocked on the restart behavior.' &
```

After that, the user will review the work. If things look good, proceed with the PR flow using the `product-architecture-pr` skill. If things do not look good yet, then work with the user to brainstorm and update the `CHANGES/` docs and continue working.

## Post execution

Once Jon is satisfied, and the PR has been created and merged into `main`, do the final cleanup work for that `CHANGES/<date>-<topic>/` directory.

Add an `OUTCOMES.md` file in the same `CHANGES/<date>-<topic>/` directory.

Keep `OUTCOMES.md` very short. It should:

- point to the merged PR
- briefly explain what happened
- call out the start commit
- call out the end commit

This is mainly a completion marker so we can scan `CHANGES/` later and quickly tell which work items were fully carried through to merge.

After that, clean up the implementation workspace/worktree if it is no longer needed.
