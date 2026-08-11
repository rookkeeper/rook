---
name: product-architecture-pr
description: >-
  Create and ship Rookery pull requests focused on product and architecture
  impact, not low-level code diffs. Reads all PRODUCT/ docs, classifies how
  changes align with product and architecture specs, updates documentation,
  and opens PRs via branch push (never direct to main). Use when the user asks
  to create, open, or ship a pull request; finish a feature; or merge work —
  never pushing directly to main.
---

# Product & Architecture Pull Requests

Rookery PRs should be easy to skim. They should explain **what changed, why it matters, and how it fits the product/architecture** without reading like a formal ADR. The code diff is still the source of low-level detail; the PR should surface the important chunks fast.

Read [`references/pr-workflow.md`](./references/pr-workflow.md) when deciding whether to use a PR, when opening a PR for a large issue-sized chunk, and when handling post-merge local sync.

## Hard rules

- **Before creating a branch or pushing, ask the developer whether this work should go on a branch / PR flow or be pushed directly to `main` / `master`.** Do not assume.
- **Large chunks of work associated with an issue should usually go into a PR.** Treat the PR as the grouping/review unit unless the developer explicitly asks to skip that flow.
- If the developer says to use a branch / PR flow, then do not push directly to `main` / `master`.
- **Read every file under `PRODUCT/`** before writing the PR. (You should ignore PRODUCT_CHANGES, as it is for work in progress scratch documentation, todos, and status.) Treat drafts and placeholders as current intent until superseded.
- **Update `PRODUCT/` in the same PR** when the change introduces, modifies, or removes a product or architecture idea - but don't be overly nit-picky because we don't want too much documentation churn. Most of product documents are quite high-level, so we don't need low-level product changes. See [AGENTS.md](../../../AGENTS.md).
- **Mark backward-compatibility surfaces before creating the PR.** Inspect every changed file—not just source code—for legacy shims, fallback paths, migration bridges, retained file formats, deprecated configuration, compatibility documentation, or other behavior preserved for existing users. This includes code, tests, documentation, configuration, manifests, schemas, workflows, and scripts. Mark each relevant block, section, or entry with a format-appropriate annotation whose marker text is exactly `THIS IS FOR BACKWARDS COMPATIBILITY`, followed by an explanation of what is being preserved and why it remains. Use comments or admonitions that are valid for the file format; never make a config or data file invalid just to add a marker. If a format has no safe annotation syntax, record the compatibility surface in the PR review notes instead. If none are present, explicitly record that too.
- **Do not ship** until product/architecture alignment sections are complete and doc updates are included (or explicitly marked N/A with reason).
- If the **why this matters** section of the PR is missing or weak, **stop and ask the developer** before opening the PR.
- Prefer short, casual, scannable PR prose over exhaustive writeups. Use plain language, short bullets, and only enough context for a reviewer to orient quickly.
- Do not include an "approaches considered" section by default. Only mention alternatives when there was a real tradeoff the reviewer should understand.
- **After creating a PR, ask the developer whether they want it merged now.** Do not assume that opening the PR implies immediate merge.
- **Prefer a merge commit when merging a PR.** Preserve the individual branch commits unless the developer explicitly asks for squash or rebase. Do not treat squash merging as the default.
- **Resolve PR merge conflicts proactively.** If a PR is conflicting or behind its base, fetch the base branch, merge it into the feature branch, resolve conflicts while preserving both changes, run the relevant checks, commit the merge, and push the updated branch. Do not force-push or hide conflict resolution through a squash.

## Workflow

Copy and track:

```
- [ ] 0. Ask whether to use branch/PR flow or push directly to main/master
- [ ] 1. Read all PRODUCT/ docs
- [ ] 2. Analyze branch diff (product + architecture lens)
- [ ] 3. Inspect and mark backward-compatibility surfaces across code, documentation, configuration, and other changed files
- [ ] 4. Classify product & architecture alignment
- [ ] 5. Update PRODUCT/ (and READMEs if structural)
- [ ] 6. Draft PR title + body (template below)
- [ ] 7. Validate required sections; ask developer if gaps
- [ ] 8. If using branch/PR flow, push branch and open PR with gh
```

### 1. Read all PRODUCT/ docs

List and read every markdown file under `PRODUCT/`. Note for each:

- Stated goals, open questions, and placeholders
- Concepts this branch touches or contradicts
- Cross-links between docs (e.g. skills ↔ environment bridge)

Skim code only enough to map **abstract** impact: major components, patterns, APIs, event/schema shapes — not line-by-line review.

### 2. Analyze the change

Compare the branch to the default branch (`git diff`, commit history, chat context). Summarize:

- **What changed** — the main behavior or capability added/changed
- **Why it matters** — the user or system payoff
- **Anything to watch** — tradeoffs, follow-ups, risks, or rollout notes
- **Technical footprint** (high level, optional) — e.g. new `EnvironmentManager` callback, WebSocket event shape, skill YAML fields

Skip exhaustive file lists, implementation narration, and ADR-style ceremony unless the change genuinely needs it.

### 3. Mark backward-compatibility surfaces

Before creating the PR, inspect every changed file for legacy shims, fallback paths, migration bridges, retained formats, deprecated configuration, compatibility documentation, or other behavior preserved for existing users. Review source code, tests, documentation, configuration, manifests, schemas, workflows, and scripts—not only code.

Add a valid, format-appropriate annotation to each compatibility block, section, or entry. The annotation's marker text must be exactly:

```
THIS IS FOR BACKWARDS COMPATIBILITY
```

Follow it with an explanation of what is being preserved and why it remains. Use a code comment in source files, a Markdown comment or admonition in documentation, and a valid comment in configuration files where the syntax supports comments. Do not make configuration or data files invalid to add a marker; if a format has no safe annotation syntax, document the compatibility surface in the PR review notes instead. If the change contains no backward-compatibility surfaces, note that explicitly in the PR review notes.

### 4. Classify alignment

For **product** and **architecture** separately, pick one primary classification:

| Classification | Meaning | Doc action in PR |
|----------------|---------|------------------|
| **Implements** | Fulfills something PRODUCT/ already describes | Cite doc(s); note any gaps filled |
| **Extends** | Builds on documented idea without changing philosophy | Cite doc(s); add clarifying sections if needed |
| **New concept** | Not specified in PRODUCT/ yet | Add new or updated doc(s) in this PR |
| **Modifies** | Changes documented philosophy, constraints, or approach | Edit affected doc(s) with rationale |
| **Supersedes / removes** | Retires a documented idea or pattern | Mark old sections superseded; explain why |

Architecture alignment uses the same table. Primary sources: `PRODUCT/docs/` (e.g. as-built architecture), plus any doc that defines patterns, boundaries, or protocols.

If classification differs between product and architecture, say so explicitly in each section.

### 5. Update documentation

Before opening the PR:

- **`PRODUCT/`** — per classification above; keep edits terse
- **READMEs** — root and package READMEs when structure or workflow changes (`server/`, `client/`, `shared/`, extensions, etc.)
- **Supersedes** — do not silently delete ideas; mark deprecated and point to the new approach

Include doc changes in the **same branch** as the code.

### 6. PR title

Use a scannable, plain-English title focused on the outcome.

Examples:

- Add environment id to skill YAML for state routing
- Route environment notifications through manager callbacks
- Implement narrow interact_with_environment bridge
- Narrow environment bridge via interact_with_environment tool
- Session events flow through EnvironmentManager callbacks
- Dynamic skill availability tied to environment state

### 7. PR body

Use the template in [pr-template.md](pr-template.md). And update it as indicated in the template. Keep it short, casual, and easy to scan. Point to paths or types for detail; do not duplicate the diff.

When tests change, include the template's **New tests** section. Summarize only the main behaviors or boundaries covered in a few bullets; do not turn it into an exhaustive test inventory.

### 8. Ship the PR

Follow repo git safety rules (no force-push to main, no `--no-verify` unless asked).

If the developer said to use branch/PR flow:
1. `git status`, `git diff`, `git log` — confirm scope
2. Commit doc + code on a feature branch (not `main`)
3. `git push -u origin HEAD`
4. `gh pr create` with title and body from template
5. Return the PR URL
6. Ask whether they want it merged now
7. If yes, use an allowed **merge commit** method for the repo unless the developer requests rebase or squash, and follow the non-destructive local-sync guidance in [`references/pr-workflow.md`](./references/pr-workflow.md)

If the developer explicitly said to push directly to `main` / `master`, you may do so.

Use `gh pr create` with a HEREDOC body; run `git status`, `git diff`, and `git log` against the default branch before push, per repo PR conventions.

## When to interrogate the developer

Ask before opening the PR if any of these are empty or hand-wavy:

- **Why this matters**
- Classification (implements vs new vs modifies vs supersedes)
- Rationale for **modifies** or **supersedes**
- Why a documented open question in PRODUCT/ was resolved this way

Use direct questions; do not guess importance.

## Relationship to ADRs

This PR format still captures the useful ADR bits — context, decision, consequences — but in a lighter, more conversational format. Rookery uses **`PRODUCT/` as the living spec** rather than a separate `docs/adr/` tree, so the PR should connect the change to those docs without turning into a long design memo.

## Additional resources

- Full PR body template: [pr-template.md](pr-template.md)
- Repo PR expectations: [AGENTS.md](../../../AGENTS.md)

## PR conflict handling

When `gh pr view` reports `mergeable: CONFLICTING` or the branch is behind its base:

1. Fetch the base branch.
2. Merge `origin/<base>` into the feature branch.
3. Resolve conflicts deliberately, preserving the feature work and the base-branch work.
4. Run the relevant tests and builds.
5. Commit the merge resolution as a normal merge commit.
6. Push the feature branch and verify the PR is clean and mergeable.

Do not rebase or force-push merely to resolve conflicts. Mention the merge commit and validation in the PR update.

## Local main safety

After merging a PR, do not hard-reset local `main` to `origin/main` unless the developer explicitly asks to discard local-only work. The default is to bring remote `main` into local `main` non-destructively.
