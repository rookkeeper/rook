# Apple client logging overhaul

Status: complete.

The Mac and iPhone clients now use the shared RookKit unified-logging and performance helpers instead of mixing ad-hoc logging styles. Beachball-adjacent Mac paths, shared session/network code, and iPhone session/location flows emit structured operational diagnostics with quieter default verbosity and optional verbose context logging.

The Mac log viewer and Apple-client documentation now describe the authoritative unified-log workflow. Focused Apple-client tests and builds pass. The existing stale iPhone `ArrivalGateTests` target references old `RookModel` APIs and remains a pre-existing test-target issue, recorded in the working TODO.

This work intentionally changes no server logging, protocol, database, or product environment model. The logging foundation enabled the follow-up Mac stall investigation documented in `CHANGES/2026-08-11-mac-client-stall-investigation/`.
