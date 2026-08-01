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

The agent must receive a writable projection that has a defined path back to the personal bundle's source of truth. The exact mechanism is still open: direct mapping, a writable materialized copy with a watcher/write-back service, or runtime-specific tools.

This is a required part of the migration, not an optional later polish, because user-authored skills currently work end-to-end.

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

They follow the same bundle approval flow, but their runtime behavior needs separate design. Rook likely needs to inspect or start an MCP server to discover its tools and relevant configuration, cache that reviewable representation, and then materialize or launch the server for sessions.

The security and lifecycle model remains open.

## What does the content hash protect?

It protects the content that the agent will actually receive or use. For skills, that means the complete nested file tree. For `llms.txt`, it means the fetched text. For instructions, it means the injected text. Each capability type may need its own canonical representation.

Metadata used only for display or discovery does not need to invalidate approval.

## What if the upstream repository is unavailable?

Previously cached content can continue to be used. Revalidation and user notification behavior can become more sophisticated later.

## Why keep bundle decisions separate from bundles?

Bundles may be renamed, updated, or mutable for personal content. A decision applies to a specific reviewed revision/content hash, not to an ever-changing row.

## What is the first useful implementation?

The first meaningful cut should move the existing canonical and personal bundle catalog behind SQLite while preserving:

- the current bundle API
- bundle-level decisions
- session behavior
- user-authored skill editing
- runtime materialization into files

The directory reader can be an import tool during that cutover, but should not remain as a second live implementation.
