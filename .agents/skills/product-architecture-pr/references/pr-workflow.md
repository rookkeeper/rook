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
- before opening or updating the PR, fetch `origin`, merge `origin/main` into the feature branch, resolve conflicts, run the relevant checks, and verify the branch is clean and mergeable
- open a PR after code/docs/tests are ready

## After opening the PR

Do not assume it should be merged immediately.

Ask the developer whether they want you to merge it now.

If they say yes:
- prefer a merge commit unless the developer explicitly requests squash or rebase
- avoid `gh pr merge --delete-branch` when the working tree is dirty
- if local branch switching is blocked by unrelated local changes, stash those unrelated files first

## Fast local sync after merge

When the developer wants local `main` updated after merge, **do not clobber local-only commits or tracked changes on local `main`**. Never use `git reset --hard origin/main` as the default sync step after a PR merge.

Safe default:

1. `git switch main`
2. `git fetch origin`
3. inspect divergence:
   - `git log --oneline main..origin/main`
   - `git log --oneline origin/main..main`
4. if local `main` has **no local-only commits**, use:
   - `git pull --ff-only`
5. if local `main` **does have local-only commits**, preserve them and integrate non-destructively:
   - either `git merge origin/main`
   - or create an integration branch and merge there first if conflict risk is high
6. only stash unrelated dirty files if they block branch switching or merging, then restore them afterward

The goal is to **merge remote `main` into local `main`, not overwrite local `main` with remote state**.

If the developer explicitly asks to discard local `main` commits, confirm that intent before doing anything destructive.
