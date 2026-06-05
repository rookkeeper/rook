# Step 1 outcome: remove skill-injection legacy

Branch:
- `refactor/remove-skill-injection-legacy`

## What changed

This step removed the remaining live skill-injection-era architecture from `agent-server-client` and aligned the app around the environment model.

Main changes:
- removed the `/api/skill-injections` server route
- removed `SkillInjectionStore` and its tests/validation path
- removed client transport support for persisting injected skill bundles
- removed old `injected_skills` parsing helpers and related tests
- renamed the remaining file-tree helper from `skillInjection.ts` to `skillFiles.ts`
- cleaned up UI naming so the main modal/notice language is environment-first instead of injection-first
- updated parent-message tool guidance so it refers to environment-hosted behavior instead of injected skills
- updated READMEs and related docs to stop presenting skill injection as an active architecture

## Architectural outcome

After this refactor, dynamic capability loading is centered on:
- environment availability
- environment approval decisions
- environment repositories
- environment-driven runtime rebuilds

There is no longer a separate supported runtime path for injecting arbitrary skill bundles into the app.

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

### 1. Normal session startup
1. Start the app:
   ```bash
   npm run dev
   ```
2. Open `http://127.0.0.1:3000`
3. Start a new session
4. Confirm normal chat still works

### 2. Environment approval flow
1. Open a supported Wikipedia page in Chrome
2. Click **Chat with YOUR agent.**
3. Confirm the environment approval modal appears in the relevant session
4. Approve with either:
   - **Allow this visit**
   - **Always allow**
5. Confirm the modal closes across open clients for that session

### 3. Environment preview still works
1. In the approval modal, inspect the listed skill(s)
2. Click between skill files
3. Confirm preview content still renders correctly

### 4. No legacy skill-injection path in main flow
1. Verify there is no `/api/skill-injections` usage in the app path
2. Verify environment availability still works through:
   - `POST /api/environments/register`
   - `POST /api/environments/unavailable`
   - `POST /api/environments/decision`
3. Verify reconnect/replay still works normally

## Notes for next step

With the legacy path removed, `src/server/index.ts` should now be easier to split because the API surface is more clearly environment/session focused.
