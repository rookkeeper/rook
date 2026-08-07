# Soft deletion and unified personal environment sources

## Target schema

The target environment-repository schema has exactly three tables:

```sql
environments (
  environment_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
)

capabilities (
  capability_id TEXT PRIMARY KEY, -- UUID
  type TEXT NOT NULL,              -- skill, instructions, llms-txt, facts, mcp, or app
  name TEXT NOT NULL,
  files_json TEXT NOT NULL,        -- complete nested file map
  content_hash TEXT NOT NULL
)

bundles (
  bundle_id TEXT NOT NULL,         -- UUID grouping one atomic bundle
  environment_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  publisher TEXT NOT NULL DEFAULT 'default',
  deleted_at TEXT NULL,
  PRIMARY KEY (bundle_id, capability_id),
  FOREIGN KEY (environment_id) REFERENCES environments(environment_id),
  FOREIGN KEY (capability_id) REFERENCES capabilities(capability_id)
)
```

A capability may be referenced by bundle memberships in multiple environments. `deleted_at` is membership-scoped, so deleting a capability from one environment does not delete shared capability content elsewhere. There are no revision tables, revision pointers, or persistent empty bundles.

## Target global workspace shape

The writable global workspace should have one project-shaped source directory per personal environment:

```text
~/.rook/global-workspace/writable/<environment-key>/
├── AGENTS.md
└── .agents/
    └── skills/
        ├── <skill-name>/
        └── <skill-name>/
```

Each active session gets disposable links into that shared source:

```text
~/.rook/agent-workspaces/<session-id>/
├── AGENTS.md                                      generated aggregate, read-only
└── .agents/
    ├── AGENTS_FILES/<environment>                -> global environment directory
    ├── editable-skills/<environment>             -> global environment/.agents/skills
    └── skills/<visible-name>                     -> shared skill source
```

This mirrors the project-directory layout, keeps instructions and skills in one per-environment source, avoids conflicting per-session copies, and lets the existing global watcher observe edits, creation, and deletion through the shared source. Canonical/external content remains read-only and project-directory content remains directly linked to project files.

## Rationale and handoff requirements

- [ ] Treat this document's three-table schema and final simplified-schema section as authoritative when they conflict with the current implementation or earlier migration documents.
- [ ] Preserve the product behavior requested by the user, not incidental behavior introduced by the current revision-based implementation.
- [ ] Do not add revision history, revision pointers, bundle snapshots, or a separate instructions storage format.
- [ ] Use `files_json` as the uniform representation for every capability, including complete skill directories with `SKILL.md`, scripts, references, and other assets.
- [ ] Keep bundle loading and approval atomic: one bundle is the set of active capability memberships sharing a `bundle_id`, and its hash is derived deterministically from active capability content.
- [ ] Keep capability UUIDs stable when possible so a deleted membership can be restored; keep human-readable names for authoring paths and display.
- [ ] Scope deletion to the bundle membership. A shared capability's content remains in `capabilities` when one environment deletes its membership.
- [ ] Treat canonical capabilities as immutable and read-only; do not allow filesystem deletion to create personal tombstones for canonical content.
- [ ] Treat `dir:` environments as direct project-file sources. Their `AGENTS.md` and `.agents/skills` files remain project-owned and are not written to SQLite.
- [ ] Treat the generated workspace-root `AGENTS.md` as a read-only projection. Only `.agents/AGENTS_FILES/<environment>/AGENTS.md` is an editable instruction source.
- [ ] Keep the public repository/service layer bundle-oriented where possible by projecting normalized capability rows into the existing `EnvironmentBundle` shape, while removing revision metadata and adding generic capability deletion/restoration operations.
- [ ] Remember that the current implementation is revision-based: `EnvironmentRepositoryDatastore`, `SQLiteEnvironmentRepository`, `EnvironmentBundle.revision`, and revision-oriented tests all require migration or removal.
- [ ] Remember that the current implementation persists an empty personal bundle on entry; the target behavior is temporary authoring state only, with the first durable bundle membership created when real content appears.
- [ ] Prefer the existing global watcher and the merged per-environment global source topology over a new watcher. Add another watcher only if the target symlink topology cannot reliably surface source deletion.
- [ ] Suppress deletion inference while materializing, rebuilding, cleaning up, or intentionally removing session projections.
- [ ] Preserve the existing safety rule that normal `.agents/skills` discovery may contain read-only content, while new user-authored content belongs under `.agents/editable-skills/<environment>/`.

- [ ] Confirm the deletion contract: only writable personal sources can be soft-deleted; canonical content remains read-only, and project-directory content remains owned by the project filesystem.
- [ ] Keep generated workspace-root `AGENTS.md` projection-only and read-only; treat deletion of `.agents/AGENTS_FILES/<environment>/AGENTS.md` as deletion of that environment's writable instruction source.
- [ ] Define the durable membership identity as bundle, environment, and capability UUID, with a nullable `deleted_at` timestamp on the bundle membership.
- [ ] Store capability content in the unified `capabilities` table and deletion state in the `bundles` membership table; do not add a revision or current-source table.
- [ ] Preserve deleted capability content so a membership can be restored without losing its files; do not preserve revision history.
- [ ] Make `getBundles`, search, previews, approval hashing, and runtime resolution exclude soft-deleted bundle memberships while retaining their capability content in SQLite.
- [ ] Define recreation behavior: creating the same capability in the same bundle clears its membership deletion marker and makes it active again.
- [ ] Design explicit repository operations for soft-delete, restore, and undelete-on-recreation of bundle memberships.
- [ ] Reshape writable personal materialization into one project-shaped global source per environment:
  - [ ] `global-workspace/writable/<environment-key>/AGENTS.md`
  - [ ] `global-workspace/writable/<environment-key>/.agents/skills/<skill-name>/`
- [ ] Link `.agents/AGENTS_FILES/<environment>` to the shared environment source directory.
- [ ] Link `.agents/editable-skills/<environment>` to the shared environment `.agents/skills` directory.
- [ ] Continue linking runtime-discovered `.agents/skills/<skill-name>` entries to the same shared skill source while preserving collision handling and read-only external materialization.
- [ ] Keep project-directory links direct to project-owned `AGENTS.md` and `.agents/skills`; do not route project deletions through the personal SQLite repository.
- [ ] Update `CapabilityWorkspaceManager` source descriptors, manifests, fingerprints, materialization, write-back, and cleanup for the unified per-environment source.
- [ ] Extend the existing global watcher reconciliation to detect missing instruction files and skill directories, distinguishing intentional rebuild/session cleanup from user deletion.
- [ ] Treat a missing writable source as a deletion candidate only after debounce and against the manager's known source inventory; never infer deletion from a stale or disposable session workspace.
- [ ] Ensure a deletion detected from one shared source propagates to every active session using that environment and refreshes aggregate `AGENTS.md` projections.
- [ ] Remove deleted skills from runtime discovery and remove deleted instruction blocks from generated aggregate files without deleting the aggregate file itself.
- [ ] Preserve non-writable protections so deleting or modifying canonical/external projections cannot create a writable or deleted personal source.
- [ ] Reset/recreate canonical and personal environment-repository databases using the final schema; no data-preserving migration is required.
- [ ] Add new repository tests for soft deletion, restoration, recreation, content preservation, filtering, and mixed active/deleted capabilities in one bundle.
- [ ] Modify existing repository tests to cover the three-table schema and membership-scoped deletion behavior.
- [ ] Add new workspace tests for unified symlink topology, instruction deletion, skill deletion, shared multi-session propagation, rebuild suppression, and aggregate regeneration.
- [ ] Modify existing workspace/materialization tests for the unified per-environment source layout and lazy authoring.
- [ ] Add end-to-end tests that delete `.agents/AGENTS_FILES/<environment>/AGENTS.md` and `.agents/editable-skills/<environment>/<skill>` and verify SQLite soft deletion.
- [ ] Verify that deleting the generated root `AGENTS.md` is either blocked by read-only permissions or safely regenerated without changing source records.
- [ ] Update `PRODUCT/` documentation for unified capabilities, membership tombstones, restoration, and lazy personal bundles.
- [ ] Update `AS-BUILT-ARCHITECTURE/` documentation for the three-table schema, repository/API projection, and workspace topology.
- [ ] Update README and migration documentation to describe the final model.
- [ ] Manually validate deletion and restoration through Pi, the Mac client, and multiple simultaneous sessions before considering the feature complete.
- [ ] Reevaluate the entire refactor and remove all compatibility code, shims, and intermediate-design paths; retain only the final three-table and unified-workspace behavior.

## Final simplified schema and lazy personal authoring

The following decisions supersede the earlier revision-oriented schema items above.

- [ ] Replace the current revision-based environment schema with exactly three tables:
  - [ ] `environments` for environment identity, display name, description, and metadata.
  - [ ] `capabilities` for reusable capability content and content hashes.
  - [ ] `bundles` as the environment/capability membership table.
- [ ] Use UUID `TEXT` identifiers for capabilities.
- [ ] Keep capability names separately from UUIDs for display, authoring paths, and skill names.
- [ ] Allow one capability to be referenced by bundles in multiple environments.
- [ ] Store every capability in the same nested file-map format:
  - [ ] Skills include `SKILL.md`, scripts, references, and other files.
  - [ ] Instructions use an `AGENTS.md` file entry.
  - [ ] `llms.txt` uses an `llms.txt` file entry.
  - [ ] Facts use one or more fact file entries.
  - [ ] MCP and app content use the same representation where supported.
- [ ] Store `content_hash` on each capability without storing revisions or revision pointers.
- [ ] Derive the atomic bundle hash deterministically from the active capabilities in the bundle.
- [ ] Put nullable `deleted_at` on the `bundles` membership rows so deleting a capability from one environment does not delete shared capability content everywhere.
- [ ] Make `publisher` a bundle-membership field with a default value of `default` unless a real publisher is available.
- [ ] Remove `bundle_revisions`, `revision_artifacts`, `current_revision_key`, and the separate `agents_md` bundle column from the runtime schema.
- [ ] Recreate existing canonical and personal databases with the final schema; preserving old repository data is explicitly not required.
- [ ] Preserve deleted capability content in `capabilities`; restoration clears the membership row's `deleted_at`.
- [ ] Make recreating a deleted capability in the same bundle clear its membership tombstone and reactivate it.
- [ ] Do not create an empty personal bundle when an environment is entered.
- [ ] Provide temporary session authoring state for an entered environment with no personal capabilities.
- [ ] Create the first bundle membership only when real `AGENTS.md`, skill, fact, `llms.txt`, MCP, or app content is authored.
- [ ] Ensure empty directories and unchanged default instruction placeholders remain non-durable.
- [ ] Preserve the bundle-oriented `EnvironmentBundle` API by projecting normalized capability rows back into skills, instructions, facts, `llms.txt`, MCP, and app fields.
- [ ] Remove revision metadata from API models and preview payloads.
- [ ] Replace revision-oriented repository write-back with generic capability create, update, soft-delete, restore, and recreation operations.
- [ ] Keep canonical capabilities read-only and keep project-directory capabilities owned directly by project files.
- [ ] Implement the project-shaped personal global source per environment:
  - [ ] `global-workspace/writable/<environment-key>/AGENTS.md`
  - [ ] `global-workspace/writable/<environment-key>/.agents/skills/<skill-name>/`
- [ ] Link `.agents/AGENTS_FILES/<environment>` to the shared environment source directory.
- [ ] Link `.agents/editable-skills/<environment>` to the shared environment `.agents/skills` directory.
- [ ] Extend the existing global watcher to reconcile deleted instruction files and skill directories without adding a separate session watcher unless the merged topology proves insufficient.
- [ ] Suppress deletion inference during session rebuild, startup cleanup, and intentional projection removal.
- [ ] Add new schema-bootstrap, repository, API, materialization, watcher, soft-delete, restoration, lazy-authoring, and multi-session regression tests for this final model.
- [ ] Modify existing repository, API, materialization, and watcher tests to remove revision and persistent-empty-bundle assumptions; no data-preserving migration tests are required.
- [ ] Update `PRODUCT/` documentation for the final three-table capability model and membership-scoped deletion.
- [ ] Update `AS-BUILT-ARCHITECTURE/` documentation for the final database, server, and runtime workspace behavior.
- [ ] Update the earlier TODO items, README, and migration material that still describe revisions or persistent empty personal bundles.
- [ ] Reevaluate the entire refactor and remove all compatibility code, shims, and intermediate-design paths; retain only the final three-table and unified-workspace behavior.

## Success criteria

- [ ] A fresh database contains only `environments`, `capabilities`, and `bundles` for environment-repository storage.
- [ ] Removing and recreating an existing database produces the final three-table schema without revision tables or revision pointers at runtime.
- [ ] A skill, `AGENTS.md`, `llms.txt`, facts, MCP content, or app content is stored through the same capability file-map representation.
- [ ] The same capability UUID can be attached to multiple bundle memberships and environments.
- [ ] Deleting a writable capability from one environment sets that membership's `deleted_at`, removes it from that environment's runtime projection, and leaves the shared capability content available elsewhere.
- [ ] Restoring or recreating the capability clears `deleted_at` and makes it available again without losing its files.
- [ ] No empty personal bundle or default placeholder is persisted merely because an environment was entered.
- [ ] The first real authored instruction or capability creates the necessary environment, capability, and bundle-membership rows.
- [ ] Bundle hashes change when active capability content or membership changes and remain independent of filesystem paths.
- [ ] Canonical content cannot be made writable or soft-deleted through a session workspace.
- [ ] Project-directory edits remain in the project filesystem and never appear as personal SQLite capability rows.
- [ ] Deleting `.agents/AGENTS_FILES/<environment>/AGENTS.md` soft-deletes only the corresponding writable membership.
- [ ] Deleting `.agents/editable-skills/<environment>/<skill>` soft-deletes only the corresponding writable membership.
- [ ] All active sessions sharing the source observe deletion/restoration and regenerated aggregate instructions.
- [ ] Workspace rebuilds and session cleanup do not create false deletion records.
- [ ] New and modified tests cover schema migration, repository projection, API behavior, symlink topology, watcher reconciliation, deletion, restoration, lazy authoring, and multiple sessions.
- [ ] `PRODUCT/` and `AS-BUILT-ARCHITECTURE/` accurately describe the final three-table model and no longer describe revisions or persistent empty bundles.
