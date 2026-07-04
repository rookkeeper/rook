# PR workflow for Rook

Use this flow when the developer asks to create, ship, open, or merge a pull request, or when a large chunk of work tied to an issue is complete.

## Default grouping rule

- Large chunks of work associated with an issue should usually be grouped into a PR.
- Treat the PR as the reviewable unit and decision record for that issue slice.
- Do not push large issue work directly to `main` unless the developer explicitly asks for that.

## Before you branch or push

Ask the developer whether this work should go through a branch / PR flow or be pushed directly to `main` / `master`.

If they choose PR flow:
- do not push directly to `main` / `master`
- create a branch for the issue-sized chunk
- open a PR after code/docs/tests are ready

## After opening the PR

Do not assume it should be merged immediately.

Ask the developer whether they want you to merge it now.

If they say yes:
- prefer squash merge
- avoid `gh pr merge --delete-branch` when the working tree is dirty
- if local branch switching is blocked by unrelated local changes, stash those unrelated files first

## Fast local sync after merge

When the developer wants local `main` updated after merge, this is the fastest safe path when local `main` may have drifted:

1. stash unrelated dirty files
2. `git switch main`
3. `git fetch origin`
4. preserve old local main if needed (for example `git branch backup/main-before-sync`)
5. `git reset --hard origin/main`
6. restore the stashed local files

Use `git pull --ff-only` only when you are confident local `main` has not diverged.
