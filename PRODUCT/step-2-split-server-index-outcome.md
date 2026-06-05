# Step 2 outcome: split server index

Branch:
- `refactor/split-server-index`

## What changed

This step reduced `agent-server-client/src/server/index.ts` to bootstrap wiring and moved endpoint-specific logic into dedicated modules.

Main extractions:
- `src/server/routes/agentRoutes.ts`
- `src/server/routes/environmentRoutes.ts`
- `src/server/routes/websocketRoute.ts`
- `src/server/clientApp.ts`
- `src/server/roomRuntime.ts`
- `src/server/serverHelpers.ts`
- `src/server/serverPaths.ts`

`index.ts` now mainly does three things:
- construct shared dependencies
- register route groups
- attach client-serving middleware/static hosting

## Architectural outcome

The API surface is now grouped by responsibility:
- agent/session endpoints
- environment endpoints
- websocket endpoint
- client hosting/bootstrap

That makes the server easier to scan and gives later refactors a clearer home without continuing to grow `index.ts`.

## Size result

Approximate line-count change:
- `src/server/index.ts`: `390` → `65`

## Validation completed

From `agent-server-client/`:

```bash
npm test
npm run build
```

Status:
- tests passing
- build passing

## Manual QA checklist

### 1. Start server successfully
1. Run:
   ```bash
   npm run dev
   ```
2. Confirm the app/server boots without route errors

### 2. Start a new agent session
1. Open the app
2. Start a new session
3. Confirm the session starts normally

### 3. Resume an existing session
1. Reopen or continue a saved session
2. Confirm replay data still appears as expected

### 4. Verify websocket and replay
1. Send at least one chat message
2. Refresh or reconnect
3. Confirm replay and live updates still work

### 5. Verify environment endpoints
1. Register an environment:
   ```bash
   ../scripts/inject-environment.sh demo:demo
   ```
2. Confirm preview/approval still works
3. Confirm unavailable/decision flows still work

### 6. Verify Chrome extension flow
1. Open a supported site such as Wikipedia in Chrome
2. Launch the panel
3. Confirm environment availability reaches the app end to end

## Notes for next step

With route/bootstrap code split out, the next hotspot is `src/server/realtime/SessionRoom.ts`, which can now be reduced without mixing that work into server routing concerns.
