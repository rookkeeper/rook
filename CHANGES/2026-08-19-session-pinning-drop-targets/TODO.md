# Improve Mac session pinning drop targets

## Context

Make dragging the first session into an empty Pinned section easy to target and ensure insertion indicators disappear immediately after a session is pinned.

## Decision details

- Treat the whole empty Pinned section, including its header and empty-state area, as the drop target for pinning.
- Clear the Mac drag/drop target state whenever a drag establishes a pin or completes a pinned reorder, and ignore late hover updates after the drag source state is cleared.
- Keep existing insertion-line behavior while a drag is active and preserve current Recent/unpin behavior.
- This is a focused Mac UI fix; no changes to server ordering semantics or mobile clients.

## Work checklist

- [x] Expand the empty Pinned section drop target.
- [x] Clear stale insertion indicators after pinning/reordering.
- [x] Review relevant Mac documentation; existing drag/drop behavior documentation remains accurate.
- [x] Build and validate the Mac client and inspect the final diff.
