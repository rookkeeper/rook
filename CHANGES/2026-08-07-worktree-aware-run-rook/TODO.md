# Worktree-aware `run-rook.sh` TODO

## Purpose

Make the local Rook launcher understand whether it is being run from the main Rook checkout or from a Git worktree. The main checkout should behave as the stable, production-like local Rook instance. A worktree should behave as an isolated development instance that can run beside the main instance without sharing ports, durable state, logs, or Mac app identity.

This change is about local process/configuration isolation. It should not change the environment-repository data model, repository API, bundle format, or environment behavior. Any server changes should be limited to making already-configurable paths actually honor the selected launcher profile.

## Goal and desired end result

After this work, these commands should be safe and predictable:

```bash
# Main checkout: stable local Rook
cd /Users/johnberryman/projects/github/rookkeeper/rook
./scripts/run-rook.sh mac server

# Worktree: isolated development Rook
cd /Users/johnberryman/projects/github/rookkeeper/_worktrees/environment-repo-db
./scripts/run-rook.sh mac server
```

The main checkout should use the current production-like defaults:

- server port `7665`
- current `.var/run-rook/` process/log directory
- current application database location under `.var/rook/`
- user-local home `~/.rook/`
- normal `Rook` Mac app identity
- existing remote-network behavior when explicitly configured

A worktree should derive a stable slug from its folder name, such as `environment-repo-db`, and use:

- a deterministic development port that does not collide with `7665` or other worktrees
- an isolated Rook home such as `~/.rook-environment-repo-db/`
- an isolated application database, runtime configuration, and personal environment-repository state
- worktree-specific logs, PID files, and build outputs
- a distinguishable Mac app identity such as `Rook Dev`
- loopback-only server binding by default
- profile-specific stop behavior that cannot terminate the production instance

The launcher should support explicit overrides for unusual setups, but the default behavior should require no extra flags.

## Design decisions to settle first

- [x] Treat “production Rook” as the stable local Debug/npm-dev process using production state; a true Release build remains a separate concern.
- [x] Identify the production checkout with an explicit `ROOK_PRODUCTION_ROOT` override and a Git-worktree default.
- [x] Make the checkout containing the script authoritative; explicit profile overrides handle unusual invocations.
- [x] Use ports `8000-8999` with deterministic CRC32 allocation for development worktrees.
- [x] Use `com.rookery.Rook.Dev.<worktree-slug>` and `Rook Dev (<worktree-slug>)` for development Mac builds.
- [x] Reuse the configured bearer token; development remains loopback-only by default.
- [x] Make `stop` profile-scoped by default, with an explicit `stop --all` escape hatch.

## Launcher profile detection and configuration

- [x] Add a launcher profile concept such as `production` versus `development`.
- [x] Add explicit overrides such as `ROOK_RUN_MODE=production|development`.
- [x] Determine the current checkout root from the script location and verify it is a Rook checkout.
- [x] Determine the main production checkout robustly using `ROOK_PRODUCTION_ROOT` and/or `git worktree list`.
- [x] Detect and reject ambiguous production requests outside the production checkout unless explicitly allowed.
- [x] Derive a filesystem-safe worktree slug from the worktree directory name.
- [x] Derive a stable development port from the slug, while allowing `ROOK_SERVER_PORT` or an explicit profile port override.
- [x] Export the selected server port as `PORT` so the server cannot continue using the main `.env` value of `7665` accidentally.
- [x] Preserve the existing `.env` loading behavior while making profile-specific values win over inherited production values.
- [x] Set `ROOK_HOME` to `~/.rook` for production and `~/.rook-<worktree-slug>` for development.
- [x] Seed a new development `ROOK_HOME` by copying `~/.rook` when the profile home does not exist, then keep later configuration changes isolated.
- [x] Set a profile-specific database path through `ROOK_DATABASE_PATH`.
- [x] Set a profile-specific run root for logs, PID files, build artifacts, and launch metadata.
- [x] Make development loopback-only by default by overriding inherited remote bind settings unless explicitly opted into.
- [x] Keep the selected profile, checkout root, port, Rook home, and database path visible in launcher logs.

## Server path and configuration plumbing

- [x] Make server startup honor `ROOK_HOME` everywhere user-local Rook state is read or written.
- [x] Replace the hardcoded `~/.rook/environment-repository` path in `server/src/index.ts` with the configured Rook home path.
- [x] Replace the hardcoded `~/.rook/environment-repository` path in `EnvironmentBinding` with the configured Rook home path.
- [x] Add a server configuration path for the application SQLite database, preserving the current production default when unset.
- [x] Make `RookDatastore` use the selected database path without changing the schema or persistence behavior.
- [x] Confirm runtime profile/config loading already follows `ROOK_HOME`; add a binding regression test.
- [ ] Confirm generated runtime launchers and other `.var` artifacts remain checkout-local and do not leak into another profile.
- [ ] Confirm metadata capture, location-context artifacts, and logs are intentionally checkout-local for development.
- [ ] Confirm the worktree’s canonical `environment-repository/` is used by that worktree’s server, while its personal repository comes from the worktree-specific Rook home.
- [ ] Keep all environment-repository interfaces, bundle formats, and environment lifecycle behavior unchanged.

## Mac client isolation

- [x] Add a development Mac build identity, including a distinct bundle identifier and visible display name.
- [x] Ensure production and development builds can run simultaneously without sharing macOS `UserDefaults` state.
- [x] Decide to reuse the configured Keychain token service for now; both local profiles use the same configured bearer token.
- [x] Ensure `ROOK_SERVER_BASE_URL` and `ROOK_AUTH_TOKEN` are passed to the correct app instance at launch.
- [x] Ensure the development app displays enough profile/port information to distinguish it from production.
- [x] Make `ServerController` inherit the same profile, port, Rook home, database path, and binding settings when it starts a server from inside the Mac app.
- [x] Prevent the Mac app’s managed-server button from accidentally starting a default production server from a worktree build.
- [x] Keep Xcode build products isolated by checkout and profile.
- [ ] Verify foreground-app monitoring and any other loopback services do not confuse the production and development app instances.

## Process management and stop behavior

- [ ] Replace broad `pkill -f Rook` behavior with profile-aware app/process tracking.
- [ ] Make server PID files profile-specific and verify that a PID belongs to the expected checkout before killing it.
- [ ] Make port cleanup profile-specific and refuse to kill an unrelated healthy server.
- [ ] Make `./scripts/run-rook.sh stop` stop only the current profile by default.
- [ ] Add an explicit `stop --all` or equivalent for intentionally stopping every local Rook instance.
- [ ] Ensure starting a development instance does not stop the production Mac app or production server.
- [ ] Ensure starting production does not stop development worktree instances.
- [ ] Handle stale PID files and stale app processes safely.
- [ ] Preserve the existing behavior that `stop` shuts down selected client targets, while making its scope explicit.

## Other launcher targets

- [ ] Preserve existing server URL handling for the physical iPhone, simulator, and Android targets.
- [ ] Make simulator launches use the selected profile port automatically.
- [ ] Make physical-device launches use the selected profile port when a reachable host is explicitly configured.
- [x] Ensure development mode does not accidentally expose a remote listener to a phone unless requested.
- [ ] Decide whether development app identities are needed for iPhone/simulator/Android or whether server/data/port isolation is sufficient.
- [x] Update target-specific launcher logs so they show the selected profile and server URL.

## Tests and verification

- [x] Add shell-level tests for production/worktree detection and launcher lifecycle behavior.
- [x] Test slug sanitization, including same-basename worktrees in different paths.
- [x] Test deterministic port allocation and explicit port overrides.
- [x] Test that production and development resolve different Rook homes, databases, run roots, and ports.
- [x] Test that a development home is seeded once from `~/.rook` and is not refreshed on later launches.
- [x] Test that inherited `.env` values cannot silently force a development server back onto port `7665` or re-enable its remote listener.
- [x] Add server tests for `ROOK_HOME`-based personal repository paths.
- [x] Add server tests for the configurable application database path.
- [ ] Build and launch production from the main checkout using the new launcher.
- [x] Build and launch development from a worktree.
- [x] Run both production and development servers simultaneously and verify both health endpoints respond to their own ports.
- [ ] Create a session in each instance and verify the sessions/databases do not overlap.
- [ ] Verify personal configuration and personal environment-repository state do not overlap.
- [ ] Verify the worktree server reads the worktree’s canonical repository rather than the main checkout’s canonical repository.
- [x] Verify stopping the development profile leaves production running.
- [ ] Verify stopping production leaves the development profile running.
- [x] Run the server typecheck, build, and test suite.
- [x] Run the hermetic launcher profile and lifecycle test suite.
- [x] Run the relevant Mac build and launcher smoke checks.

## Documentation and cleanup

- [x] Update `scripts/README.md` with production/worktree examples and profile behavior.
- [x] Update the root `README.md` because the normal local launch workflow changed.
- [x] Update `server/README.md` with `ROOK_HOME`, database, and profile configuration behavior.
- [x] Update `clients/mac/README.md` with the development app identity and launch behavior.
- [x] Update relevant as-built architecture documents to describe the profile-aware launcher and isolated local state.
- [x] Document how to override the production root, profile, port, Rook home, and server URL.
- [ ] Document how to clean up an abandoned worktree’s `~/.rook-<worktree-slug>` directory safely.
- [ ] Remove temporary compatibility code and stale launcher assumptions after verification.
- [x] Confirm the final change does not modify environment-repository content or its public behavior.
