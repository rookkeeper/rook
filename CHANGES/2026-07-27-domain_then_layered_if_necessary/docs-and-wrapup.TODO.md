# Docs and wrap-up TODO

This chunk happens after the code moves are complete and behavior has already been verified.

## Goals

- Update documentation to reflect the new as-built server organization.
- Keep product docs unchanged unless a minimal correction is absolutely necessary.
- Remove temporary migration scaffolding and unused exports.
- Do final verification.

## AS-BUILT-ARCHITECTURE

- [x] Update `AS-BUILT-ARCHITECTURE/server.md` heavily to describe the new domain-first organization.
- [x] Update `AS-BUILT-ARCHITECTURE/README.md` only if wording about server structure needs adjustment.
- [x] Update `AS-BUILT-ARCHITECTURE/database.md` only where file-location/layering descriptions changed.
- [x] Keep `android-client.md`, `iphone-client.md`, `mac-client.md`, and `rookkit.md` unchanged unless a server path reference truly requires it.

## PRODUCT

- [x] Review `PRODUCT/` files for accidental conceptual drift caused by the refactor.
- [x] Keep `PRODUCT/` unchanged if possible.
- [x] If any product file must change, keep the edit minimal and explain why it was unavoidable.
- [x] Make sure product docs still describe the same behavior because this refactor must not change behavior.

## Final cleanup

- [x] Remove temporary bridge exports.
- [x] Remove obsolete empty directories from the old layer-first layout.
- [x] Normalize imports and naming.
- [x] Confirm tests remain readable after path moves.

## Final verification

- [x] `npm run typecheck --prefix server`
- [x] `npm run build --prefix server`
- [x] `npm run test --prefix server`
- [x] Sanity-check server startup.
- [x] Sanity-check route registration.
- [x] Sanity-check one representative session flow and one representative environment/location flow.
