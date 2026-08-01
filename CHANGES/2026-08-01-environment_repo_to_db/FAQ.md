# Environment repository FAQ

## What is a bundle?

A bundle is the atomic group of related capabilities that a publisher or user manages, reviews, approves, and loads together. It may contain one skill, several skills, an MCP server, instructions, facts, `llms.txt`, or a mixture of these.

## Why not store capabilities directly on environments?

Every capability must belong to a bundle so that approval, publication, caching, and runtime loading have a single unit of meaning. User-created capabilities get an automatic personal/default bundle.

## Why use SQLite if the agent still needs files?

SQLite is the catalog and source of truth. The runtime still receives a normal working directory because current agent runtimes understand files, skills, and instruction files. Materialization is the adapter between the database and the runtime.

## Does this mean there will be two sources of truth?

Not permanently. During migration, the old directory tree may be read by an importer. After cutover, repository content should have one source of truth. Runtime working directories are projections, not repositories.

The exception is an environment that intentionally points at an existing project directory. In that case the project files are already the source of truth and the repository stores the pointer and metadata.

## How can user-created skills remain editable?

The agent receives a writable per-session projection under `.var/rook/agent-workspaces/<session-id>/.agent/skills`. At workspace synchronization points, the materializer sends changed files through the repository service, which writes a new personal SQLite revision. Personal instruction edits use marked sections in the generated `AGENTS.md` and write back to the bundle instruction field.

This is covered by the ACP end-to-end authoring test. Concurrent conflict merging remains deferred.

## How can external skills be read-only?

External content should be materialized separately from writable personal content. File permissions may be sufficient as a first policy, but they are not a strong security boundary if the agent can run arbitrary shell commands. A separate OS user or runtime-specific controlled tools may eventually be needed.

## Why generate one `AGENTS.md`?

The runtime needs a usable instruction file, but the content may originate from many environments and bundles. The generated file can use readable pseudo-markdown structure without exposing machine-oriented identifiers:

```markdown
# Rook environment context

<environment name="Gmail">

  <context>
    <website>https://mail.google.com</website>
    <description>Gmail in the user's web browser.</description>
  </context>

  <bundle name="Gmail workflows">

    <instructions>
      Use Gmail's search syntax when locating messages.
      Confirm before sending or deleting email.
    </instructions>

  </bundle>

  <bundle name="Personal Gmail preferences" editable="true">

    <instructions>
      The user prefers concise email drafts.
      Never archive messages without confirmation.
    </instructions>

  </bundle>

</environment>
```

The generated file should be treated as derived output. Editable source instructions need a separate write-back strategy; blindly concatenating them makes edits ambiguous.

## What happens to random facts?

Small facts can be injected like instructions. Large facts should generally be wrapped in a pseudo-skill so they are available without filling the agent's initial context.

## What is special about `llms.txt`?

Rook fetches and caches the full text, and the fetched content participates in the bundle's approval hash. It will probably be exposed through a generated reference skill rather than dumped directly into the prompt.

## What is special about MCP servers?

They follow the same bundle approval flow. The current migration stores and previews their configuration/content and materializes it into a separate read-only workspace area. Rook does not yet start MCP servers, enumerate live tools, manage authentication, or define sharing/lifecycle permissions.

Those runtime and security questions remain explicitly deferred.

## What does the content hash protect?

It protects the content that the agent will actually receive or use. For skills, that means the complete nested file tree. For `llms.txt`, it means the fetched text. For instructions, it means the injected text. Each capability type may need its own canonical representation.

Metadata used only for display or discovery does not need to invalidate approval.

## What if the upstream repository is unavailable?

Previously cached content can continue to be used. Revalidation and user notification behavior can become more sophisticated later.

## Why keep bundle decisions separate from bundles?

Bundles may be renamed, updated, or mutable for personal content. A decision applies to a specific reviewed revision/content hash, not to an ever-changing row.

## What is the first useful implementation?

The first meaningful cut now moves the canonical and personal bundle catalog behind SQLite while preserving:

- the compatibility bundle API and separate environment/bundle search
- bundle-level decisions keyed by exact content hash
- session behavior and per-session runtime workspaces
- user-authored skill and instruction editing
- runtime materialization into ordinary files

The directory reader is an import/compatibility tool, not a second normal live repository.
