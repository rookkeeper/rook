---
resolved: 2026-06-04
---

# Environment Manager: Next Steps

Implementing the first slice of the model described in `environment-model-and-dynamic-skill-availability-brainstorm.md`.

---

## Layering

The server follows three layers. New code must respect them:

| Layer | Existing examples | New additions |
|-------|------------------|---------------|
| **API** — Fastify route handlers; parse requests, call services, shape responses | routes in `index.ts` | two new routes in `index.ts` |
| **Service** — domain logic, in-memory state, coordination | `SessionRoomManager`, `SessionRoom`, `createOrReuseRoom`, `SkillInjectionStore` | `EnvironmentManager` |
| **Repository** — disk/db access behind a stable interface | `SessionEventStore`, `sessionLog.ts` | `LocalEnvironmentRepository` |

`EnvironmentManager` must not touch the filesystem directly. It calls `LocalEnvironmentRepository` for skill content, which reads from `environment-repository/` on disk. This positions us to swap in other repository backends (remote HTTP, SQLite) without touching the service layer.

The API layer owns agent restart decisions. `approveEnvironment` returns skill paths; the route handler calls `createOrReuseRoom` with those paths. `EnvironmentManager` never restarts agents.

---

## Scope notes

- **`demo:demo` environment ID** — kind `demo`, path `demo`. Fits the `<kind>:<unique path>` spec. Use the `environment-repository/demo/` directory.
- **Availability via API** — `POST /api/environments/register` or `./scripts/inject-environment.sh demo:demo` (no built-in timer).
- **Decision persistence deferred** — no approved/rejected memory yet for environments (and their skills). Every `registerAvailableEnvironment` triggers a fresh pending offer.
- **`onEnvironmentEntered` is a stub** — skill loading happens ad-hoc via the approve route calling `createOrReuseRoom`. The full `onEnvironmentEntered → room handles it` path comes later.
- **No duplicate restart logic** — `POST /api/environments/approve` calls the existing `createOrReuseRoom` (same function used by `POST /api/agent/start`). No new restart mechanism.
- **Notification via polling** — UI polls a new endpoint for pending offers. WebSocket push comes later.

---

## TODOs

### 1. Demo environment skill

- [ ] Create `environment-repository/demo/joke-telling/SKILL.md`
  - YAML front-matter: neutral description (mention nothing about pirates)
  - Body: instruct the agent to tell **only pirate jokes**, in full pirate register

### 2. Types

- [ ] Create `agent-server-client/src/server/environment/types.ts`
  - `EnvironmentRecord { id: string; metadata: Record<string, unknown> }`
  - `PendingEnvironmentOffer { environmentId: string; sessionId: string; skillPaths: string[] }`
  - `EnvironmentEventListener { onEnvironmentEntered(...), onEnvironmentExited(...), onEnvironmentStateChanged(...) }` (matches brainstorm API)

### 3. LocalEnvironmentRepository (repository layer)

- [ ] Create `agent-server-client/src/server/environment/LocalEnvironmentRepository.ts`
- [ ] `getSkillPaths(environmentId)` — resolves skill directory paths under `environment-repository/<kind>/<path>/` on disk; returns `string[]` (absolute paths to `skills/`-equivalent directories ready to pass to `createAgent`)

### 4. EnvironmentManager (service layer)

- [ ] Create `agent-server-client/src/server/environment/EnvironmentManager.ts`
- [ ] Constructor takes a `LocalEnvironmentRepository` (injected, not constructed internally)
- [ ] `registerAvailableEnvironment(env: EnvironmentRecord)` — adds to in-memory available set; asks `LocalEnvironmentRepository` for skill paths; creates a `PendingEnvironmentOffer` per subscribed session
- [ ] `markUnavailable(environmentId)` — stub / no-op for now
- [ ] `subscribe(sessionId, listener)` / `unsubscribe(sessionId)` — per-session `EnvironmentEventListener` registration
- [ ] `getPendingOffers(sessionId)` — returns pending offers for a session
- [ ] `approveEnvironment(environmentId, sessionId)` — removes offer from pending; emits `onEnvironmentEntered` on that session's listener (no-op stub for now); returns resolved skill paths to caller
- [ ] **`POST /api/environments/register { id, metadata? }`** — calls `registerAvailableEnvironment`; see `scripts/inject-environment.sh`

### 5. Wire into server (`index.ts`)

- [ ] Instantiate `LocalEnvironmentRepository` and `EnvironmentManager` singletons in `buildServer`
- [ ] After `roomManager.upsert`, call `environmentManager.subscribe(sessionId, noOpListener)`
- [ ] Call `environmentManager.unsubscribe(sessionId)` in the room's `onIdle` callback

### 6. New API endpoints

- [ ] `GET /api/environments/pending?sessionId=...` → `{ offers: PendingEnvironmentOffer[] }`
- [ ] `POST /api/environments/approve { environmentId, sessionId }` — calls `approveEnvironment` to get skill paths, then calls existing `createOrReuseRoom` with `restartExisting: true`; returns `{ ok, session }`

### 7. Documentation

- [ ] Update `agent-server-client/README.md` — add `EnvironmentManager` / `LocalEnvironmentRepository` to the server layer section and list the two new endpoints

---

## Future work (out of scope for this slice)

- Remove the 10-second demo timer; wire real external signals
- Persist environment decisions (approved / notify / rejected)
- Full `onEnvironmentEntered` → SessionRoom loads skills and restarts (removing the ad-hoc restart from the approve route)
- `onEnvironmentExited` → skill removal + runtime restart in place
- `onEnvironmentStateChanged` → terse events forwarded into session transcript
- `EnvironmentRepository` interface over `LocalEnvironmentRepository` so the API layer can be fully decoupled from disk paths
- Session transcript events for environment enter / exit
- UI for browsing / managing known environments
