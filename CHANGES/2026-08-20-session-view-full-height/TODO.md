# Full-height session selection

## Context

Make the Mac home screen's pinned/recent session selection area use all available vertical space instead of stopping at a fixed height, so the view scales with the Rook home window. Preserve the existing development profile's user-local state when seeding a new worktree profile, including the application database.

## Decision details

- Stretch the Mac home session list to the available height while preserving scrolling for overflowing sessions.
- Keep the existing pinned/recent sections, drag-and-drop behavior, row actions, and compact empty states unchanged.
- Limit the UI change to the Mac client layout; no server, protocol, or data-model changes are needed.
- When a development profile is created, copy the production `~/.rook` application database into it and retain it rather than deleting it; later launches continue to leave the profile home unchanged.

## Work checklist

- [x] Update the home session-selection layout to accept and fill available vertical space.
- [x] Add or adjust focused validation for the layout behavior if the existing Mac test surface supports it. (No view-test target exists; validated with a Mac app build.)
- [x] Review changed files for compatibility surfaces and documentation impact. (No compatibility surface retained; the launcher preserves existing profile state but does not add a compatibility shim.)
- [x] Update launcher tests and relevant documentation for copied application-database state.
- [ ] Run focused validation, inspect the diff, and complete lifecycle records.
