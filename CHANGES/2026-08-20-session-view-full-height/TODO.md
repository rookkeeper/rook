# Full-height session selection

## Context

Make the Mac home screen's pinned/recent session selection area use all available vertical space instead of stopping at a fixed height, so the view scales with the Rook home window.

## Decision details

- Stretch the Mac home session list to the available height while preserving scrolling for overflowing sessions.
- Keep the existing pinned/recent sections, drag-and-drop behavior, row actions, and compact empty states unchanged.
- Limit the change to the Mac client layout; no server, protocol, or data-model changes are needed.

## Work checklist

- [ ] Update the home session-selection layout to accept and fill available vertical space.
- [ ] Add or adjust focused validation for the layout behavior if the existing Mac test surface supports it.
- [ ] Review changed files for compatibility surfaces and documentation impact.
- [ ] Run focused validation, inspect the diff, and complete lifecycle records.
