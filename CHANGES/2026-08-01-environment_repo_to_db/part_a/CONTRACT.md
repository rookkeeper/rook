# Environment repository contract

This is the working contract for the first migration. It is intentionally narrower than the eventual public/community repository protocol.

## Bundle identity and revisions

A bundle is the atomic publication, review, approval, and runtime-loading unit.

A bundle identity is the tuple:

```text
repository + environment + bundle name
```

A bundle revision is a specific content snapshot:

```text
bundle identity + publisher version (optional) + canonical content hash
```

The publisher version is an assertion from the source. The canonical content hash is authoritative for approval. If the same publisher version produces a different hash, the content is a new revision and requires review.

User-owned bundles may be updated in place from the user's perspective, but each stored content snapshot is still a revision. External revisions are immutable after fetch.

## Capability content

A capability belongs to exactly one bundle revision for now. It has:

- a type
- a human-readable name
- type-specific content
- optional display/discovery metadata
- optional source/provenance information

Initial types:

- skill directory: complete nested files, including references, scripts, and assets
- instructions: text injected into the runtime instructions
- fact/reference: text injected as instructions when small, or exposed through a generated skill when large
- `llms.txt`: fetched full text, normally exposed through a generated reference skill
- MCP server: source/configuration plus a separately defined reviewable tool description

Only content that reaches or controls the agent runtime participates in approval hashing. Display-only metadata does not.

## Decisions

Decisions apply to a complete bundle revision:

- `accept`: allow for the current session/visit
- `ignore`: skip for the current session/visit
- `approve`: always allow this exact revision
- `reject`: always reject this exact revision

The durable decision key is the canonical content hash, with bundle identity retained for auditability. Decisions remain application/user state, not repository content.

## Repository API

The current `getBundles(environmentId)` method remains the compatibility read method during migration. The target service-level API is:

```ts
listEnvironments(query?: string): Promise<EnvironmentRecord[]>
searchBundles(query: string, filters?: BundleSearchFilters): Promise<EnvironmentBundleSummary[]>
getBundles(environmentId: string): Promise<EnvironmentBundleResult>
getBundlePreview(ref: EnvironmentBundleRef): Promise<EnvironmentBundlePreview>
fetchBundle(ref: EnvironmentBundleRef, options?: FetchBundleOptions): Promise<ResolvedEnvironmentBundle>
refreshBundle(ref: EnvironmentBundleRef): Promise<ResolvedEnvironmentBundle>
```

Repository implementations may use local SQLite, a directory importer, Git, HTTP, or another source. The service decides whether cached content is fresh enough and whether materialization is needed.

The first implementation only needs to complete the compatibility read method, local list/search, import, and content fetch. Remote refresh and full filters are later gates.

## Runtime boundary

Repository content is not itself the runtime. A session workspace materializer converts resolved bundle revisions into runtime files:

```text
bundle revisions -> session workspace -> ACP runtime
```

The materializer owns path layout, generated instructions, read-only projections, and writable-source mappings. Repository paths must not be required by the runtime contract.
