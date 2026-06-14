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

Rookery PRs are decision records for **what changed in the product and architecture**, not walkthroughs of every code hunk. The code diff is the detail; the PR is the rationale, alignment, and consequences.

## Hard rules

- **Never push to `main`.** All changes ship through a feature branch and PR.
- **Read every file under `PRODUCT/`** before writing the PR. (You should ignore PRODUCT_CHANGES, as it is for work in progress scratch documentation, todos, and status.) Treat drafts and placeholders as current intent until superseded.
- **Update `PRODUCT/` in the same PR** when the change introduces, modifies, or removes a product or architecture idea - but don't be overly nit-picky because we don't want too much documentation churn. Most of product documents are quite high-level, so we don't need low-level product changes. See [AGENTS.md](../../../AGENTS.md).
- **Do not ship** until product/architecture alignment sections are complete and doc updates are included (or explicitly marked N/A with reason).
- If the **why this matters** section of the PR is missing or weak, **stop and ask the developer** before opening the PR.

## Workflow

Copy and track:

```
- [ ] 1. Read all PRODUCT/ docs
- [ ] 2. Analyze branch diff (product + architecture lens)
- [ ] 3. Classify product & architecture alignment
- [ ] 4. Update PRODUCT/ (and READMEs if structural)
- [ ] 5. Draft PR title + body (template below)
- [ ] 6. Validate required sections; ask developer if gaps
- [ ] 7. Push branch and open PR with gh
```

### 1. Read all PRODUCT/ docs

List and read every markdown file under `PRODUCT/`. Note for each:

- Stated goals, open questions, and placeholders
- Concepts this branch touches or contradicts
- Cross-links between docs (e.g. skills ↔ environment bridge)

Skim code only enough to map **abstract** impact: major components, patterns, APIs, event/schema shapes — not line-by-line review.

### 2. Analyze the change

Compare the branch to the default branch (`git diff`, commit history, chat context). Summarize:

- **Problem** — what user or system need this addresses
- **Decision** — what approach was taken (one declarative sentence)
- **Consequences** — tradeoffs, follow-ups, risks
- **Technical footprint** (high level) — e.g. new `EnvironmentManager` callback, WebSocket event shape, skill YAML fields

Skip exhaustive file lists and implementation narration.

### 3. Classify alignment

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

### 4. Update documentation

Before opening the PR:

- **`PRODUCT/`** — per classification above; keep edits terse
- **READMEs** — root and package READMEs when structure or workflow changes (`agent-server-client/`, extensions, etc.)
- **Supersedes** — do not silently delete ideas; mark deprecated and point to the new approach

Include doc changes in the **same branch** as the code.

### 5. PR title

Use a scannable, ADR-style title (problem → outcome):


Examples:

- Add environment id to skill YAML for state routing
- Route environment notifications through manager callbacks
- Implement narrow interact_with_environment bridge
- Narrow environment bridge via interact_with_environment tool
- Session events flow through EnvironmentManager callbacks
- Dynamic skill availability tied to environment state

### 6. PR body

Use the template in [pr-template.md](pr-template.md). And update it as indicated in the template. Keep prose at the **abstract** level. Point to paths or types for detail; do not duplicate the diff.

### 7. Ship the PR

Follow repo git safety rules (no force-push to main, no `--no-verify` unless asked).

1. `git status`, `git diff`, `git log` — confirm scope
2. Commit doc + code on a feature branch (not `main`)
3. `git push -u origin HEAD`
4. `gh pr create` with title and body from template
5. Return the PR URL

Use `gh pr create` with a HEREDOC body; run `git status`, `git diff`, and `git log` against the default branch before push, per repo PR conventions.

## When to interrogate the developer

Ask before opening the PR if any of these are empty or hand-wavy:

- **Why this matters**
- Classification (implements vs new vs modifies vs supersedes)
- Rationale for **modifies** or **supersedes**
- Why a documented open question in PRODUCT/ was resolved this way

Use direct questions; do not guess importance.

## Relationship to ADRs

This PR format borrows from [Architecture Decision Records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (context, decision, consequences, alternatives). Rookery uses **`PRODUCT/` as the living spec** rather than a separate `docs/adr/` tree — the PR links change to those docs and updates them when the decision lands.

## Additional resources

- Full PR body template: [pr-template.md](pr-template.md)
- Repo PR expectations: [AGENTS.md](../../../AGENTS.md)
