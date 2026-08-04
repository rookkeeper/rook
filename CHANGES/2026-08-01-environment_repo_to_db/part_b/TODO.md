# Part B TODO: shared capability workspace

This TODO describes the work needed to replace per-session capability copies with shared writable files and agent-workspace links.

The current implementation still copies capabilities into `.var/rook/agent-workspaces/<session-id>/`. The target implementation uses a temporary process-wide global workspace for writable SQLite content, direct links to project-owned files, and per-session agent-workspace links.

## Locked direction

- [x] Keep SQLite as the durable source of truth for SQLite-backed canonical and personal content.
- [x] Keep project directories as the source of truth for `dir:` environments.
- [x] Use a temporary process-wide global workspace for writable SQLite materializations.
- [x] Do not put immutable external content in the global writable workspace; materialize it directly into agent workspaces as read-only content.
- [x] Use the agent workspace as the runtime process `cwd`.
- [x] Keep the actual project directory out of the agent workspace for now; record exposing it later as future work.
- [x] Use `.agent` consistently for Rook-managed agent workspace content.
- [x] Make the aggregate agent-workspace `AGENTS.md` read-only and generate it from a template containing concrete relative paths and authoring instructions.
- [x] Use `.agent/AGENTS_FILES/<environment-nickname>/AGENTS.md` for per-environment instruction sources.
- [x] Use `.agent/editable-skills/<environment-nickname>/` as the creation/editing area for writable skills.
- [x] Link existing writable skills into both `.agent/editable-skills/<environment-nickname>/` and `.agent/skills/`.
- [x] Keep non-writable external skills in `.agent/skills/` as read-only materialized files, not global links.
- [x] Make a new skill real once its directory contains `SKILL.md`.
- [x] For directory environments, write new skills to `.agents/skills/` in the project directory and new instructions to the project-root `AGENTS.md`.
- [x] Do not create an SQLite personal bundle automatically for a directory environment.
- [x] Use `directory` rather than `personal` as the project-directory bundle ID.
- [x] Use a simple collision policy for skills: the first skill keeps its name; later collisions use `_2`, `_3`, and so on for the workspace folder/link only.
- [x] Accept same-user filesystem permissions as the current safety boundary; defer a separate runtime user or stronger sandboxing.
- [x] Do not preserve existing local database data during this redesign; schemas and local databases may be dropped and recreated.

## 1. Normalize repository and environment identity

- [ ] Change `ProjectDirectoryEnvironmentRepository` to return `bundleId: "directory"`.
- [ ] Stop `CompositeEnvironmentRepository.ensurePersonalBundle()` from creating SQLite personal bundles for `dir:` environments.
- [ ] Make composite write routing distinguish repository identity and bundle identity, even though writable user content currently maps to either SQLite `personal` or project `directory`.
- [ ] Define the source identity used by the global workspace as a composite of repository, environment, bundle, artifact kind, and artifact ID.
- [ ] Define a path-safe encoding for source identities; do not use raw environment IDs as filesystem paths without escaping.
- [ ] Define stable environment nicknames from path-safe display names, with deterministic collision suffixes.
- [ ] Keep the nickname as an agent-facing path component while retaining the full environment identity in the server-owned mapping.

### Acceptance gates

- [ ] A registered `dir:` environment produces only a `directory` project bundle unless the user explicitly creates another supported source.
- [ ] A project bundle and a SQLite personal bundle cannot be confused by composite read/write routing.
- [ ] Two environments with the same display name receive distinct, stable workspace nicknames.
- [ ] Environment IDs containing `/`, `:`, or other path-significant characters cannot escape the workspace root.

## 2. Define the temporary global workspace

- [ ] Add a process-owned temporary global workspace root, created when the server starts and removed when the server exits.
- [ ] Decide the exact root location and ensure it is not treated as durable repository storage.
- [ ] Add a server-owned mapping/manifest for every global path, recording source identity, mutability, and materialization state.
- [ ] Use stable paths for personal SQLite capabilities during the lifetime of the process.
- [ ] Do not add reference counting or garbage collection in this phase.
- [ ] Add startup reconciliation that can rebuild the global workspace entirely from SQLite and active project sources.
- [ ] Add shutdown cleanup that tolerates incomplete or already-removed files.

### Acceptance gates

- [ ] The global workspace can be deleted while Rook is stopped and is recreated correctly on the next start.
- [ ] Rebuilding it from SQLite produces the same writable capability files and source mappings.
- [ ] No global workspace path is treated as the durable source of truth.
- [ ] An orphaned global file cannot be mistaken for a repository artifact without a valid mapping.

## 3. Materialize existing writable skills and instruction files

- [ ] Replace per-session copying of writable SQLite skills with one global writable materialization per source identity.
- [ ] Materialize existing SQLite personal skills into the global workspace.
- [ ] Create links from `.agent/skills/<skill-name>` to writable global skill directories.
- [ ] Create matching links from `.agent/editable-skills/<environment-nickname>/<skill-name>` to those same writable skill directories.
- [ ] Keep `.agent/skills/` itself non-writable by ordinary agent operations after links have been created.
- [ ] Allow the individual writable skill targets to remain writable through both link locations.
- [ ] Materialize immutable external skills directly into `.agent/skills/` as read-only files/directories, without global links.
- [ ] Apply the simple `_2`, `_3`, etc. collision policy without changing the skill’s internal `name` metadata.
- [ ] Preserve the mapping between the displayed folder name and the original artifact ID.
- [ ] Create one per-environment instruction source at `.agent/AGENTS_FILES/<environment-nickname>/AGENTS.md`.
- [ ] For SQLite-backed writable instructions, create a temporary global source file without creating a database artifact until the user writes content.
- [ ] For immutable external instructions, use a read-only direct materialization rather than a writable global source.
- [ ] For existing project instructions, link directly to the project’s actual `AGENTS.md`/`CLAUDE.md` source as appropriate.

### Acceptance gates

- [ ] An existing personal skill is editable through both `.agent/skills/<name>` and `.agent/editable-skills/<environment>/<name>`.
- [ ] Both links resolve to the same underlying file tree.
- [ ] An external skill is readable but is not linked to the writable global workspace.
- [ ] An existing project skill is linked directly to its project source.
- [ ] An empty personal instruction source can be edited even though no SQLite artifact exists yet.
- [ ] The aggregate `AGENTS.md` never becomes the source of truth for individual instruction content.

## 4. Generate the aggregate AGENTS.md

- [ ] Replace the current marker-based write-back model with per-environment source files.
- [ ] Define a template for the aggregate `AGENTS.md`.
- [ ] Include Rook authoring instructions in that template.
- [ ] Include concrete relative paths for editing environment instruction files.
- [ ] Include concrete relative paths for creating new skills under `.agent/editable-skills/<environment-nickname>/`.
- [ ] Include an entry for every active environment, including an empty placeholder when its writable instruction source has no content.
- [ ] Include full source text inside each generated environment instruction section.
- [ ] Escape environment names, paths, and source content safely for the chosen generated format.
- [ ] Make the aggregate file read-only after generation.
- [ ] Regenerate the aggregate when environment membership changes or a source instruction file changes.
- [ ] Stop injecting the same environment instructions through both `EnvironmentManager.runtimeInstructionsForSession()` and the materialized aggregate.
- [ ] Keep the base Rook identity injection separate from the generated environment file.

### Acceptance gates

- [ ] The aggregate contains one concrete source path per environment.
- [ ] The agent is told to edit the individual linked file rather than the aggregate.
- [ ] Editing an individual source file updates the global/project source and regenerates the aggregate.
- [ ] The aggregate is not writable through normal agent file operations.
- [ ] No environment instructions are duplicated through the old template path and the aggregate path.
- [ ] No runtime restart is required merely to regenerate the aggregate file.

## 5. Add editable-skill creation slots

- [ ] Create `.agent/editable-skills/<environment-nickname>/` for every writable environment.
- [ ] Make each creation-slot directory point to a known writable global or project source location.
- [ ] Ensure the agent is instructed to create new skills only inside the appropriate environment slot.
- [ ] Keep `.agent/skills/` unavailable for arbitrary new entries under normal permissions.
- [ ] Detect a new skill when `SKILL.md` appears in an editable-skill slot.
- [ ] Validate the basic skill structure and required standard frontmatter.
- [ ] For a SQLite-backed environment, create the new personal artifact in SQLite after `SKILL.md` exists.
- [ ] For a directory environment, create `.agents/skills/` in the project if necessary, copy the new skill there, and replace the temporary source with a direct project link.
- [ ] After a new skill becomes real, add the corresponding `.agent/skills/<name>` link while keeping the `.agent/editable-skills/<environment>/<name>` link.
- [ ] Ensure subsequent edits through either link update the same source.
- [ ] Do not require environment ownership metadata in `SKILL.md` when the skill is created through an environment-specific slot.
- [ ] Define the behavior when an agent attempts to create a skill directly under `.agent/skills/`.

### Acceptance gates

- [ ] A new SQLite skill created under one environment slot becomes a SQLite personal artifact and receives both links.
- [ ] A new project skill creates `.agents/skills/` and the named skill directory in the project, then receives direct project links.
- [ ] A new skill does not become real merely because an empty directory exists.
- [ ] A skill created through the wrong or unknown location is not silently assigned to an environment.
- [ ] A skill remains editable from its normal `.agent/skills/<name>` location after promotion.

## 6. Handle project-directory sources

- [ ] Watch active project source directories directly; do not mirror existing project files into the global SQLite workspace first.
- [ ] Watch the actual project skill roots and instruction files, not only the agent-workspace symlinks.
- [ ] Support the existing project skill root conventions while creating new skills specifically under `.agents/skills/`.
- [ ] Create the project’s `.agents/skills/` directory on first new project-skill write when it does not exist.
- [ ] Create the project-root `AGENTS.md` on first new instruction write when it does not exist.
- [ ] Keep project changes out of SQLite revision/write-back APIs.
- [ ] Reconcile project changes into agent-workspace links and the aggregate `AGENTS.md`.
- [ ] Remove project-directory handling that assumes a SQLite personal bundle exists.
- [ ] Decide how project `CLAUDE.md` participates in the per-environment instruction source without making the project aggregate ambiguous.

### Acceptance gates

- [ ] An existing project skill is edited through an agent-workspace link and changes in the project directory.
- [ ] An external edit to a project skill is visible after reconciliation.
- [ ] A missing project skill root is created only when a new project skill is written.
- [ ] A missing project `AGENTS.md` is created only when new project instructions are written.
- [ ] No project skill or instruction content is written into SQLite.

## 7. Implement the watcher and serializer

- [ ] Add one watcher for the temporary global writable workspace rather than one watcher per session.
- [ ] Add watchers for active project source roots because project files bypass the global workspace.
- [ ] Debounce filesystem events and wait for file/directory content to settle before serialization.
- [ ] Handle atomic temporary-file writes and rename-based saves.
- [ ] Handle additions, edits, renames, and deletions.
- [ ] Avoid reacting to Rook’s own materialization and link creation as user edits.
- [ ] Validate real paths and reject symlink escapes from approved roots.
- [ ] Serialize complete changed skill trees, not only the file that generated the event.
- [ ] Create new SQLite revisions for changed SQLite-backed personal artifacts.
- [ ] Keep dirty files available to the runtime if SQLite persistence fails.
- [ ] Queue and retry failed SQLite writes.
- [ ] Add startup reconciliation for events missed while Rook was not running.
- [ ] Add a simple write serialization policy; defer multi-user locking and conflict merging.
- [ ] Decide whether revision/hash checks are needed to avoid accidental same-user last-write overwrites.

### Acceptance gates

- [ ] Editing a linked SQLite skill is persisted without a session restart.
- [ ] Editing a linked project skill changes the project file without SQLite activity.
- [ ] A newly created SQLite skill is persisted after its `SKILL.md` settles.
- [ ] A failed database write does not discard the dirty global file.
- [ ] Rook-generated events do not create an infinite write/materialize loop.
- [ ] A watcher restart or missed event is repaired by reconciliation.

## 8. Change runtime startup and session lifecycle

- [ ] Move agent workspace roots to the chosen per-session location under `~/.rook/agent-workspaces/<session-id>/`.
- [ ] Set the runtime subprocess `cwd` to the agent workspace.
- [ ] Ensure the workspace exists before runtime session creation/loading.
- [ ] Remove duplicate explicit skill injection when runtime discovery through the workspace is sufficient.
- [ ] Keep the project directory out of the agent workspace for this phase.
- [ ] Preserve the project directory as a future-work item for a later coding-workspace integration.
- [ ] Ensure environment entry/exit updates links without destroying shared global sources used by other sessions.
- [ ] Ensure session close removes only session links, not shared global writable files.
- [ ] Ensure runtime reload behavior is not triggered for ordinary shared-file edits.
- [ ] Rebuild the aggregate `AGENTS.md` when membership changes without requiring a server restart.
- [ ] Validate behavior across Pi, Claude, Cursor, and generic ACP runtimes.

### Acceptance gates

- [ ] A runtime starts with the agent workspace as `cwd`.
- [ ] The runtime discovers the generated `AGENTS.md` and `.agent/skills` without duplicate prompt/skill injection.
- [ ] Closing one session does not remove files still used by another session.
- [ ] Entering or leaving an environment updates only that session’s links.
- [ ] Shared personal edits do not force other active sessions to restart.
- [ ] Session restoration rebuilds correct links after a Rook restart.

## 9. Replace the old materializer lifecycle

- [ ] Split the current materializer responsibilities into global-source materialization and per-session-link materialization without introducing unnecessary repository layers.
- [ ] Keep repository code responsible for SQLite/project persistence and source reads.
- [ ] Keep the workspace manager responsible for global paths, links, manifests, and watchers.
- [ ] Preserve the repository/service/API layering already established.
- [ ] Remove per-session writable-copy synchronization once shared links are working.
- [ ] Retain direct read-only materialization for immutable external content.
- [ ] Remove obsolete `sourcePath` fallback behavior once project links replace copied project skills.
- [ ] Drop and recreate local databases as needed during this redesign rather than preserving obsolete schema compatibility.

### Acceptance gates

- [ ] No writable capability is independently copied into more than one session workspace.
- [ ] SQLite-backed content has one shared global writable file tree per source.
- [ ] Project-backed content is written directly to the project source.
- [ ] External content remains direct, read-only session materialization.
- [ ] The old per-session write-back path is no longer used for shared writable content.

## 10. Test and validate the complete flow

- [ ] Add unit tests for stable source-key/path generation.
- [ ] Add tests for environment nickname collisions.
- [ ] Add tests for bundle identity collisions and the `directory` project bundle.
- [ ] Add tests that SQLite personal bundles are not created for `dir:` environments.
- [ ] Add tests for empty writable AGENTS placeholders.
- [ ] Add tests for editable skill links in both `.agent/skills` and `.agent/editable-skills`.
- [ ] Add tests for non-writable external skill materialization.
- [ ] Add tests for skill-name collision suffixes without changing skill frontmatter.
- [ ] Add tests for new SQLite skills created from editable slots.
- [ ] Add tests for new project skills and missing project directories.
- [ ] Add tests for new project `AGENTS.md` creation.
- [ ] Add tests for AGENTS aggregate generation from the template.
- [ ] Add tests for source-file edits and aggregate regeneration without restart.
- [ ] Add watcher tests for debounce, atomic writes, retries, and feedback loops.
- [ ] Add tests for project-source watchers that do not write SQLite.
- [ ] Add multi-session tests proving shared links point to the same underlying files.
- [ ] Add restart/crash reconciliation tests.
- [ ] Run the full server typecheck and test suite.
- [ ] Run real Pi validation with the new cwd and link topology.
- [ ] Run real Claude/Cursor validation where configured.
- [ ] Update product, architecture, README, and FAQ documentation after behavior stabilizes.

### Final acceptance gates

- [ ] A user can edit an existing personal skill naturally through `.agent/skills/<name>`.
- [ ] A user can create a new personal skill through `.agent/editable-skills/<environment>/` and then use it through `.agent/skills/<name>`.
- [ ] A user can edit/create project skills and instructions without SQLite persistence.
- [ ] The aggregate `AGENTS.md` accurately explains all authoring paths and remains read-only.
- [ ] Multiple sessions share writable capability files without independent-copy overwrite behavior.
- [ ] Immutable external content cannot be accidentally persisted through the writable watcher.
- [ ] The global workspace can be discarded and rebuilt from durable sources.

## Future work

- [ ] Consider a separate OS user or stronger sandbox for runtime isolation.
- [ ] Decide whether to expose the actual project directory inside the agent workspace for coding tasks.
- [ ] Add multi-user locking, optimistic concurrency, or conflict merging for shared mutable capabilities.
- [ ] Add global workspace garbage collection if retained files become significant.
- [ ] Add richer MCP discovery, startup, authentication, lifecycle, and approval behavior.
- [ ] Define a more complete capability model for apps, facts, and generated reference skills.
- [ ] Revisit whether dynamic agent instructions should be reloaded into already-running runtime system prompts.
