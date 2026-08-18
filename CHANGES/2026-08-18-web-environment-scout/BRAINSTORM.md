# Web environment scout (issue #76)

**Status: direction confirmed — implementation plan recorded in `TODO.md`**

## Problem

When Rook is in a `web:<host>` environment, it only knows what someone has already
put in the repository by hand. The repository model can represent everything a site
might publish (`llms-txt`, `instructions`, `skill`, `mcp` capability types) and
materialization already turns `llms.txt` into a generated reference skill, but no
code ever looks at the site. Issue #76 asks for that: check the site for skills,
`AGENTS.md`, and other agent-facing resources and present them as a bundle. John's
Aug 9 triage: "This likely wants a dedicated web-backed repository/adapter rather than
more environment-manager logic." It is also the concrete first slice of #64
(auto-populate the repository), whose sketch adds `llms.txt` and, later, MCP.

Why now: the environment → capability machinery works end to end, but capabilities
mostly get in by hand, so Rook is rarely useful on arrival at a website.

## Investigation

Read `AS-BUILT-ARCHITECTURE/server.md`, `PRODUCT/environment-repository.md`,
`PRODUCT/environment-local-authoring.md`, `PRODUCT/narrow-skills-environment-bridge.md`,
and the environment repository, manager, decision, and workspace code.

- **Repository abstraction.** `EnvironmentRepository`
  (`server/src/environments/repositories/EnvironmentRepository.ts`) is an abstract
  class; only `getBundles(environmentId)` is required, everything else defaults to
  no-op/false. Implementations: `SQLiteEnvironmentRepository` (canonical + personal),
  `ProjectDirectoryEnvironmentRepository`, `LocationContextRepository` (in-memory,
  content pushed in by a producer), composed in `server/src/index.ts:78-89` by
  `CompositeEnvironmentRepository`, which concatenates bundles with no precedence.
  Existing `repositoryId`s: `canonical`, `personal`, `project-directory`,
  `location-context`. `LocationContextRepository` is the closest precedent for a
  repository whose content comes from somewhere other than SQLite or the filesystem.
- **No caching.** `getBundles` runs on every candidate registration, every
  `enterEnvironment`, every runtime restart, and `EnvironmentManager.finalizedEnvironmentIds`
  (`EnvironmentManager.ts:222-251`) calls it for every URL path prefix of every observed
  URL. The Mac client polls browser tabs every 5 s. Whatever fetches from the web must
  own its own cache/TTL and must not sit on the session's critical path.
- **Web ids.** Mac clients emit host-only `web:<host>` (Safari/Firefox via the
  specialist provider; other browsers via generic AX). Path-scoped ids
  (`web:host/path`) are derived server-side and only registered when the repository
  already returns a bundle for them.
- **Approval.** Per bundle, keyed by a SHA-256 of all capability content
  (`shared/environmentBundleHash.ts`). Any content change → new hash → new offer →
  re-approval. That is the built-in answer to "the site changed" and also a churn risk
  if fetched content is non-deterministic. Decisions persist in `environment_decisions`
  keyed by hash. The offer payload and Mac `EnvironmentOfferView` show capability
  *names* only; full content is available through `GET /api/environments/preview` but
  the Mac view does not call it.
- **Materialization.** `CapabilityWorkspaceManager.materialize` writes non-editable,
  non-project-directory bundles read-only (skills under `.agents/skills`, instructions
  under `.agents/.rook/instructions/<nickname>/AGENTS.md`, `llms.txt` as a generated
  reference skill). A fetched bundle with `editable: false` needs no workspace changes.
- **Outbound HTTP.** The server has exactly one outbound `fetch`
  (`server/src/location/ptiles/ptilesFetch.ts`, fixed host, allow-listed file names,
  no timeout). There is no general egress policy: no timeouts, size caps,
  redirect/private-address guards, or user-agent. A web scout would be the first
  general-purpose egress.
- **Old on-disk `.bundles` grammar** (removed with the SQLite migration, recoverable at
  `f552b95^`): `skills/`, `mcp-servers/`, `apps/`, `facts/`, `AGENTS.md`, `llms.txt`.
  HTTP has no directory listing, so mirroring it verbatim over the web needs an index
  convention. The issue's example uses `.agent/skills`; the codebase convention is
  `.agents/skills`.
- **Emerging convention for skills on the web.** Cloudflare's Agent Skills Discovery
  RFC (v0.2.0, `github.com/cloudflare/agent-skills-discovery-rfc`; schema hosted at
  `schemas.agentskills.io/discovery/0.2.0/schema.json`) defines
  `/.well-known/agent-skills/index.json`: a `skills` array of `{name, description,
  type: "skill-md" | "archive", url, digest}`; clients must verify the digest. The
  `npx skills` installer consumes it; Claude Code has an open feature request. Not
  ubiquitous yet, but it removes the need to invent a Rook-specific layout.
- **Error taxonomy.** `RepositoryReadError.code` is a closed union of filesystem-shaped
  codes; there is no network variant. `bundlePath`/`sourcePath` are filesystem hints.
- **Tests.** Repository tests are hermetic (`:memory:` SQLite, `mkdtemp`, fake
  repositories injected into the composite). Live network tests are gated by env var
  (`PtilesPoiLookupProvider.live.test.ts`, `describe.runIf(process.env.PTILES_LIVE)`).
- **Available for local testing.** `~/.rook/sandbox/environment-repository.db`
  holds a hand-authored `web:hunterphillips.dev` bundle and that site serves
  `/llms.txt`; a third-party site publishing all three resources is still to be found.

## Options and questions

### What the scout looks for

Settled with the developer: three host-rooted resources.

- `/llms.txt` → `llms-txt` capability (already materialized as a generated reference skill).
- `/AGENTS.md` → `instructions` capability.
- `/.well-known/agent-skills/index.json` → one `skill` capability per index entry,
  fetched from each entry's `url` and verified against its `digest` (Cloudflare Agent
  Skills Discovery RFC, schema at `schemas.agentskills.io/discovery/0.2.0/schema.json`).

MCP is out of scope for this change (its attachment model is open in #3 and #107).

### Where the fetch happens

- **A. Fetch inside `getBundles` with an internal cache.** Simple, one class. Risk:
  first call for a new host blocks whoever asked (registration is fire-and-forget,
  but `enterEnvironment` and restart are awaited).
- **B. Scout on candidate registration, serve from cache.** `EnvironmentManager.
  registerCandidateEnvironment` already runs asynchronously; a scout kicked off there
  fills a store that a read-only `WebEnvironmentRepository` serves from. `getBundles`
  never touches the network. Precedent: `LocationRegistrar` → `LocationContextRepository`.
  Needs a small hook or event from the manager, or the scout observing registrations.
- **C. Scout persists into a SQLite repository** (a `web` DB via
  `SQLiteEnvironmentRepository.saveBundle`). Durable across restarts, searchable,
  reuses ingest code. Blurs "fetched cache" with "curated content"; needs an
  expiry/refresh story SQLite rows do not have today.

### Cross-cutting

- **Egress policy.** Timeout, max body size, HTTPS only, follow same-host redirects
  only, refuse private/loopback addresses, fixed user-agent, per-host concurrency of 1.
  Where does it live — a small `infrastructure/http` helper the ptiles fetch could also
  adopt later?
- **Cache/TTL and refresh.** In-memory vs on-disk under `ROOK_HOME`; TTL length;
  honour `ETag`/`Last-Modified` for cheap revalidation; negative caching for 404 hosts
  so unknown sites are probed once, not every 5 s.
- **Hash churn.** Fetched content changes → re-offer + runtime restart. Acceptable
  by design ("any change forces re-approval") but a site with dynamic `llms.txt`
  would be noisy. Mitigations: normalize whitespace; only publish a new bundle after
  content is stable across two fetches; or accept and observe.
- **What the user sees.** Approving remote instructions by name only is a real
  prompt-injection gap. John's sketch says "show the user the full llms.txt text."
  Options: leave the UI alone for this change and file a follow-up; or add a preview
  affordance to the Mac offer view. Leaning: out of scope here, note it explicitly.
- **Which hosts get scouted.** Every registered `web:` candidate (i.e. every site the
  user visits) vs only after the user enters/looks at the environment. Scouting every
  visited site means outbound requests to sites the user merely opened, which is a
  privacy question worth a sentence in PRODUCT.
- **Path-scoped environments.** Should the scout also probe `web:host/path` prefixes
  (e.g. `/docs/llms.txt`)? Adds requests; the RFC and llms.txt are host-rooted. Leaning:
  host-rooted only for now.
- **Bundle identity.** One synthesized bundle per host, `bundleId` fixed (e.g. `site`),
  `repository: "web"`, `publisher` = host, `editable: false`. Extend
  `RepositoryReadError.code` with a network variant and add a `sourceUrl` hint.
- **Validation site.** Find a real public site that publishes all three files, in
  addition to whatever we control, before opening the PR.

## Direction

**Status: direction confirmed by the developer (2026-08-18) — implementation plan in `TODO.md`.**

- **Scope:** `/llms.txt`, `/AGENTS.md`, and `/.well-known/agent-skills/index.json`
  with `skill-md` entries only. `archive` entries are skipped and reported in the
  bundle's `errors` so the omission is visible; archive support is a follow-up issue.
  MCP is out of scope.
- **Architecture:** scout on candidate registration; results persisted to a
  profile-local SQLite store (`<ROOK_HOME>/web-environment-repository.db`) and served
  through a read-only `WebEnvironmentRepository` (`repositoryId: "web"`), so scouted
  capabilities survive restarts and are searchable. `getBundles` never performs network
  I/O. Stale entries (default 24 h) are refreshed in the background with conditional
  requests. (Options B and C combined; A rejected.)
- **Which hosts:** every registered `web:` candidate. The Mac client already applies a
  ~1 s focus delay and a 60 s per-environment duplicate-suppression window before
  registering, so rapid tab switching never reaches the server; the store's per-host
  entry (positive or negative) means each host is fetched at most once per TTL.
  The privacy consequence (Rook makes requests to sites the user opens) is stated in
  the product doc.
- **Egress policy:** explicit helper with timeout, size cap, HTTPS only, same-host
  redirects only, private/loopback address refusal, fixed user-agent.
- **UI:** the Mac offer view shows the bundle's actual content (via the existing
  preview endpoint) before the user decides. Included in this change.
- **Convention:** adopting the Cloudflare Agent Skills Discovery index is documented
  and defined in this change (product doc + PR), not pre-negotiated.
- **Validation:** hermetic tests with an injected fetcher; one env-gated live test; find
  a third-party site publishing the resources before opening the PR.
