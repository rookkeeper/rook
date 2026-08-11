# Mac client stall investigation

Status: complete for the observed cross-Rook beachball failure.

The strongest evidence was a roughly 41-second `activeTabURL` Accessibility lookup from one Rook process into another Rook process. Generic perception was treating an internal Rook window like an external browser and synchronously walking an AX tree that could not contain a useful browser URL.

The mitigation is now in place:

- production and development Rook bundle IDs are excluded from foreground environment inspection;
- the active external provider is stopped when an internal Rook window becomes frontmost;
- `AXReader` refuses internal Rook targets as a defense-in-depth guard;
- Safari and Firefox use an explicit browser specialist for nested URL discovery;
- generic and Electron paths no longer perform browser-tree URL traversal;
- environment AX reads run away from the main actor with bounded messaging and traversal deadlines;
- slow AX operations log only safe diagnostic metadata.

Manual validation with the new isolated build and the main build confirmed that both clients still observed the other's environments and were much snappier, without the previous long pause. The Mac test suite passes with the watchdog and regression coverage included.

No production server or database behavior changed. Process sampling remains a recurrence-only follow-up if another stall appears, and explicit bridge text/action perception remains a separate AX path from environment inspection.
