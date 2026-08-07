# Generated location skill versus old direct prompt renderer

**Architecture area:** location context delivery.

**Status:** Resolved: the unused direct renderer was removed and product documentation now describes skill-bundle delivery.

## Current implementation

`LocationRegistrar` writes a generated `SKILL.md` and serves it through `LocationContextRepository`, so the location context reaches the agent as a normal environment bundle. This is the current repository-facade path described by the architecture.

## Older implementation still present

`server/src/location/LocationContextSkill.ts:63-78` still implements `renderLocationContextText()`, a concise direct prompt-injection representation. Repository-wide search found no caller. The active writer only uses `renderLocationContextSkill()` (`:29-50`) to create the skill file.

The old direct text function also contains the old “PUSHED into the agent” model, while the current architecture says location context is delivered through the normal environment bundle.

## Assessment

The function is orphaned relative to the current as-built runtime path. However, `PRODUCT/location-environment-awareness.md` explicitly expects a concise best-guess/nearby summary to be pushed into agent context. This means the function may be an uncompleted product seam rather than safe compatibility code. It must not be deleted until the product expectation is either implemented through the current bundle path or intentionally removed from product documentation.

## Cleanup decision needed

Reconcile the product requirement with the current architecture first. If generated skill context is the accepted replacement, remove `renderLocationContextText()` and update the product note; if direct context remains required, wire a safe, tested current implementation and rename the function away from the old PUSH model. Retain `isConfidentMatch()` only in a clearly owned shared location contract.

## TODOs

- [x] Confirm there are no dynamic imports or external consumers of `renderLocationContextText()`.
- [x] Decide whether the product requires direct context injection in addition to the generated skill.
- [x] If not required, update the product note and delete the renderer and obsolete tests.
- [x] If required, define and test the current safe injection path before removing the old seam.
- [x] Verify generated location bundles and location registration tests.
