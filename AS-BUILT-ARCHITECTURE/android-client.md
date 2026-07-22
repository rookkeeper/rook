# Android Client

## Summary

The Android client is a native Kotlin + Jetpack Compose app that mirrors the iPhone client's session/chat architecture, uses an ACP WebSocket client plus REST control plane, and adds Android-specific background location services built around a foreground `MovementService` instead of iOS geofences.

## Main components

- `RookViewModel`
  - main app reducer and state owner
  - mirrors the iPhone `RookModel` closely
- `MainActivity` / `RookApp`
  - Compose root, dialog/sheet host, and intent wiring
- `net/AcpSocket`
  - OkHttp WebSocket ACP client with event reduction into `AcpClientEvent`
- `net/RookApi`
  - OkHttp REST client for health, runtimes, environments, and location registration
- `LocationController`
  - process-wide location/presence controller shared by UI and services
- `MovementService`
  - long-lived foreground service using GPS + accelerometer + activity recognition to infer arrivals
- `PlaceStore`
  - persisted place/suggestion state
- Compose UI screens
  - agent picker, chat, settings, places, environments, environment offer sheet

## Main interfaces

### Server-facing
- ACP WebSocket `/api/ws`
- REST calls for runtimes, health, environment preview/list, environment registration, and `register-location`

### Android/system-facing
- foreground service with persistent notification
- fused or fallback location source
- accelerometer sampling
- optional activity-recognition automotive signal
- shared preferences / encrypted auth token storage

## Core data schemas

### View-model state
StateFlows for:
- server state
- agents and sessions
- current session and chat visibility
- `blocks: List<ChatBlock>`
- queued messages
- environment offers and environment list items
- places, suggestions, place skill status
- current place name / `placeEnvironmentId`
- nearby location candidates
- settings-sheet visibility

### Arrival context
`LocationController.ArrivalContext`:
- `latitude`, `longitude`
- optional `horizontalAccuracy`
- optional `dwellSeconds`
- `isStationary`
- optional `speedMetersPerSecond`

### Chat and API models
Android defines Kotlin equivalents of the Swift shared models:
- `AgentDefinition`, `AgentSessionSummary`
- `EnvironmentOffer`, `EnvironmentCandidate`, `EnvironmentListItem`, `EnvironmentPreview`
- `ChatBlock`, `ChatBlockKind`, `ToolBlockState`, `PlanEntry`
- `AcpClientEvent`

## Main processes

### App startup
1. `MainActivity` creates or reuses the singleton `LocationController`
2. optional server-url and simulated-arrival intent extras are applied
3. `RookApp` creates the `RookViewModel`
4. `viewModel.start()` wires socket collectors, location callbacks, and periodic health refresh

### Chat flow
1. `RookViewModel` ensures the ACP socket is connected
2. session creation/resume uses ACP
3. `AcpSocket` reduces WebSocket frames into `AcpClientEvent`
4. `RookViewModel` turns those events into `ChatBlock` lists and run state
5. reconnect logic reloads the current session and flushes queued prompts

### Place registration flow
1. region-like place state comes from `MovementService` checking current location against saved places
2. `LocationController.emitRegionChange` informs the UI when bound
3. `RookViewModel.handlePlace` previews `location:<slug>`
4. if bundles exist, it registers that place environment with the server

### Arrival detection flow
1. `MovementService` samples GPS, accelerometer, and optional activity-recognition state
2. `MovementClassifier` emits movement votes
3. `VoteDebouncer` stabilizes them
4. on transition into stationary, the service builds an arrival context
5. if UI is bound, `RookViewModel` posts `register-location`
6. if app is headless, the service posts `register-location` directly using persisted server credentials

### Environment offer flow
1. server emits `_com.rookkeeper/environment_offer`
2. `AcpSocket` maps it to `AcpClientEvent.EnvironmentOffered`
3. `RookViewModel` stores the pending offer
4. Compose renders `EnvironmentOfferSheet`
5. decision is sent back over the ACP extension

## Notable architectural characteristics

- Android uses a service-based movement classifier instead of iOS region monitoring
- the location controller is intentionally process-wide so UI and services share one source of truth when the process is alive
- the client is structurally close to the iPhone client, but the sensor/process model is much more Android-native
- some implementation details still lag the server contract in places, but the main as-built architecture is ACP + REST + service-driven location context
