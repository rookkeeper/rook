# Environment repository decisions

Working decisions from the current design discussion. These are intentionally short and can be revised as implementation exposes better answers.

## Core model

- A **bundle** remains the atomic unit for publication, review, approval, and runtime loading.
- A bundle is a collection of related capabilities. It is accepted or rejected as a whole.
- A capability belongs to one bundle; sharing it between bundles means copying it for now.
- External bundles are immutable to the user for now.
- User-created capabilities are writable and automatically belong to a personal/default bundle.
- User-created capabilities do not require approval while they remain personal.
- For now, user-created capabilities are not published or shared.
- Bundle operations needed now are rename, update, and delete.

## Capability types

Initial capability types are:

- agent skills, including their nested references, scripts, and assets
- MCP servers
- `AGENTS.md`-like instructions
- `llms.txt`
- arbitrary facts or reference information

Facts should normally become instruction-like context. Large facts may be wrapped in a pseudo-skill so they do not unnecessarily pollute the prompt.

## Storage and repositories

- The repository abstraction remains the boundary. Its implementation may use SQLite now and other sources later.
- There will be one logical repository view over personal, canonical, cached, and eventually other repositories.
- Environment search and bundle search will be separate operations.
- Fetching should prefer cached content and revalidate against the upstream source when required.
- A canonical repository database and a user-local repository/cache database are separate concerns from the application database.
- The application database remains the initial home for user bundle decisions; repository content and user decisions should not be tightly coupled.
- The old directory reader may be used as a one-time importer, but should be deleted from the live path once the replacement is working.

## Bundle identity and content

- A bundle needs an identity separate from a particular content revision.
- The identity is expected to involve repository, environment, bundle name, and publisher/origin.
- The publisher-supplied version and the received content hash are both useful: the version is the publisher's claim, while the hash describes what Rook actually received.
- The exact bundle identity and hash format still need refinement.
- Use the content that reaches the agent runtime as the approval boundary.
- Skills hash their complete nested file tree. `llms.txt` hashes its fetched full text. Other types need type-specific canonical content representations.
- Metadata that is not injected into the runtime should not require reapproval.
- Hash changes require approval again.
- Hash-algorithm/schema versioning is deferred; existing approvals may need to be renewed later.

## Decisions and trust

- Approval is bundle-scoped, not capability-scoped and not environment-scoped.
- Keep the current decision semantics and naming for now:
  - `accept` — allow once for the current session/visit
  - `ignore` — skip once for the current session/visit
  - `approve` — always allow future sessions
  - `reject` — always reject future sessions
- Permanent decisions must refer to the exact bundle revision/content hash, not live mutable bundle metadata.
- Decisions should remain separate from the mutable bundle row.
- Untrusted content may be cached before approval so it can be reviewed and used offline later.
- If an upstream source disappears, cached content remains usable.
- If a source serves different content for the same advertised version, the changed hash requires reapproval. Provider enforcement is deferred.

## Runtime projection

- The database is the source of truth for database-backed capabilities.
- Each session has its own agent working directory.
- Runtime startup/restart should eventually re-materialize all associated bundle content instead of trusting whatever files happen to remain in the working directory. This is explicitly deferred for now.
- Different capability types may materialize differently:
  - skills become skills directories
  - facts and `llms.txt` may become pseudo-skills when large or on-demand
  - instructions contribute to generated agent instructions
  - MCP servers need a separate materialization and lifecycle design
- Generated `AGENTS.md` content should include provenance markers identifying the environment, bundle, and source file for each inserted section.
- A generated aggregate `AGENTS.md` is derived output, not an obvious write-back target. The write-back story for editable instructions must be designed before claiming full database-backed authoring.
- Project-directory environments may point directly at existing `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and MCP files. Those files already have an external source of truth and may need direct mapping or symlinking.

## Write protection

- External capabilities should be read-only to the agent.
- A separate OS user may provide the strongest boundary, but its complexity is unknown.
- Replacing read/write tools with Rook-owned tools is an alternative, but may only work for runtimes that permit tool replacement, potentially limiting support to Pi.
- No final write-protection mechanism has been selected yet.

## Explicitly deferred

- user capability publishing and sharing
- capability-level approval
- signed publishers and formal provenance
- capability dependency graphs
- automatic multi-session conflict merging
- strong OS-level sandboxing and write protection
- complete live MCP version tracking and security model
- repository prompt-injection validation
- final manifest design
- substantial UI redesign
- automatic startup/restart re-injection, beyond the current work-directory behavior
