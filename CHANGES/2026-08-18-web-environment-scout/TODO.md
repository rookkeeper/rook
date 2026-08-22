# Web environment scout (issue #76)

> Created after the developer confirmed the direction on 2026-08-18. Records decisions,
> not hypotheses. Brainstorm and investigation are in `BRAINSTORM.md`.

## Context

When Rook is in a `web:<host>` environment it only knows what someone has already put
in the repository by hand. The repository, approval, and materialization machinery can
already represent and load everything a website might publish; nothing fetches it.
This change adds the fetcher: a scout that probes a website for agent-facing resources
and a read-only repository that serves the result through the normal offer → approve
→ materialize flow. It is the first concrete slice of #64.

## Decision details

- **Resources.** Three host-rooted URLs per `web:<host>` environment:
  `https://<host>/llms.txt` → `llms-txt`; `https://<host>/AGENTS.md` → `instructions`;
  `https://<host>/.well-known/agent-skills/index.json` → one `skill` per entry, per
  the Cloudflare Agent Skills Discovery RFC (`$schema` must be a recognized
  `schemas.agentskills.io/discovery/…` URI; entries need `name`, `type`, `description`,
  `url`, `digest`). Only `type: "skill-md"` entries are fetched (the `url` is a single
  `SKILL.md`, verified against `sha256:<hex>`); `archive` entries and entries whose
  digest fails are skipped and reported in the bundle's `errors`. Path-scoped ids
  (`web:host/path`) are not scouted. MCP is out of scope (#3, #107).
- **Shape.** New `WebEnvironmentRepository` (`repositoryId: "web"`, read-only, only
  `getBundles`, `listEnvironments`, `searchBundles` implemented) serving from a persistent store filled
  by a `WebEnvironmentScout`. One synthesized bundle per host: `bundleId: "site"`,
  `id: "<envId>#site"`, `repository: "web"`, `publisher: <host>`, `editable` unset so
  materialization takes the read-only path. A host with nothing found yields
  `environment` but zero bundles (mirrors `ProjectDirectoryEnvironmentRepository`).
- **Trigger and persistence.** Scouting starts when a `web:` candidate is registered
  (`POST /api/environments/register`, already fire-and-forget). `getBundles` never does
  network I/O; it reads a **persistent SQLite store** so scouted capabilities survive
  restarts and are available offline and to search. The store lives at
  `<ROOK_HOME>/web-environment-repository.db` (profile-isolated via `getRookHomeDir()`),
  uses the existing repository schema (`environments`/`capabilities`/`bundles`, written
  through `SQLiteEnvironmentRepository`-style ingest) plus a `web_scouts` table per host:
  `fetched_at`, `etag`/`last_modified` per resource, `last_status`. Refresh policy: on
  registration, if the host's entry is older than the TTL (default 24 h, env override)
  re-scout in the background using conditional requests (`If-None-Match` /
  `If-Modified-Since`); if content changed, replace the bundle rows (new hash → new
  offer, per the approval model) and re-register the candidate so summaries and offers
  refresh without waiting for the next client registration. Hosts with nothing found are
  recorded too (negative entry, same TTL) so they are not re-probed on every visit.
  Client-side debounce (≈1 s focus delay, 60 s per-environment duplicate suppression) is
  relied on and noted; the scout adds a per-host in-flight guard.
- **Egress policy.** A small dedicated fetch helper: HTTPS only; 5 s timeout per
  request; 1 MiB response cap; follow at most 3 same-host redirects; refuse hosts that
  resolve to loopback/private/link-local addresses; fixed `User-Agent: Rook/<version>
  (+https://github.com/rookkeeper/rook)`; only 2xx bodies are used; 404 and network
  failures are non-errors for `llms.txt`/`AGENTS.md`/index (absent is normal) but are
  logged at debug. Skill URLs from the index may be cross-origin (RFC allows it) and go
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
  `server/README.md` list the new repository, its database, and the egress helper;
  `AS-BUILT-ARCHITECTURE/mac-client.md` notes the offer preview; the stale `.bundles` paths in
  `.agents/skills/debugging-rook/references/server-and-environment.md` are corrected.

## Work checklist

- [ ] `server/src/infrastructure/http/scoutFetch.ts` (name TBD in-code): the egress
      helper above, injectable `fetch`, typed result (`ok | absent | error`), unit tests
      for timeout, size cap, redirect limit, private-address refusal, HTTPS-only.
- [ ] Persistent store: `<ROOK_HOME>/web-environment-repository.db` opened through
      the existing `EnvironmentRepositoryDatastore` schema plus a `web_scouts` table
      (host, fetched_at, per-resource etag/last-modified, last_status); ingest/replace
      bundle rows for a host; read side for `getBundles`; staleness query.
- [ ] `WebEnvironmentScout` in `server/src/environments/`: given a host, fetch the
      three resources (conditional requests when the store has validators), parse the
      discovery index (schema check, field validation, `skill-md` only, digest
      verification), assemble capability file maps and `errors`, write to the store;
      per-host in-flight dedupe; negative entries; `scout(host)` returns whether the
      stored result changed.
- [ ] `WebEnvironmentRepository`: `getBundles(environmentId)` for `web:<host>` ids
      served from the store; `listEnvironments`/`searchBundles` over stored hosts;
      writes remain no-op. Wire into `CompositeEnvironmentRepository` in
      `server/src/index.ts` after `location-context`.
- [ ] Trigger: hook `web:` candidate registration to `scout(host)` when the host is
      unknown or stale (in the register route or a thin wrapper around
      `registerCandidateEnvironment`) and re-register the candidate when the result
      changed. Keep it fire-and-forget with logging.
- [ ] Shared types: `unreachable_url`, `unsupported_capability` error codes;
      `sourceUrl` hints; confirm `hashEnvironmentBundle` covers the new content
      unchanged.
- [ ] Tests (vitest, `// @vitest-environment node`, injected fake fetch): scout
      happy path (all three present), each resource absent, malformed index,
      unknown `$schema`, `archive` entry skipped with error, digest mismatch skipped,
      cross-origin skill URL, fresh entry skipped, stale entry re-scouted with
      conditional headers and 304 keeps rows, changed content replaces rows and
      reports change, negative entry honoured, in-flight dedupe; store round-trips
      across a reopen; repository serves store and returns no bundles for unknown
      hosts; composite integration; manager re-registration refreshes summaries and
      produces an offer on entry. One env-gated live test (`ROOK_WEB_SCOUT_LIVE=1`) against a
      real public site.
- [ ] Mac approval preview: `EnvironmentOfferDetail` loads the preview for the
      offered environment, matches the bundle by hash, and renders `llms.txt`,
      `AGENTS.md`, skill `SKILL.md` contents (collapsible) and errors; RookKit type
      gains `agentsMd` if needed; loading/failure states; RookKit decoding test.
- [ ] Docs per Decision details; add the discovery-index convention and a short
      "publish for Rook" note for site owners in `PRODUCT/environment-repository.md`.
- [ ] Manual verification (developer-driven): open a browser tab on a site that
      publishes at least one of the three resources; confirm the environment shows
      the `web` bundle, the offer appears on entry **with the content visible in the
      preview**, approval materializes the content read-only into the session
      workspace, the agent can use it, and after a server restart the site is still
      known without a re-fetch.
- [ ] `npm run typecheck` and `npm test` in `server/` pass; final review; sync with
      main; PR (documenting the adopted convention) through the fork.
