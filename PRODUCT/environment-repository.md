# Environment repository

Rook's environment repository maps recognizable environments to capability bundles that Rook can discover, preview, approve, and load.

## Storage model

Every environment-repository SQLite database shares the same three tables:

- `environments` — environment identity and display metadata.
- `capabilities` — reusable capability content and a content hash.
- `bundles` — membership rows joining a bundle, environment, and capability.

The web repository adds its own scout-state tables beside these three (see [Web repository](#web-repository)).

A capability is stored in one uniform nested file-map format. A skill stores its complete directory, including `SKILL.md`, scripts, references, and assets. `AGENTS.md`, `llms.txt`, facts, MCP content, and app content use the same representation.

Capabilities use UUID `TEXT` identifiers and may be referenced by bundle memberships in multiple environments. A bundle is the atomic publication, review, approval, and runtime-loading unit. The bundle hash is derived deterministically from its active capability memberships and their content. Rook does not store revisions or revision pointers.

`deleted_at` belongs to a bundle membership, not the shared capability row. Deleting a writable capability from one environment leaves the capability content available to other memberships. Restoration clears the membership timestamp.

The canonical, personal, and web databases use the same schema but different repository instances:

- canonical content is read-only and externally curated;
- personal content is writable and does not require approval;
- project-directory content is a direct filesystem source and is not stored in SQLite;
- web content is read-only, fetched from the site itself, and requires approval like canonical content.

Entering an environment does not create an empty personal bundle. Rook creates temporary authoring state for the session and creates durable environment, capability, and bundle-membership rows only when real content is authored.

## Environment ids

Environment ids use:

```text
<type>:<uri-like-path>
```

Examples:

- `mac:md.obsidian`
- `web:example.com`
- `location:office`
- `dir:/Users/johnberryman/projects/github/rookkeeper/rook`

Registration and entry are literal. Observed paths and URLs can discover known repository environments, but entering a child environment does not implicitly enter its parent.

## Repository projection and API

The repository layer stores normalized rows and projects them into the existing bundle-facing `EnvironmentBundle` API:

- `skill` capabilities become `bundle.skills`;
- `instructions` becomes `bundle.agentsMd`;
- `llms-txt` becomes `bundle.llmsTxt`;
- `facts`, `mcp`, and `app` capabilities become their corresponding bundle collections.

The server exposes:

```text
GET  /api/environments/search?query=...
GET  /api/bundles/search?query=...&repository=canonical|personal|project-directory|web
GET  /api/environments/preview?environmentId=...
```

Previews expose the bundle hash, active capability content, and repository identity. Revision metadata is not part of the API.

## Runtime workspace projection

The process-wide writable source is project-shaped and contains one environment directory per personal environment:

```text
<ROOK_HOME>/global-workspace/writable/<environment-key>/
├── AGENTS.md
└── .agents/
    └── skills/<skill-name>/
```

Each session receives disposable links:

```text
<ROOK_HOME>/agent-workspaces/<session-id>/
├── AGENTS.md
└── .agents/
    ├── editable-per-environment/<environment> -> shared environment directory
    └── skills/<visible-name>                  -> shared skill source
```

The root `AGENTS.md` is a generated, read-only aggregate. The linked `.agents/editable-per-environment/<environment>/` directory is the editable source for both instructions and skills. New skills belong under its `.agents/skills/` directory, never directly under the session workspace's `.agents/skills/`.

Canonical content is materialized read-only into the session workspace. Project-directory skills and instructions link directly to project files. The global watcher observes shared personal sources, debounces settled changes, writes current capability content to SQLite, and interprets missing writable source entries as membership soft deletion. Rebuild and cleanup operations are suppressed from deletion inference.

## Approval and deletion

Personal capabilities are user-owned and do not require approval. Canonical capabilities remain immutable and require the normal decision flow. Decisions apply to the derived content hash of an atomic bundle; changing active capability content or membership produces a different hash.

A writable skill or instruction source can be soft-deleted through its authoring path. The membership remains with a nullable `deleted_at` timestamp, the capability files remain available for restoration, and deleted content is omitted from bundle resolution, search, previews, aggregate instructions, and runtime discovery.

The generated aggregate `AGENTS.md` is never an editable source. Deleting or rebuilding it only causes regeneration and does not delete capability content.

## Web repository

When the user is on a `web:<host>` environment, Rook probes the site for the resources it publishes for agents and stores what it finds in the web repository. Three host-rooted URLs are requested:

- `https://<host>/llms.txt` → an `llms-txt` capability;
- `https://<host>/AGENTS.md` → an `instructions` capability;
- `https://<host>/.well-known/agent-skills/index.json` → one `skill` capability per `skill-md` entry.

The skills index follows Cloudflare's Agent Skills Discovery RFC (`$schema` `https://schemas.agentskills.io/discovery/0.2.0/schema.json`): a `skills` array of `{name, description, type, url, digest}`. Each `skill-md` entry's `url` is a single `SKILL.md`, which Rook fetches, verifies against the `sha256:` digest, and stores as `<name>/SKILL.md`. `archive` entries are recorded as unsupported; entries that fail validation or their digest are dropped and reported in the bundle's `errors`. Only the host root is probed; `web:<host>/<path>` environments are not scouted, and MCP discovery is not part of the web repository.

Everything found for a host forms one bundle, `web:<host>#site`, with the host as publisher. A site that publishes nothing is remembered as empty so it is not probed again on every visit.

### When scouting happens

Scouting starts when a client registers a `web:<host>` environment and runs in the background; reads from the web repository are served from stored rows and never touch the network. A host is fetched again once its entry is older than 24 hours, or 15 minutes after a failed scout. Refreshes use conditional requests, so an unchanged site costs a `304` and produces no new offer. A transient failure never removes content the site already published; a fetched `SKILL.md` that no longer matches its digest is dropped.

### Approval

Web bundles are approved like canonical bundles: the decision applies to the hash of the fetched content, and any change to the site's content produces a new hash and a new offer. The Mac offer shows the full text of `AGENTS.md`, `llms.txt`, and each `SKILL.md`, plus any scout errors, before the user decides. Materialization is read-only.

### Privacy and egress

Rook requests those three URLs from every website the user opens in a supported browser. `ROOK_WEB_SCOUT_DISABLED=1` turns scouting off while already-stored web content is still served. Requests are HTTPS only, refuse hosts that resolve to private or loopback addresses, follow at most three same-host redirects, time out after 10 s per resource, cap bodies at 1 MiB, and identify themselves as `Rook/<version>`.

### Publishing for Rook

A site owner makes content available to Rook by serving any of the three URLs above. `llms.txt` and `AGENTS.md` are plain text or Markdown. The skills index is JSON with one entry per skill:

```json
{
  "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  "skills": [
    {
      "name": "order-lookup",
      "description": "Look up an order by number.",
      "type": "skill-md",
      "url": "https://example.com/skills/order-lookup/SKILL.md",
      "digest": "sha256:<hex digest of the SKILL.md bytes>"
    }
  ]
}
```

`digest` is the SHA-256 of the `SKILL.md` file exactly as served; Rook discards a skill whose body does not match.

## Deferred work

- publishing, sharing, and signed publishers;
- `archive` skills, MCP discovery, and per-skill provenance in the web repository;
- capability-level approval or dependency graphs;
- conflict merging for concurrent personal edits;
- MCP startup and lifecycle;
- stronger OS-level sandboxing.
