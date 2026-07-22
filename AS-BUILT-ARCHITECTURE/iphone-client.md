# iPhone Client

## Summary

The iPhone client is a native SwiftUI app that shares the chat/networking layer with the Mac app but swaps in a location-based environment provider. It turns user-defined geofenced places and visit-based arrivals into `location:` environments, supports voice, and renders an ActivityKit Live Activity.

## Main components

- `RookModel`
  - iOS app state, chat reducer, session management, environment offers, place handling, voice, and Live Activity updates
- `LocationProvider`
  - CoreLocation wrapper for region monitoring, visit monitoring, current location, and authorization
- `PlaceStore`
  - UserDefaults-backed storage for named places and visit suggestions
- `RookKit`
  - shared ACP socket, REST client, chat block models/views, voice, and Live Activity attributes
- `RookWidgets`
  - widget extension that renders the Live Activity / Dynamic Island surface

## Main interfaces

### Server-facing
Same shared contract as other clients:
- ACP WebSocket `/api/ws`
- REST health/runtime/session/environment APIs
- `POST /api/environments/register` for `location:<slug>` places
- `POST /api/environments/register-location` for dwell-based nearby-business identification

### iOS / system-facing
- CoreLocation region monitoring for named places
- `CLVisit` arrival detection for frequented-place suggestions and nearby-business identification
- Speech recognition + speech synthesis via shared `VoiceController`
- ActivityKit for Live Activity state

## Core data schemas

### Place model
- `Place`
  - `id` (slug)
  - `name`
  - `latitude`
  - `longitude`
  - `radius`
- `PlaceSuggestion`
  - `id`
  - `latitude`
  - `longitude`
  - `visitCount`

### Arrival context
`LocationProvider` builds:
- `coordinate`
- optional `horizontalAccuracy`
- optional `dwellSeconds`
- `isStationary`
- optional `speedMetersPerSecond`

### App state in `RookModel`
- server and session state
- `blocks: [ChatBlock]`
- pending environment offer
- environment list items
- current place name / `placeEnvironmentId`
- `placeSkillStatus[slug] -> Bool`
- `nearbyCandidates: [EnvironmentCandidate]`
- voice state
- current Live Activity handle

### Live Activity schema
`RookActivityAttributes.ContentState`:
- `placeName`
- `skillsActive`
- `agentStatus`
- `running`

## Main processes

### Place geofence flow
1. user defines places in `PlaceStore`
2. `LocationProvider` monitors each place as a circular region
3. on region enter / current-state-inside, `RookModel` builds `location:<slug>`
4. model checks `GET /api/environments/preview`
5. if bundles exist, it registers the environment with place metadata
6. server may offer bundles to the active session

### Visit / arrival identification flow
1. `CLVisit` arrival fires
2. `LocationProvider` applies a dwell-and-motion gate
3. `RookModel` posts `register-location`
4. server returns ranked nearby `EnvironmentCandidate`s and syncs them into active environments
5. when an environment enters, the chat shows a business banner with display name and website favicons

### Chat flow
1. model connects to `/api/ws`
2. session creation/resume is done over ACP
3. `AcpSocket` reduces wire frames into `AcpClientEvent`s
4. `RookModel` turns them into chat blocks, status text, queueing, and errors
5. on reconnect the model reloads the current session and re-announces place state

### Voice flow
1. user starts listening
2. on-device speech recognition produces the prompt text
3. prompt is sent like any typed prompt
4. after run completion, the reply is spoken if the turn started from voice

### Live Activity flow
1. when there is an active session or active place environment, `RookModel` computes `ContentState`
2. the app starts or updates the ActivityKit activity in the foreground
3. tapping `rook://open` returns the user to chat

## Notable architectural characteristics

- the iPhone app reuses the Mac chat/network stack but replaces foreground-app context with physical-place context
- region monitoring handles named places; visit/dwell detection handles nearby-business discovery
- place registration is guarded by environment preview so empty places do not create empty offers
- the Live Activity is an ambient architecture surface, not just a chat status indicator
