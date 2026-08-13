# Session selection and pinned sessions

**Status: direction confirmed; implementation plan recorded in `TODO.md`**

## Problem

The session-selection UI has two related problems:

1. On the Mac selection view, the session list is constrained to its row-content height instead of using the available window height.
2. Important sessions cannot be kept separate from the recency-sorted list.

The desired product shape is a pinned section above the normal recent-session section. Pinned sessions should not be duplicated in Recent. An empty pinned section should explain how to populate it, for example: **“Drag sessions here to pin.”**

This work is tracked primarily by GitHub issue #150 (pinned sessions) and the remaining session-list work in #129 (manual drag/reorder). The completed portions of #129—server-authoritative activity status, recency ordering, rename, and delete—should not be reopened. If pinning replaces arbitrary reorder, the final PR should explain and close the remaining reorder portion of #129 as superseded by #150.

## Investigation

### Current layout

- Mac `HomeContent` and `SessionsDetail` render a `ScrollView` inside a `PanelCard`, but both cap the list to approximately seven row heights (`sessionsMaxHeight` / `sessionListHeight`). The home view also uses content-sized window sizing outside chat mode. This is the likely reason the list looks short. The fix should make the list/card participate in available-height layout rather than merely increasing the row cap, while preserving a sensible minimum/initial window size.
- iPhone `SessionsHomeScreen` already has a full-screen outer `ScrollView`; its session card currently grows only to its content height. The pinned and recent sections should remain one outer scroll surface, not introduce a nested scroll view.
- Android `SessionsHomeScreen` already uses a full-screen `LazyColumn`; its session card is a normal item. Sections can be represented as items in that same lazy list.

### Current session data flow

- The server owns the session list in SQLite and returns `updatedAt`, runtime state, and `activityStatus` from `GET /api/sessions`.
- `SessionRecord` has no pin metadata today. Pin state therefore needs a server-side durable field so Mac, iPhone, and Android see the same organization.
- Existing session management already has REST routes and client methods for rename, touch, and delete. Pin/unpin should be an explicit REST operation or a clearly modeled extension of the session-management route; it should not be inferred from client-only state.
- All three clients have a shared primary row action (click/tap resumes) and secondary rename/delete actions.

## Options and questions

### List semantics

**Preferred:** use a hybrid list:

- **Pinned**: pinned sessions, kept out of Recent; initially sorted by the same recency key as the regular list.
- **Recent**: every unpinned session, sorted by server `updatedAt DESC`.

This gives pinning a stable “keep this easy to find” meaning without introducing a second ordering model. It also makes the pinned section look and behave like the existing session list. A future explicit reorder feature could add ordering metadata later, but arbitrary manual order is not needed to deliver pinning.

Questions to confirm:

- Should pinned sessions also be recency-sorted, or should pin order be preserved? Recommendation: recency-sort them for this first pass, unless the user specifically wants a curated order.
- Should a newly created session be automatically pinned? Recommendation: no.
- Should opening/touching a pinned session change its position? Recommendation: yes, if both sections use recency ordering; pinning only changes the section.
- Should pinning update recency? Recommendation: no. Pin/unpin changes organization, not “last viewed.”

### Mac interaction

The Mac is the best place for direct drag-and-drop, but a normal row should remain primarily a resume target.

Confirmed direction:

- Support click-and-drag from a session row into the Pinned drop zone/section to pin it.
- Do not make rows look like a reorder editor or add a permanent drag handle.
- Keep a visible pin/unpin action in the existing row actions menu (and/or on hover) so pinning is discoverable and accessible without drag.
- Drop feedback should be restrained: highlight the Pinned section/empty box while dragging, then show a short state change.
- Because pinned items are recency-sorted, dragging within Pinned should not imply manual ordering.
- The empty-state instruction should be Mac-specific: **“Drag sessions here to pin.”**

A native SwiftUI `draggable`/`dropDestination` path is preferable to gesture logic that competes with the row’s click action. The exact API and minimum macOS deployment target need checking before implementation.

### iPhone interaction

Long press is not a good replacement for drag-and-drop on iPhone: it is discoverable only after experimentation and can conflict with scrolling. iOS supports native drag/drop, but dragging a row into a small empty section is harder to discover and less reliable than an explicit action.

Confirmed direction:

- Make Pin/Unpin available through the existing row management surface: long-press context menu and/or swipe action.
- Do not make drag the only way to pin.
- Do not add a permanent pin icon and drag handle to every row.
- Use the iPhone-specific pinned empty-state instruction **“Pin a session to keep it here.”**
- Keep the pinned and recent sections inside the existing outer `ScrollView` to avoid nested-scroll behavior.

### Android interaction

Android should follow the same product semantics but use Compose-native discoverable controls.

Confirmed direction:

- Use the existing overflow menu for Pin/Unpin, Rename, and Delete; consider long-press as an additional shortcut only if it does not hide the action.
- Treat drag-and-drop as deferred, not the primary Android interaction.
- Do not add a permanent drag handle to the default row.
- Use the Android-specific pinned empty-state instruction **“Pin a session to keep it here.”**
- Keep both sections in the existing full-screen `LazyColumn`, with no nested list.

### Visual separation

Use the existing row component in both sections. Separate sections with only a modest hierarchy change:

- section header: `Pinned` with a pin icon and `Recent` with a clock icon
- a small vertical gap and/or a subtle divider between sections
- the empty pinned state as a dashed/subtle bordered drop target on Mac (and on mobile only if drag is supported), with muted instructional text
- do not use a second heavy card style that makes the screen feel like two unrelated lists

When there are no sessions at all, retain the existing “No sessions yet” empty state. The “Drag sessions here to pin” empty box is specifically for the case where sessions exist but none are pinned.

## Direction

Confirmed direction:

- Implement durable server-side pin state shared by all clients.
- Render `Pinned` above `Recent`; exclude pinned sessions from Recent; sort both sections by the existing server recency ordering for the first release.
- Make the Mac session list/card consume available height instead of using a fixed seven-row cap; preserve the window’s sensible minimum height and scrolling for overflow. Apply this to the session-selection surfaces that currently use the constrained list layout.
- Mac: direct row drag into Pinned plus an explicit Pin/Unpin secondary action. Empty pinned instruction: **“Drag sessions here to pin.”**
- iPhone: explicit Pin/Unpin through native secondary actions; mobile drag is not required for the first release. Empty pinned instruction: **“Pin a session to keep it here.”**
- Android: overflow-menu Pin/Unpin; mobile drag is deferred. Empty pinned instruction: **“Pin a session to keep it here.”**
- Use a restrained section header/divider and a contextual empty pinned drop target.
- Keep issue #150 and #129 linked in the implementation plan and final PR; close #150 when shipped and close or explicitly supersede the remaining manual-reorder scope in #129.
