# TODOs: environment cleanup and server refactors

This document tracks the next three refactoring steps we want to do in sequence.

## Working rule for all three steps

- Do the work in order.
- Each step gets its own branch.
- Each next branch is created from the previous completed branch.
- Before moving to the next step:
  - update tests
  - run the relevant test/build commands
  - confirm manual QA
  - write a short outcome document in `PRODUCT/`

---

## Step 1 — remove leftover skill-injection-era architecture

### Branch
- `refactor/remove-skill-injection-legacy`

### Goal
Make the environment model the only supported path for dynamic capability loading.

### Why this is first
Right now the codebase still mixes:
- environment-derived skill loading
- old skill injection persistence and approval concepts
- helper code and UI paths that exist only because the old model used to matter

That split makes the architecture harder to reason about. The product direction is environment-first, so we should remove the legacy path instead of continuing to carry both models.

### Scope
Remove or simplify legacy pieces related to skill injection where they are no longer needed, including reviewing:
- `agent-server-client/src/server/skillInjectionStore.ts`
- `agent-server-client/src/server/index.ts` skill-injection routes
- `agent-server-client/src/client/skillInjection.ts`
- any bookmarklet/postMessage-based skill injection UI flow
- README/docs text that still presents skill injection as a live supported architecture
- tests that only exist for legacy skill injection behavior

### Desired outcome
After this step:
- dynamic capability loading is explained and implemented through environments
- no major runtime path depends on legacy skill injection concepts
- remaining parent-window messaging exists only for live host interaction, not for old skill injection approval flow
- the codebase is easier to read because “environment” is the dominant concept

### Required validation before moving on
- tests updated and passing
- build passing
- manual QA notes written in:
  - `PRODUCT/step-1-remove-skill-injection-legacy-outcome.md`

### Manual QA to include in the outcome doc
- start app
- open a normal chat session
- verify session startup still works
- verify environment registration/approval still works (for example Wikipedia)
- verify environment preview/approval UI still works
- verify no removed skill-injection paths are still referenced by the main UI/server flow

---

## Step 2 — split and simplify `agent-server-client/src/server/index.ts`

### Branch
- `refactor/split-server-index`

### Branching rule
Create this branch **after Step 1 is complete**, branching from `refactor/remove-skill-injection-legacy`.

### Goal
Reduce `src/server/index.ts` so it is mainly:
- server/bootstrap wiring
- route registration
- top-level dependency construction

### Why this is second
Once legacy skill-injection code is gone, it will be much easier to separate the real API surface cleanly.

### Scope
Refactor `index.ts` by extracting obvious responsibilities, likely into some combination of:
- route modules
- route registration helpers
- room creation/reuse helper(s)
- request parsing/validation helpers if needed

The exact filenames can be decided during implementation, but the architecture should clearly push toward:
- API layer in route files
- service/domain behavior in session/environment managers
- persistence in repository/store files

### Desired outcome
After this step:
- `index.ts` is substantially smaller
- routes are easier to scan
- environment endpoints are clearly grouped
- agent/session endpoints are clearly grouped
- server wiring is easier to modify without touching domain logic

### Required validation before moving on
- tests updated and passing
- build passing
- manual QA notes written in:
  - `PRODUCT/step-2-split-server-index-outcome.md`

### Manual QA to include in the outcome doc
- start server successfully
- start a new agent session
- resume an existing session
- verify websocket/replay still works
- verify environment register / unavailable / decision / preview endpoints still work
- verify Chrome-extension-driven environment availability still works end to end

---

## Step 3 — reduce `SessionRoom` responsibilities

### Branch
- `refactor/extract-session-room-responsibilities`

### Branching rule
Create this branch **after Step 2 is complete**, branching from `refactor/split-server-index`.

### Goal
Shrink `agent-server-client/src/server/realtime/SessionRoom.ts` so it is less of a kitchen-sink coordinator.

### Why this is third
This file sits on the hot path for:
- agent runtime interaction
- replay
- websocket fan-out
- environment offer state
- runtime rebuild behavior

It is manageable now, but it will get risky quickly unless its responsibilities are separated.

### Scope
Refactor toward a clearer split between:
- session event persistence/fan-out responsibilities
- environment-offer/session UI state
- runtime rebuild / active-skill-set management

Potential extracted objects may include:
- a runtime coordinator/controller
- a room-state helper for unresolved offers and environment-driven state
- queue/replay helpers if that creates a cleaner boundary

The exact extraction should be driven by the code that remains after Steps 1 and 2.

### Desired outcome
After this step:
- `SessionRoom` is smaller and easier to reason about
- room lifecycle, replay, and runtime rebuild logic have clearer boundaries
- future environment/runtime work has a better place to live

### Required validation before completion
- tests updated and passing
- build passing
- manual QA notes written in:
  - `PRODUCT/step-3-session-room-refactor-outcome.md`

### Manual QA to include in the outcome doc
- normal chat run still works
- replay/reconnect still works
- environment approval still appears in all relevant open clients for the same session
- resolving an environment offer in one client closes it in the others
- environment enter/exit still rebuilds runtime correctly
- idle shutdown / resume still works

---

## Suggested command checkpoints

From `agent-server-client/` after each step:

```bash
npm test
npm run build
```

If needed, also run manual environment checks with:

```bash
../scripts/inject-environment.sh demo:demo
```

---

## Current status

- Active branch now: `refactor/extract-session-room-responsibilities`
- Step 1 is complete.
- Step 2 is complete.
- Step 3 is complete.
- Validation completed for Step 3:
  - `cd agent-server-client && npm test`
  - `cd agent-server-client && npm run build`
- Outcome docs written:
  - `PRODUCT/step-1-remove-skill-injection-legacy-outcome.md`
  - `PRODUCT/step-2-split-server-index-outcome.md`
  - `PRODUCT/step-3-session-room-refactor-outcome.md`
- Planned three-step refactor sequence is complete.
