# RookKit

## Summary

`clients/RookKit` is the shared Swift package for the Apple clients. It provides the protocol layer, common data models, chat rendering models/views, keychain helpers, voice support, and shared Live Activity types.

## Main components

- `Net/AcpSocket.swift`
  - connection-level ACP WebSocket client for `/api/ws`
  - owns request/response bookkeeping and event reduction
- `Net/RookAPI.swift`
  - REST client for health, runtimes, environments, and location identification
- `Models/ApiTypes.swift`
  - runtime/session/environment/location DTOs
- `Models/ChatBlocks.swift`
  - client-side chat/event abstractions used by both apps
- `Models/JSONValue.swift`
  - Codable dynamic JSON representation for round-tripping wire payloads
- `Design/*`
  - shared SwiftUI components and chat block renderers
- `Voice/VoiceController.swift`
  - shared speech recognition / speech synthesis wrapper
- `LiveActivity/RookActivityAttributes.swift`
  - iOS-only shared ActivityKit attributes
- support utilities
  - `KeychainStore`, `EnvironmentListPresentation`, `ToolPayloadFormatting`, `Clipboard`
    - `EnvironmentListPresentation` now owns shared environment-list presentation rules used by Apple clients, including whether a secondary `sourceName` should be shown (for example, hiding raw URL rows for `web:` environments while still showing useful non-web source context)

## Main interfaces

### ACP socket API
`AcpSocket` exposes:
- `connect(request:)`
- `disconnect()`
- `sessionList()`
- `createSession(runtimeId:title:cwd:)`
- `loadSession(_:)`
- `sendPrompt(text:)`
- `sendCancel()`
- `setMode(_:)`
- `setConfigOption(configId:value:)`
- `resolveEnvironmentOffer(environmentId:bundleHash:decision:)`
- event callbacks:
  - `onEvent: (AcpClientEvent) -> Void`
  - `onConnectionChange: (Bool) -> Void`

### REST client API
`RookAPI` exposes:
- `healthResult()` / `health()`
- `agents()`
- `environmentPreview(environmentId:)`
- `registerEnvironment(id:sourceName:metadata:)`
- `identifyEnvironments(_:)`
- `registerLocation(_:)`
- `decideEnvironment(...)`
- `enterEnvironment(...)` / `exitEnvironment(...)`
- `environmentList(sessionId:)`
- derived `webSocketURL` and authorized `webSocketRequest()`

## Core data schemas

### Runtime/session models
- `AgentDefinition`
  - `id`, `parentId`
- `AgentSessionSummary`
  - wraps raw JSON and exposes normalized accessors like `id`, `agent`, `name`, `updatedAt`, `startedAt`

### Environment/location models
- `EnvironmentArtifactPreview`
- `EnvironmentBundlePreview`
- `EnvironmentPreview`
- `EnvironmentOffer`
- `EnvironmentListItem`
- `IdentifyAvailableRequest`
- `EnvironmentCandidate`
- `RepositoryReadError`

### Chat/rendering models
- `ChatBlock`, `ChatBlockKind`
- `ToolBlockState`, `ToolBlockStatus`
- `PlanEntry`
- `AcpUsageCost`
- `AcpSessionMode`, `AcpModesState`
- `AcpConfigOption`, `AcpConfigOptionValue`
- `AcpPermissionToolCall`, `AcpPermissionOption`
- `EnvironmentBanner`
- `AcpClientEvent`

## Main processes

### Wire-frame reduction
1. `AcpSocket` sends JSON-RPC over the WebSocket
2. incoming frames are parsed into requests, responses, updates, permission prompts, and environment-offer messages
3. session updates are flattened into `AcpClientEvent`
4. app-specific models (`RookMacModel`, `RookModel`) reduce those events into UI state

### Prompt lifecycle
1. `sendPrompt` creates a tracked request ID
2. socket sends `session/prompt`
3. streaming updates emit text/thinking/tool events
4. the prompt response marks the run complete or failed

### Shared rendering flow
1. app reducers construct `ChatBlock`s
2. RookKit design views render the block list consistently across macOS and iOS
3. markdown/tool payload helpers normalize output for display
4. `EnvironmentListPresentation` applies shared list-refresh behavior and shared row-level display rules for environment metadata

## Notable architectural characteristics

- RookKit is not a full app framework; it is the shared protocol + UI substrate
- app-specific environment providers and platform capabilities live outside the package
- the package is the main reason the Mac and iPhone clients can stay protocol-identical while diverging in sensors and shell integration
