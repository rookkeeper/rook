# User-local database unification

We want to clean up Rook's user-local persistence model in phases.

## What we want

- All user-local mutable state should consistently live under `ROOK_HOME`.
- The application database and the personal environment repository database should eventually become one database.
- The canonical checked-in environment repository database should remain separate.
- Later, we want to support more interesting queries across personal capabilities, bundles, and durable decisions (for example: find approved skills / approved bundles / capabilities tied to approved content).

## Current state

Production defaults are currently split in an awkward way:

- `ROOK_HOME` defaults to `~/.rook`
- development worktrees default `ROOK_HOME` to `~/.rook-<worktree-slug>`
- the application database still defaults to repo-local `.var/rook/rook.sqlite` in production
- the personal environment repository database defaults to `~/.rook/environment-repository.db`
- some other user-local paths still hardcode `~/.rook` instead of honoring `ROOK_HOME`

That means the docs and the intended profile model are ahead of the implementation.

## Confirmed code / doc touchpoints

- `scripts/lib/run-rook/profile.sh`
  - production `ROOK_HOME` = `~/.rook`
  - dev/worktree `ROOK_HOME` = `~/.rook-<worktree-slug>`
  - production application DB still forced to `.var/rook/rook.sqlite`
- `server/src/infrastructure/config/configPaths.ts`
  - config paths honor `ROOK_HOME`
- `server/src/index.ts`
  - personal environment repository DB defaults to `os.homedir()/.rook/environment-repository.db`
- `server/src/runtime/CapabilityWorkspaceManager.ts`
  - global workspace and session workspaces default to `~/.rook/...`
- `AS-BUILT-ARCHITECTURE/database.md`
- `AS-BUILT-ARCHITECTURE/server.md`
- `PRODUCT/environment-repository.md`
- `PRODUCT/environment-state.md`
- `PRODUCT/relationship-between-sessions-and-environments.md`

## Current database split

Application DB (`rook.sqlite` today, but repo-local in production):

- `sessions`
- `session_environments`
- `session_transcript_events`
- `environment_decisions`

Personal environment repository DB (`~/.rook/environment-repository.db` today):

- `environments`
- `capabilities`
- `bundles`

Canonical repo DB stays separate:

- checked-in `environment-repository.db` in the repo
- read-only curated content

## Proposed direction

### Phase 1: honor `ROOK_HOME` everywhere

Make all user-local mutable paths derive from `ROOK_HOME`, including:

- application database path
- personal environment repository database path
- global workspace root
- session workspace root
- any related launcher / client env propagation / tests

This should make production and worktree profiles behave consistently and isolate local state correctly.

### Phase 2: merge the user-local databases

Move from:

- one application DB file
- one personal repository DB file

To:

- one user-local database file under `ROOK_HOME`

Likely target:

- `ROOK_HOME/rook.sqlite`

The canonical checked-in repository database should remain separate.

### Phase 3: make cross-table queries actually useful

Once the user-local tables are in one DB, we can decide what cross-table querying shape we want.

Examples we may want:

- find approved bundles for a given environment
- find approved skills/capabilities
- find personal capabilities that were ever loaded in approved bundles
- inspect capabilities alongside decision state

Just putting the tables in one file is not enough for all of these.

## Important schema reality

Today `environment_decisions` is keyed by `bundle_hash`, while repository content is organized around:

- `bundle_id`
- `environment_id`
- `capability_id`

That means a future "show me approved skills" query is not automatically easy just because the tables share one SQLite file.

We will probably need one of these later:

1. change the decision model to store additional stable relational keys alongside `bundle_hash`
2. add a derived/projection table that maps resolved bundle hashes to bundle/capability membership
3. do some joins plus recomputation in code, if the query volume is small and purely diagnostic

My current bias is that we should keep `bundle_hash` as the approval boundary, but probably store more relational context or create a projection once we know the actual queries we need.

## Why merging seems good

- personal capabilities are application state, not an external concern
- one user-local DB under `ROOK_HOME` better matches the profile model
- backup/inspection/export of user-local mutable state becomes simpler
- development worktree isolation becomes more coherent
- one datastore/bootstrap for user-local mutable state is conceptually cleaner
- future joins / admin queries / diagnostics become possible without attaching multiple DB files

## Reasons to be cautious

These are real concerns, but none currently look fatal:

- transcript/session tables have a much higher write rate than personal capability content
- one-file corruption or migration bugs would affect both session history and authored personal content
- if we ever want to export/share/sync only personal environment content, separating it from transcripts might have been convenient
- "one DB" does not by itself solve the bundle-hash join problem

At the moment this still feels like the right product direction.

## Non-goals

- do not merge the canonical checked-in environment repository into the user-local DB
- do not change canonical repository semantics as part of the early phases
- do not prematurely redesign approvals until we know the real queries we want

## Questions to settle

1. Should the unified user-local DB filename be `rook.sqlite` or something else?
   - leaning: keep `rook.sqlite`
2. In phase 1, do we move production immediately from repo-local `.var/rook/rook.sqlite` to `ROOK_HOME/rook.sqlite`, or support a one-time migration/fallback read?
3. In phase 2, should we create a new shared datastore/bootstrap class for the unified user-local DB, or evolve `RookDatastore` into the user-local datastore and have repository/session code share it?
4. Do we want the personal repository DB env var to survive as a temporary compatibility override during migration, or should we remove it quickly once the merge lands?
5. What exact "approved skills / approved bundles" queries do we want to support first, so we can shape the eventual decision/projection schema around real needs?

## Rough implementation staging

### Phase 1

- make all user-local defaults honor `ROOK_HOME`
- move application DB default under `ROOK_HOME`
- update launcher tests, server tests, docs, and architecture notes
- decide on migration behavior from old production `.var/rook/rook.sqlite`

### Phase 2

- unify app DB + personal repository DB into one SQLite file
- make session/decision/repository code share one DB connection/bootstrap for the user-local DB
- migrate existing personal repository tables/data into the unified DB
- remove the split-brain defaults/docs

### Phase 3

- add join-friendly relational context or projection tables if needed
- expose useful diagnostics/searches for approved bundles/capabilities/skills
- revisit indexes once real queries exist

## Current recommendation

Proceed in phases:

1. first fix `ROOK_HOME` consistency everywhere
2. then merge application + personal repository state into one user-local DB
3. then shape join/query support based on the real inspections we want

That keeps the direction aligned with the product model without forcing the decision-schema redesign into the same first chunk.
