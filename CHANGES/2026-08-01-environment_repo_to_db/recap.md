# Environment-repository database migration recap

This recap follows a complete reread of the migration design log, ordered TODOs, product docs, and as-built architecture notes. It records what was actually delivered, how closely it met the original goals, and ways to verify the behavior yourself.

## Executive summary

The migration succeeded for the core goal: canonical and personal environment-repository content now lives in SQLite by default, while ACP runtimes continue to receive ordinary files in per-session workspaces.

The important compatibility decision was preserved: **bundles remain the atomic publication, review, approval, and runtime-loading unit**. The migration did not try to remove the bundle abstraction merely because the old storage was directory-shaped.

The live shape is now:

```text
client
  │ REST + ACP WebSocket
  ▼
Rook server
  ├── application SQLite: sessions, transcripts, membership, decisions
  ├── canonical environment SQLite: environment/bundle revisions
  ├── personal environment SQLite: writable user revisions
  ├── project-directory source: existing project files
  └── per-session workspace: files consumed by the ACP runtime
```

## What happened

### 1. The target contract was clarified

The design settled on these boundaries:

- a bundle is the atomic review/approval/runtime unit
- a bundle identity is separate from a content revision
- approval applies to the exact canonical content hash
- publisher version, source locator, fetch time, and provenance are metadata around the revision
- repository content is separate from application decisions
- runtime storage paths are not part of the runtime contract

The compatibility `EnvironmentBundle` read shape was retained while adding the database-backed revision model behind it.

### 2. Runtime materialization was built and connected

`AgentWorkspaceMaterializer` now creates a workspace under:

```text
.var/rook/agent-workspaces/<session-id>/
```

It materializes:

- nested skills under `.agent/skills/`
- generated readable `AGENTS.md` instructions
- facts inline when small and as generated reference skills when large
- `llms.txt` as a generated reference skill
- MCP content under a separate read-only `.agent/mcp-servers/` area

`AgentRuntimeManager` rebuilds the workspace when environment membership changes and on restored/restarted sessions. It gives the runtime the materialized skill paths and generated prompt text, while preserving the session `cwd` and existing ACP session identity.

The replacement runtime must successfully load the existing runtime session before the old subprocess is retired.

### 3. Personal authoring was carried through SQLite

Personal skills are writable in the session workspace. At synchronization points, the changed files go through the repository service and become a new personal SQLite revision.

Personal instructions have a more careful mapping. The generated aggregate `AGENTS.md` is derived output; it is not copied wholesale into the database. Only the marked personal instruction section is synchronized back to the personal bundle's instruction field.

Project-directory environments are intentionally different. Existing `.agents/skills`, `AGENTS.md`, `CLAUDE.md`, and `.mcp.json` files remain their own source of truth, with direct mappings where supported.

### 4. SQLite parity and live cutover were completed

The environment repository database contains:

- environments and display metadata
- bundle identity/current revision pointers
- immutable content revisions
- content hashes
- publisher/fetch/source/provenance fields
- revision artifact file maps
- validity/errors and compatibility source paths

Canonical and personal databases are composed into one logical repository view. The default server wiring now uses SQLite. The directory reader remains for import and compatibility only.

The checked-in canonical `environment-repository.db` was generated from the existing directory repository and validated against filesystem reads.

### 5. Capability families were added

The implementation now handles the initial non-skill families without pretending they all have the same runtime lifecycle:

- facts can be inline or pseudo-skills
- fetched `llms.txt` is stored, hashed, previewed, and exposed as a reference skill
- MCP configuration/content is stored, previewed, and materialized read-only
- project directories can contribute existing skills, instructions, and MCP configuration
- bundle previews and client models expose the expanded capability/revision shape

MCP server startup, live tool enumeration, authentication, permissions, sharing, and lifecycle were explicitly deferred rather than hidden behind a partial implementation.

### 6. Product and architecture integration was completed

The product docs now describe the SQLite source-of-truth model, personal authoring, workspace projections, bundle decisions, capability materialization, session behavior, and explicit deferrals.

The as-built architecture docs now describe:

- separate application/canonical/personal SQLite ownership
- repository revisions and artifacts
- project-directory exceptions
- per-session materialization and write-back
- expanded preview/client models
- repository-filtered search
- capability-specific runtime projections

## How well the work met the goals

| Goal | Assessment | Evidence / qualification |
|---|---|---|
| Move environment-repository storage to SQLite | **Met** | SQLite is the default for canonical and personal repositories; the canonical database is checked in. |
| Preserve bundles as the atomic unit | **Met** | Bundle identity, revision, preview, approval, and runtime loading remain intact. |
| Preserve file-based runtime behavior | **Met** | Runtimes still receive `.agent/skills`, `AGENTS.md`, and workspace files. |
| Keep user content writable | **Met for personal/project paths** | Personal skills/instructions write back to SQLite; project files map back to project sources. |
| Keep external content immutable/read-only | **Met as the current policy** | Read-only permissions and separate projections are implemented; this is not a strong same-user OS sandbox. |
| Approve exact agent-visible content | **Met** | Canonical content hashes include the relevant nested/filesystem content and are used for durable decisions. |
| Avoid permanent dual live implementations | **Met for normal repository storage** | Directory reading is retained as an importer/compatibility path; project directories are an intentional direct-source exception. |
| Support facts and `llms.txt` | **Met for the first runtime model** | Inline/pseudo-skill behavior is implemented and tested. |
| Support MCPs intelligently | **Partially met by design** | Configuration/content is reviewable and materialized; server execution/tool discovery/lifecycle remain future work. |
| Update clients and product behavior | **Met at the contract/model level** | RookKit and Android models include facts, `llms.txt`, and revision metadata; generic artifact presentation remains in place. |
| Prove production runtime behavior | **Partially met** | ACP integration uses the repository's MockAcpAgent; a manual run with every real external runtime was not performed. |

Overall, the core migration goals were met well. The remaining gaps are deliberately scoped follow-up projects rather than accidental omissions.

## Verification options

Run these from the migration worktree:

```bash
cd /Users/johnberryman/projects/github/rookkeeper/_worktrees/environment-repo-db
```

### 1. Run the complete automated server proof

```bash
cd server
npm run typecheck
npm test
```

Expected result from the completed work:

```text
25 test files passed, 1 skipped
131 tests passed, 5 skipped
```

This covers repository parity, revision hashing, materialization, runtime restart behavior, decisions, project directories, facts, `llms.txt`, MCP projections, and ACP authoring.

### 2. Run the focused migration tests

```bash
cd server
npm test -- \
  src/environments/repositories/SQLiteEnvironmentRepository.test.ts \
  src/environments/repositories/ProjectDirectoryEnvironmentRepository.test.ts \
  src/runtime/AgentWorkspaceMaterializer.test.ts \
  src/runtime/acpFacade.test.ts
```

The ACP facade test is the most useful single proof. It creates a session, registers an environment, approves a bundle, enters it, verifies a materialized skill, edits a personal skill through the mock agent, edits personal instructions, and verifies both changes through the repository preview.

### 3. Inspect the canonical database directly

If the SQLite CLI is installed:

```bash
sqlite3 environment-repository.db '.tables'
sqlite3 environment-repository.db \
  'select repository_id, environment_id, bundle_id, current_revision_key from environment_repository_bundles order by environment_id, bundle_id;'
sqlite3 environment-repository.db \
  'select artifact_kind, count(*) from environment_repository_revision_artifacts group by artifact_kind;'
sqlite3 environment-repository.db \
  'select bundle_id, content_hash, publisher_version, fetched_at, source_locator from environment_repository_bundle_revisions order by bundle_id;'
```

You should see separate environment, bundle, revision, and artifact rows rather than the runtime depending on the directory tree.

### 4. Prove filesystem/SQLite import parity yourself

Import the checked-in directory tree into a temporary database:

```bash
cd server
npm run environment:import-directory -- \
  ../environment-repository \
  /tmp/rook-environment-parity.db \
  canonical
```

Then inspect the temporary database with `sqlite3`, or use the existing SQLite repository tests as the stronger structural comparison. The imported bundle hashes should match the directory repository hashes because storage paths are excluded from canonical hashing.

### 5. Exercise the HTTP search and preview APIs

Start the server with its normal configuration, then try:

```bash
curl 'http://127.0.0.1:7665/api/environments/search?query=example'
curl 'http://127.0.0.1:7665/api/bundles/search?query=skill&repository=canonical'
curl 'http://127.0.0.1:7665/api/environments/preview?environmentId=web:example.com'
```

The preview should show bundle repository identity, validity, a content hash, revision/source metadata where present, skills, facts, `llmsTxt`, MCP/app artifacts, instructions, and errors.

If auth is enabled, add the configured bearer token to each request.

### 6. Prove the four decision paths

Use the preview's `bundleHash` in the decision endpoint:

```bash
curl -X POST http://127.0.0.1:7665/api/environments/decision \
  -H 'content-type: application/json' \
  -d '{"environmentId":"web:example.com","bundleHash":"<HASH>","decision":"approve"}'
```

Repeat in a disposable environment/session with `accept`, `ignore`, and `reject`. Confirm that:

- `accept` and `ignore` are temporary
- `approve` and `reject` are durable
- changing agent-visible content changes the hash and requires a new decision
- personal bundles do not require an offer decision

The automated environment manager and ACP tests cover these semantics more reliably than hand-written curl calls, but the API calls make the behavior visible.

### 7. Inspect a materialized workspace

Run the ACP integration test with a debugger or add a temporary pause after environment entry. Inspect:

```text
.var/rook/agent-workspaces/<session-id>/
.var/rook/agent-workspaces/<session-id>/.agent/skills/
.var/rook/agent-workspaces/<session-id>/AGENTS.md
.var/rook/agent-workspaces/<session-id>/.agent/mcp-servers/
```

Look for readable environment/bundle names in `AGENTS.md`, not repository ids or storage paths. External files should have read-only permissions. Personal skill files should be writable.

### 8. Verify personal authoring manually with MockAcpAgent

The stable automated route is:

```bash
cd server
npm test -- src/runtime/acpFacade.test.ts -t 'writes a personal skill'
```

For a more interactive proof, configure/use `MockAcpAgent`, enter `web:example.com`, and ask the agent to edit a personal skill. Then fetch the environment preview again. The changed skill file and its bundle hash should be visible in the personal repository view. Do the same for the marked personal instruction section in the generated `AGENTS.md`.

### 9. Verify restart reinjection

Run:

```bash
cd server
npm test -- src/runtime/acpFacade.test.ts -t 'materializes approved environment skills'
```

The test enters an environment after a session exists and checks the session-specific `.agent/skills` path. To test the failure mode yourself, edit or remove a generated workspace file, trigger an environment restart, and verify that the workspace is rebuilt from repository content rather than trusted as-is.

### 10. Verify project-directory environments

Create a temporary project containing:

```text
.agents/skills/example/SKILL.md
AGENTS.md
CLAUDE.md
.mcp.json
```

Register its `dir:` environment and inspect `/api/environments/preview`. The repository should report a `project-directory` bundle. Its skills/instructions should be read from the project source, and MCP content should appear as a separate read-only projection.

### 11. Verify the expanded capability families

The focused tests are useful demonstrations:

```bash
cd server
npm test -- src/runtime/AgentWorkspaceMaterializer.test.ts -t 'facts, llms.txt, and MCP'
npm test -- src/environments/repositories/ProjectDirectoryEnvironmentRepository.test.ts
```

Check that short facts appear in `AGENTS.md`, large facts appear as generated skills, `llms.txt` becomes a generated reference skill, and MCP content does not get mixed into the normal skills directory.

### 12. Validate Apple client contract changes

```bash
cd clients/RookKit
swift test
```

Expected result from the completed work: 61 tests pass. This confirms the shared Swift models can decode the expanded environment preview contract.

Android validation is also intended:

```bash
cd clients/android
./gradlew test
```

On the development machine used for this work, this could not run because no Java runtime was installed. Install/configure Java before treating Android validation as complete.

### 13. Try a real configured runtime

The automated ACP proof uses `MockAcpAgent`. For a higher-confidence integration check, configure a real ACP runtime in `~/.rook/config/agent-runtimes.json`, start the server/client normally, enter a test environment, approve a disposable canonical bundle, and confirm:

- the runtime receives the expected skill path
- generated instructions appear in its context
- environment entry/restart preserves the existing session
- canonical files cannot be edited through normal file permissions
- personal edits are reflected in the next preview/session

This is the most important validation not covered by the automated mock runtime.

## Commits and review state

The work was saved in ordered commits on the non-main branch `environment-repo-db`, including:

- `f0929e2` — close the target contract
- `4d27d0d` / `6d4ae9d` — connect materialization and restart handling
- `559b5bd` — ACP personal authoring proof
- `d28a2e5` — revision-aware SQLite parity/write-back
- `7336d94` — SQLite live cutover
- `1a22fe5` — capability families and project directories
- `1cdffe0` — product integration
- `dd28dea` — complete runtime materialization and personal authoring
- `8b913f7` — close historical migration limitations

The final review should happen through the pull request, not by committing or merging directly to `main`.
