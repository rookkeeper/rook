# Session list management UX

We want to make old sessions manageable after creation:

- rename a session
- delete a session
- move/reorder sessions

This touches all three native clients:

- Mac
- iPhone
- Android

## What exists today

Right now the session list is basically a launcher/resumer.

- Mac: click a row to resume
- iPhone: tap a row to resume
- Android: tap a row to resume
- server: only list sessions and fetch transcript
- ordering: sessions are listed by `updated_at DESC`

So rename/delete/reorder are not just UI tweaks. They need product semantics and server support.

## Main UX constraint

These rows are small and high-frequency. We probably should not make every platform use the same visible controls.

A good rule here is:

- keep the row itself primarily for **open/resume**
- put management actions in **secondary affordances**
- use **native platform conventions** rather than forcing one pattern everywhere

## My current instinct

### Rename

This feels worth doing everywhere.

It is low-risk, easy to understand, and solves a real pain point without making the list noisy.

### Delete

Also worth doing everywhere, but with confirmation and maybe special handling for the currently running session.

### Reorder

This is the trickiest one.

The current model is "recent sessions". Drag-reordering implies "user-owned manual ordering." Those are different concepts.

Before building drag, we should decide whether the list is supposed to be:

1. a recents list
2. a manually curated list
3. a hybrid (for example pinned sessions first, then recents)

My leaning is that **full arbitrary drag ordering is probably not the best first move**.

A better first product shape may be:

- **Pinned** sessions at the top
- **Recent** sessions below, still sorted by activity

That gets most of the value of "move this where I want it" without fighting recency semantics all the time.

## Recommended first-pass product shape

### Shared model

Add session management capabilities in this order:

1. rename
2. delete
3. pin / unpin
4. only later decide whether full manual drag ordering is still needed

If we do pinning, the list becomes:

- Pinned
- Recent

This also gives a much cleaner cross-platform story than arbitrary drag reorder.

## Platform-specific UI ideas

### Mac

Mac can carry a little more UI density.

Best candidates:

- row hover reveals small action buttons
  - rename
  - pin/unpin
  - delete
- right-click / control-click context menu with the same actions
- double-click or Enter still resumes
- rename opens inline text field or a tiny popover/sheet

I would **not** make the whole card always editable.

My preference:

- normal row stays stable
- on hover, show subtle trailing controls
- also offer context menu for discoverability and power use

For drag on Mac, if we eventually support pinning or manual ordering:

- drag handle appears only in an explicit edit/reorder mode, or only for pinned items
- do not make the default row feel draggable all the time

That avoids accidental drags when the primary action is still "open this chat."

### iPhone

I agree that making the small cards visibly editable would be too busy.

Best candidates:

- trailing swipe: delete
- leading swipe: rename or pin
- long-press context menu: Rename, Pin/Unpin, Delete
- rename happens in a simple confirmation dialog with text field, or a small sheet

My preference for iPhone:

- keep the row visually simple
- use **swipe actions** for common actions
- use **long-press menu** for the full set

That gives both discoverability and cleanliness.

If we later support pinning, iPhone can also support:

- drag only inside a dedicated Edit mode for the pinned section
- or no drag at all, just pin/unpin

### Android

Android should probably mirror the iPhone in spirit, but use Android-native patterns.

Best candidates:

- trailing overflow menu on each row, or long-press menu
- swipe-to-delete if it feels solid in Compose
- maybe swipe-to-pin if that reads clearly
- rename via dialog

My preference for Android:

- overflow/long-press for rename + pin/unpin + delete
- optional swipe-to-delete later if it feels good

Android drag-reorder is possible, but it is usually better when there is an obvious dedicated reorder state or handle.

## Why I like pinning better than free reorder

Pinning answers the real question more directly:

"Keep these chats where I can get to them."

Free reorder creates harder product questions:

- if a session gets new activity, does it stay where the user dragged it?
- if manual order exists, is `updated_at` still meaningful for sorting?
- do all sessions become reorderable, even hundreds of them?
- how do we expose reorder on iPhone and Android without making the UI annoying?
- what does drag mean when some sessions are running and some are not?

Pinning is much easier to explain:

- pinned stays where the user put it
- everything else stays in recents

## Delete behavior questions

We need to decide:

- can you delete a running session?
- if yes, do we stop the runtime first and then remove the record?
- if you delete the currently open session, where does the client navigate?
- do we want a soft-delete/trash concept, or true deletion?

My instinct:

- yes, allow delete
- if running, stop/close it first, then remove it
- if currently open, navigate back to the session list / agent picker after deletion
- first pass can be true deletion if we are comfortable with that

## Rename behavior questions

We need to decide:

- can the default auto-title still exist? yes
- do we let users rename to empty string? probably no; fall back to `session`
- can the current session be renamed while open? probably yes
- should rename update immediately in the chat header too? yes

## Data / API implications

We likely need explicit session-management APIs, not just UI work.

Probably something like:

- `PATCH /api/sessions/:id` for rename and maybe pin/order metadata
- `DELETE /api/sessions/:id` for deletion

If we do pinning/manual order, the session table likely needs more metadata, such as:

- `pinned_at` or `is_pinned`
- maybe `manual_order`

If we only do rename/delete first, the backend change is much smaller.

## Suggested rollout

### Option A: smallest useful release

1. Add rename
2. Add delete
3. Use native secondary actions on each platform
4. Leave ordering as recents

### Option B: better likely release

1. Add rename
2. Add delete
3. Add pin/unpin
4. Show sections: Pinned and Recent
5. Delay full drag reorder

### Option C: full custom ordering

1. Add rename/delete
2. Add manual ordering model
3. Add drag UI on Mac
4. Add edit-mode reordering on iPhone/Android

This is the most expensive and highest-risk option.

## My recommendation

I would recommend **Option B**.

That means:

- **Mac:** hover actions + context menu
- **iPhone:** swipe actions + long-press menu
- **Android:** overflow/long-press menu, maybe swipe later
- **Shared behavior:** rename, delete, pin/unpin
- **List model:** pinned first, recents second

That feels powerful without making the session rows noisy or weird.

## If we insist on drag

If Jon really wants drag specifically, I would still scope it narrowly:

- only drag within the pinned section
- or only drag in an explicit Edit/Reorder mode
- do not combine always-draggable rows with single-tap-to-open rows

That combination usually feels sloppy.

## Open questions

- Is the real need "reorder anything" or "keep a few important sessions at the top"?
- Should delete be permanent in v1?
- Should running sessions be deletable immediately?
- Should rename be inline on Mac, but dialog/sheet on phones?
- Does Android want swipe actions, or is overflow-menu-first cleaner?
- Do we want session metadata to be shared across all clients immediately?

## Working conclusion for now

The safest, cleanest cross-platform design is probably:

- keep rows simple
- keep tap/click as resume
- add secondary management actions using native conventions
- ship rename + delete first
- strongly consider pinning instead of full manual reorder
