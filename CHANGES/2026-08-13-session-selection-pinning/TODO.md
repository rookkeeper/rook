# Session selection view and pinned sessions

## Context

Improve the session-selection experience across Mac, iPhone, and Android. The Mac session list currently does not use the available window height, and users need a durable way to keep important sessions separate from the recency-sorted list. This work implements the pinned-session feature tracked by GitHub issue #150 and resolves the remaining manual-reorder portion of issue #129 by choosing a simpler pinned/recent model.

## Decision details

- Store pin state on the server so all clients share the same session organization.
- Show a `Pinned` section above a `Recent` section. Pinned sessions are excluded from Recent.
- Sort both sections by the existing server recency ordering (`updatedAt DESC`) for this release. Pinning does not change recency.
- Do not automatically pin newly created sessions.
- Mac session-selection lists should use available height rather than a fixed seven-row height cap, while retaining sensible minimum window sizing and scrolling when content overflows.
- Mac supports click-and-dragging a row into the Pinned section, plus an explicit Pin/Unpin secondary action. Mac’s empty pinned instruction is: “Drag sessions here to pin.”
- iPhone supports Pin/Unpin through native secondary actions such as its row context/swipe management surface. Mobile drag is not required in this release. Its empty pinned instruction is: “Pin a session to keep it here.”
- Android supports Pin/Unpin through the existing overflow menu. Mobile drag is deferred. Its empty pinned instruction is: “Pin a session to keep it here.”
- Use modest section headers, spacing, and dividers, and avoid permanent drag handles or visually noisy rows.
- Keep existing click/tap-to-resume, rename, delete, activity status, and recency semantics intact.
- Keep issue #150 and #129 referenced in the implementation/PR; issue #150 should close when shipped, while the remaining arbitrary manual-reorder request in #129 should be explicitly marked superseded by this pinned-session model.

## Work checklist

### Server and shared model

- [x] Add durable pin metadata to the session repository/schema with migration-safe initialization.
- [x] Expose pin/unpin through the session REST API and include pin state in session summaries.
- [x] Add server tests for pin persistence, pin/unpin behavior, and list partitioning/order semantics.
- [x] Add shared Apple and Android session-model/API support for pin state and pin/unpin operations.

### Mac

- [x] Refactor the constrained session-selection list layout so it fills available height on the affected selection surfaces and still scrolls overflow.
- [x] Render Pinned and Recent sections without duplicate sessions, with restrained visual separation.
- [x] Add Mac pin/unpin secondary action and native row drag/drop into Pinned.
- [x] Add the Mac-specific empty pinned instruction and restrained drop feedback.

### iPhone and Android

- [x] Render Pinned and Recent sections in the existing single outer scroll containers.
- [x] Add platform-native Pin/Unpin secondary actions without permanent row clutter.
- [x] Add each platform’s specific empty pinned instruction; do not mention other platforms.
- [x] Defer mobile drag/reordering and avoid adding handles or gestures that compete with scrolling/tap-to-open.

### Documentation and validation

- [x] Add focused client tests or state-level coverage where practical, including partitioning and pin/unpin refresh behavior.
- [x] Update relevant READMEs, PRODUCT, and AS-BUILT-ARCHITECTURE documentation for the shared pinned-session contract and platform behavior.
- [x] Inspect changed files for compatibility surfaces and annotate retained compatibility behavior with the required marker, or record that none exist.
- [x] Run server, RookKit, Mac, and iPhone validation; Android validation is deferred because Java is unavailable. Inspect the final diff.
- [ ] Update issue references/closure notes for #150 and #129 after implementation is validated.
