# Web environment scout (issue #76)

> Created after the developer confirmed the direction on 2026-08-18. Records decisions,
> not hypotheses. Brainstorm and investigation are in `BRAINSTORM.md`.

## Context

When Rook is in a `web:<host>` environment it only knows what someone has already put
in the repository by hand. The repository, approval, and materialization machinery can
already represent and load everything a website might publish; nothing fetches it.
This change adds the fetcher: a scout that probes a website for agent-facing resources
and stores host-published bundles in the user's repository for the normal offer → approve
→ materialize flow. It is the first concrete slice of #64.

## Decision details

- **Resources.** Three host-rooted URLs per `web:<host>` environment:
  `https://<host>/llms.txt` → `llms-txt`; `https://<host>/AGENTS.md` → `instructions`;
  `https://<host>/.well-known/agent-skills/index.json` → one `skill` per entry, per
  the Cloudflare Agent Skills Discovery RFC (`$schema` must be a recognized
  `schemas.agentskills.io/discovery/…` URI; entries need `name`, `type`, `description`,
  `url`, `digest`). Only `type: "skill-md"` entries are fetched (the `url` is a single
  `SKILL.md`, verified against `sha256:<hex>` and stored in the skill's file map as
  `<name>/SKILL.md`); `archive` entries and entries whose digest fails are skipped
  and reported in the bundle's `errors`. Path-scoped ids
  (`web:host/path`) are not scouted. MCP is out of scope (#3, #107).
- **Shape.** One personal `SQLiteEnvironmentRepository` serves both user- and
  host-published bundles from one `web:<host>` environment row. The scout writes one
  synthesized bundle per host: `bundleId: "site"`, `id: "<envId>#site"`,
  `repository: "personal"`, `publisher: <host>`, and projected
  `scoutPublished: true`. The explicit origin flag keeps it approval-gated and read-only.
  A contentless host keeps metadata for negative caching but is excluded from listing/search.
- **Trigger and persistence.** Scouting starts when a `web:` candidate is registered
  (`POST /api/environments/register`, already fire-and-forget). `getBundles` never does
  network I/O; it reads a **persistent SQLite store** so scouted capabilities survive
  restarts and are available offline and to search. Web rows use the personal
  `<ROOK_HOME>/environment-repository.db` with the main schema: one environment row per
  id and no repository column. Per-host `fetched_at`, status, errors, and resource
  `etag`/`last_modified` validators live under that row's `metadata_json.scout`.
  Host publisher scope ensures a refresh cannot change user publishers. Refresh policy: on
  registration, if the host's entry is older than the TTL (default 24 h, env override)
  re-scout in the background using conditional requests (`If-None-Match` /
  `If-Modified-Since`); if content changed, replace the bundle rows (new hash → new
  offer, per the approval model) and re-register the candidate so summaries and offers
  refresh without waiting for the next client registration. Hosts with nothing found are
  recorded too (negative entry, same TTL) so they are not re-probed on every visit.
  Client-side debounce (≈1 s focus delay, 60 s per-environment duplicate suppression) is
  relied on and noted; the scout adds a per-host in-flight guard.
- **Egress policy.** A small dedicated fetch helper: HTTPS only; 10 s deadline per
  fetched resource (the guarded fetch deadline covers DNS, redirects, and the body read
  for the whole call; skills on slow hosts need the headroom); 1 MiB response cap; follow at most 3 same-host redirects; refuse hosts that
  resolve to loopback/private/link-local addresses; fixed `User-Agent: Rook/<version>
  (+https://github.com/rookkeeper/rook)`; only 2xx bodies are used; 404 is normal and not
  an error; network failures are recorded as `unreachable_url` bundle errors (stored
  content for that resource is kept) and logged at warn. Skill URLs from the index may be cross-origin (RFC allows it) and go
  through the same helper. Fetched text is normalized to `\n` line endings and trailing
  whitespace trimmed before hashing so incidental serving differences do not churn the
  bundle hash.
- **Errors.** Extend `RepositoryReadError.code` with `unreachable_url` and
  `unsupported_capability`; add optional `sourceUrl` alongside `sourcePath` on
  `BundleArtifact`/`EnvironmentBundle` where useful.
- **Approval preview (Mac).** The offer view shows the bundle's actual content before
  the user decides: it calls the existing `GET /api/environments/preview` (RookKit
  `environmentPreview(environmentId:)`), selects the bundle by `bundleHash`, and renders
  `llms.txt`, `AGENTS.md`, each skill's `SKILL.md` (collapsible, monospaced), and any
  `errors`. `EnvironmentBundlePreview` in RookKit gains `agentsMd` if the server payload
  carries it and the Swift type does not. Applies to every repository, not only `web`.
- **Non-goals / boundaries.** No `archive` skills (follow-up issue to file after merge).
  No probing of path-scoped web ids. MCP out of scope. If a scout completes after a
  session already entered the environment, the offer appears on the next entry or
  restart (existing manager behavior; noted, not changed here). iPhone/Android offer
  views are not changed in this pass.
- **Docs.** `PRODUCT/environment-repository.md` gains a "Web repository" section
  (what is probed, the adopted discovery convention, approval semantics, the privacy
  statement that Rook requests these three URLs from sites the user opens);
  `AS-BUILT-ARCHITECTURE/server.md`, `AS-BUILT-ARCHITECTURE/database.md`, and
  `server/README.md` list the new repository, its shared storage, and the egress helper;
  `AS-BUILT-ARCHITECTURE/mac-client.md` notes the offer preview; the stale `.bundles` paths in
  `.agents/skills/debugging-rook/references/server-and-environment.md` are corrected.

## Work checklist

- [x] `server/src/infrastructure/http/scoutFetch.ts` (name TBD in-code): the egress
      helper above, injectable `fetch`, typed result (`ok | absent | error`), unit tests
      for timeout, size cap, redirect limit, private-address refusal, HTTPS-only.
- [x] Persistent store: the personal `<ROOK_HOME>/environment-repository.db` opened once
      with one environment row per id; publisher-scoped host memberships plus
      metadata-backed per-host scout state; ingest / replace only one host publisher;
      normal personal-repository reads; staleness query.
- [x] `WebEnvironmentScout` in `server/src/environments/`: given a host, fetch the
      three resources (conditional requests when the store has validators), parse the
      discovery index (schema check, field validation, `skill-md` only, digest
      verification), assemble capability file maps and `errors`, write to the store;
      per-host in-flight dedupe; negative entries; `scout(host)` returns whether the
      stored result changed.
- [x] `WebEnvironmentScoutStore`: scout-state accessors, host guards, and transactional
      `recordScout` only. It collaborates with the personal repository and is not wired
      into `CompositeEnvironmentRepository`.
- [x] Trigger: hook `web:` candidate registration to `scout(host)` when the host is
      unknown or stale (in the register route or a thin wrapper around
      `registerCandidateEnvironment`) and re-register the candidate when the result
      changed. Keep it fire-and-forget with logging.
- [x] Shared types: `unreachable_url`, `unsupported_capability` error codes;
      `sourceUrl` hints; confirm `hashEnvironmentBundle` covers the new content
      unchanged.
- [x] Tests (vitest, `// @vitest-environment node`, injected fake fetch): scout
      happy path (all three present), each resource absent, malformed index,
      unknown `$schema`, `archive` entry skipped with error, digest mismatch skipped,
      cross-origin skill URL, fresh entry skipped, stale entry re-scouted with
      conditional headers and 304 keeps rows, changed content replaces rows and
      reports change, negative entry honoured, in-flight dedupe; store round-trips
      across a reopen; repository serves store and returns no bundles for unknown
      hosts; composite integration; manager re-registration refreshes summaries and
      produces an offer on entry. One env-gated live test (`ROOK_WEB_SCOUT_LIVE=1`) against a
      real public site.
- [x] Mac approval preview: `EnvironmentOfferDetail` loads the preview for the
      offered environment, matches the bundle by hash, and renders `llms.txt`,
      `AGENTS.md`, skill `SKILL.md` contents (collapsible) and errors; RookKit type
      gains `agentsMd` if needed; loading/failure states; RookKit decoding test.
- [x] Docs per Decision details; add the discovery-index convention and a short
      "publish for Rook" note for site owners in `PRODUCT/environment-repository.md`.
- [x] Manual verification (developer-driven): open a browser tab on a site that
      publishes at least one of the three resources; confirm the environment shows
      the site-published bundle, the offer appears on entry **with the content visible in the
      preview**, approval materializes the content read-only into the session
      workspace, the agent can use it, and after a server restart the site is still
      known without a re-fetch.
- [x] `npm run typecheck`, `node ./node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit`,
      and `npm test` in `server/` pass; final review; sync with main; PR (documenting
      the adopted convention) through the fork.

## Review round 1 (2026-08-24)

- [x] Give each generated `llms.txt` skill a meaningful, site-specific name and description.
- [x] Verify published skill digests over the raw fetched bytes and improve mismatch diagnostics.
- [x] Consolidate the web repository/database implementation with the shared repository
      infrastructure. Personal and web share one datastore; repository-scoped composite
      environment keys allow both sources for the same website; scout state is stored in
      `metadata_json`; contentless negative-cache rows are excluded from list/search; no
      web-only tables, path, configuration override, or web-database migration remain.

## Review round 2 (2026-08-25)

This round supersedes round 1's repository-discriminator storage design, following the
maintainer's direction to use the existing bundle publisher.

- [x] Restore `EnvironmentRepositoryDatastore` byte-for-byte to the `origin/main` schema:
      `environment_id` is the environment primary key, bundles use
      `(bundle_id, capability_id)`, and there is no repository column or migration.
- [x] Serve user and site content through the single personal SQLite repository; remove
      the web repository from the composite and replace it with a scout-only store.
- [x] Scope every scout replacement/deletion/fingerprint to
      `environment_id + publisher = host` and preserve all other publishers.
- [x] Preserve user-authored display name, description, and metadata while updating
      namespaced scout state transactionally.
- [x] Project `publisher` and `scoutPublished` so manager authorization, workspace
      editability, and Mac offer labeling remain correct without a `web` repository id.
- [x] Retarget tests to publisher isolation, same-environment coexistence, read-only site
      bundles, display-name preservation, and contentless-row filtering; remove migration tests.

### Reconciliation with `john-update` (2026-08-27)

The maintainer's `john-update` branch implemented the same publisher-based design
in parallel (before this branch's round-2 push). Reconciled by keeping this
branch's implementation and porting the two additions it lacked:

- `Isolate launcher client and repository state` — cherry-picked as authored.
- `migrateRepositoryScopedSchema` — collapses databases that ran this branch's
  interim repository-scoped revision back to the neutral schema (the maintainer's
  own database is in that state). Ported with the marker comment reworded because
  the reject-compatibility CI guard fails on the marker text itself.

The `john-update` "." commit (editor settings, a dirtied canonical
`environment-repository.db`) was deliberately not taken.

## Manual checklist findings (2026-08-30)

Running the maintainer's seven-step manual checklist headlessly surfaced two bugs.
The second — temporary accepts leaking to later sessions through the shared
workspace projection — predates this branch and is filed as issue #182, not fixed
here.

- [x] Reject a decision request without a `bundleHash` instead of accepting it and
      silently authorizing nothing. `decideEnvironment` files hash-less session
      decisions under the environment id, a key materialization never consults, so
      a hash-less `accept` returned `{ok: true}` while the join materialized an
      empty workspace. The REST endpoint now requires `bundleHash` for every
      decision (it previously required it only for approve/reject); every client
      already sends it, and the one internal hash-less caller (`LocationRegistrar`)
      talks to the manager directly. Covered by new route-level tests
      (`environmentRoutes.test.ts`) and verified live: hash-less accept → 400,
      with-hash accept → 200 and the join flow unchanged.
