# As-built functionality inventory

Baseline: `AS-BUILT-ARCHITECTURE/README.md` and all six surface/database documents. This inventory is the map used for the duplicate search. “Intentional” means two implementations were found but are required by platform, lifetime, or fallback semantics; “finding” links to the detailed audit entry.

## Common system shape

| Functionality | Current owner/path | Audit result |
|---|---|---|
| REST session discovery | `server/src/sessions/routes/sessionRoutes.ts`, `RookAPI.sessions()`, Android `RookApi.sessions()` | Sole current discovery path; old WebSocket list removed in [session-list](server/sessions/websocket-session-list.md) |
| Session-bound ACP WebSocket | `acpFacadeRoute.ts`, RookKit `SessionHandle`, Mac controller, Android/CLI clients | Current path across clients; transport lag removed in [Android](clients/android/session-transport-lag.md) and [CLI](clients/cli/session-transport-lag.md) |
| One runtime subprocess per public session | `AgentRuntimeManager` + `SessionRuntime` | Current; no duplicate owner found |

## Server architecture

| Functionality | Current owner/path | Audit result |
|---|---|---|
| Fastify composition/auth/health | `server/src/index.ts`, `infrastructure/auth.ts` | Current; legacy web-client option removed in [legacy web-client option](server/infrastructure/legacy-web-client-option.md) |
| Configured runtime catalog | `infrastructure/config/agentRuntimes.ts` | Current sole catalog; old profile loader removed in [agent profile/runtime catalogs](server/infrastructure/agent-profile-config.md) |
| Local profile paths and worktree state | `configPaths.ts`, launcher profile helpers | Current; old path migration removed in [legacy config migration](server/infrastructure/legacy-config-migration.md) |
| SQLite connection | `infrastructure/datastores/RookDatastore.ts` | Current; no duplicate backend found |
| Public session repository | `sessions/datastores/SqliteSessionRepository.ts` | Current; no duplicate backend found |
| Transcript persistence/normalization | `SessionTranscriptStore.ts`, `sessionTranscriptEvents.ts` | Current; no duplicate owner found |
| Runtime process transport | `runtime/SessionRuntime.ts` | Current; no duplicate owner found |
| Runtime orchestration/restarts | `runtime/services/AgentRuntimeManager.ts` | Current; orphaned room/realtime helpers removed in [room/realtime stack](server/runtime/orphaned-room-realtime-stack.md) |
| ACP facade methods | `runtime/routes/acpFacadeRoute.ts` | Canonical `session/new`, `session/load`, prompt/control, and close methods; old list/resume aliases removed in [session-list](server/sessions/websocket-session-list.md) and [load/resume](server/sessions/load-resume-alias.md) |
| Runtime REST catalog | `runtime/routes/runtimeRoutes.ts` | Current; old `/api/agents` tooling path removed in [removed-stack CLI](tooling/removed-stack-remote-agent-cli.md) |
| Environment registration/offers/decisions | `EnvironmentManager`, environment routes, decision registry/store | Candidate registration is canonical; permanent decisions require bundle hashes. Historical compatibility removed in [legacy registration](server/environments/legacy-registration-method.md) and [legacy decisions](server/environments/legacy-decision-shape.md) |
| Bundle repository facade | `EnvironmentRepositoryService` + composite directory/location repositories | Intentional composition; no old/new duplicate found |
| Location identification | `EnvironmentIdentifier` + POI provider | Provider abstraction is intentional; no duplicate owner found |
| Location registration/auto-entry | `LocationRegistrar` | Dwell gate fails closed when motion evidence is absent; compatibility branch removed in [motion compatibility](server/location/permissive-motion-compatibility.md) |
| Location context bundle | `LocationContextRepository` + generated `SKILL.md` | Generated skill bundle is the current delivery path; unused renderer removed in [orphaned renderer](server/location/orphaned-location-prompt-renderer.md) |
| Runtime realtime helpers | `AgentRuntimeManager` subscriber/replay maps | Old unused room/event classes in [room/realtime stack](server/runtime/orphaned-room-realtime-stack.md) |

## Database

| Functionality | Current owner/path | Audit result |
|---|---|---|
| `sessions` table | `SqliteSessionRepository` | Current |
| `session_environments` table | `SqliteSessionRepository` | Current |
| `session_transcript_events` table | `SessionTranscriptStore` | Current |
| `environment_decisions` table | `EnvironmentDecisionStore` | Current bundle-hash lookup with required `bundle_id`; nullable legacy rows migrated out in [legacy decisions](server/environments/legacy-decision-shape.md) |
| In-memory active/recent environments | `EnvironmentManager` | Intentional transient state |
| In-memory accept/ignore decisions | `SessionDecisionRegistry` | Intentional lifetime split from durable decisions, not duplicate |

## macOS client

| Functionality | Current owner/path | Audit result |
|---|---|---|
| App state/reducer | `RookMacModel` | Projection of controllers; no second chat reducer found |
| Per-session chat state/socket | RookKit `SessionHandle` | Current |
| Session registry/discovery | `ChatSessionController` + REST | Current REST path; inherited socket list method removed |
| Chat rendering | RookKit design components + Mac views | Platform composition, not old/new duplicate |
| Foreground app monitoring | `ForegroundAppMonitor` | Current |
| Specialist/generic environment provider selection | `AppEnvironmentProvider` and provider registry | Intentional one-specialist-or-generic fallback |
| Accessibility context | `AXReader`, generic/provider implementations | Current; provider-specific code is intentional |
| MacBridge perception/control | `MacBridge` and native services | Current |
| Server supervision | `ServerController` | Current; stale web-app affordance removed |
| Voice/hotkey/input/screen/image services | Mac service files | Platform capabilities; no old/new duplicate found |

## iPhone client

| Functionality | Current owner/path | Audit result |
|---|---|---|
| App reducer/state | `RookModel` | Projects shared handle; migration residue removed in [chat migration residue](clients/apple/iphone-chat-migration-residue.md) |
| Per-session chat/socket/reconnect | RookKit `SessionHandle` | Current |
| Session discovery | `RookAPI.sessions()` | Sole current path; old socket list method removed |
| Transcript hydration | `RookAPI.sessionTranscript()` + `SessionHandle.attach()` | Current Apple path |
| Place storage/geofences/visits | `PlaceStore`, `LocationProvider` | Intentional iOS implementation |
| Location candidate registration | `registerLocation` | Current commit path; read-only identify endpoint is intentionally separate |
| Voice | shared `VoiceController` | Current |
| Live Activity | `RookActivityAttributes`, widget extension | Current |
| Token storage | Keychain | Keychain-only; old UserDefaults migration removed in [iPhone auth migration](clients/apple/iphone-auth-token-migration.md) |

## RookKit

| Functionality | Current owner/path | Audit result |
|---|---|---|
| ACP WebSocket transport | `Net/AcpSocket.swift` | Current transport primitive; unused `sessionList()` removed with the old session-list path |
| Per-session lifecycle/reduction | `Net/SessionHandle.swift` | Current Apple implementation |
| REST client/DTOs | `Net/RookAPI.swift`, `Models/ApiTypes.swift` | Current |
| Chat models/rendering | `Models/ChatBlocks.swift`, `Design/*` | Shared substrate; not a backwards-compatibility duplicate |
| Voice/live activity/keychain/utilities | package support files | Current |

## Android client

| Functionality | Current owner/path | Audit result |
|---|---|---|
| App reducer/state | `RookViewModel` | Current Android owner; session transport lag removed in [Android transport lag](clients/android/session-transport-lag.md) |
| ACP transport/event reduction | `net/AcpSocket` | Current Android implementation with session-bound sockets and standard ACP events; old compatibility removed in [legacy ACP events](clients/android/legacy-acp-events.md) |
| REST control plane | `net/RookApi` | Current; read-only identify and committing register are intentionally separate |
| Location/presence controller | `LocationController` | Process-wide design is intentional |
| Background movement/arrival | `MovementService` + movement package | Android-specific alternative to iOS location; no duplicate owner found |
| Headless arrival registration | `MovementService.postArrivalDirectly` | Intentional UI-bound/headless split |
| Places/storage | `PlaceStore` | Android-specific persistence |
| Compose screens/rendering | `ui/*` | Kotlin platform implementation; no old/new duplicate found |

## Tooling

| Functionality | Current owner/path | Audit result |
|---|---|---|
| Standalone CLI chat/session client | `clients/cli` | Current package with REST discovery/transcript hydration and session-bound attach; lag removed in [CLI transport lag](clients/cli/session-transport-lag.md) |
| Remote-agent developer CLI | `clients/cli` | Removed-stack developer CLI deleted; current CLI is documented in [removed-stack CLI](tooling/removed-stack-remote-agent-cli.md) |
| Launcher/profile helpers | `scripts/lib/run-rook` | Current; no leftover compatibility branch found after server config migration removal |
| Environment diagnostics/decision dump | `scripts/print-environments.sh`, `dump-environment-decisions.sh` | Current tooling |

## TODOs

- [x] Revalidate every “Current” row after each cleanup change.
- [x] Promote any newly discovered duplicate functionality to a detailed finding document.
- [x] Remove links to resolved findings only after code, tests, and documentation are updated.
- [x] Run the relevant server, Swift, Kotlin, and CLI verification suites before closing rows.
