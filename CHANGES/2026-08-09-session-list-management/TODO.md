# Session rename, delete, and recent-view ordering

## Context

We want the session list to feel manageable after creation without turning it into a complex custom organizer.

For this chunk:

- users can rename sessions on Mac, iPhone, and Android
- users can delete sessions on Mac, iPhone, and Android
- session ordering should reflect most recently viewed sessions, not just message activity
- newly created sessions should appear at the top
- opening/resuming a session should move it to the top even if no new prompt is sent

This affects the shared server session APIs plus all three native clients. It does **not** include pinning or arbitrary manual drag reordering.

## Details

Today the server only exposes session list + transcript REST routes, while the clients treat the session rows mostly as resume buttons. The backend already has internal delete plumbing via `AgentRuntimeManager.closeSession()` and `SqliteSessionRepository.delete()`, but there is no public session-management API for rename/delete and no explicit "mark this session as viewed" operation.

The current list order is `updated_at DESC`. That can likely remain the storage/sort mechanism for this first release if we make "viewed" an explicit touch/update event rather than inventing a new ordering model immediately. The important product rule is the behavior the user sees: creating or opening a session moves it to the top.

The session space is shared across clients, so rename/delete/view ordering metadata should be stored server-side and flow through the existing REST session list contract.

Platform UX direction for this first pass:

- **Mac:** keep row click as resume; add secondary management affordances such as context menu and/or subtle trailing actions on hover
- **iPhone:** keep rows visually simple; use swipe actions and/or long-press context menu; rename should happen in a lightweight rename prompt/sheet
- **Android:** keep row tap as resume; use overflow menu and/or long-press menu; rename should happen in a lightweight dialog

Delete semantics for v1:

- deleting a running session is allowed
- the server should close the runtime, remove transcript/session persistence, and remove any session workspace state
- deleting the currently open session should take the client back out of that chat cleanly
- first pass can be true deletion rather than a trash model

Rename semantics for v1:

- empty or whitespace-only rename input should not persist as empty; keep/fall back to `session`
- renaming the current session should update visible headers/session rows promptly
- rename should be a lightweight management action, not a permanently editable row state

Important files likely involved:

- `server/src/sessions/routes/sessionRoutes.ts`
- `server/src/sessions/repositories/SessionRepository.ts`
- `server/src/sessions/repositories/SqliteSessionRepository.ts`
- `server/src/runtime/services/AgentRuntimeManager.ts`
- `clients/RookKit/Sources/RookKit/Net/RookAPI.swift`
- `clients/RookKit/Sources/RookKit/Models/ApiTypes.swift`
- `clients/mac/Sources/Models/RookMacChatSessionController.swift`
- `clients/mac/Sources/Views/RookView.swift`
- `clients/iphone/Sources/RookModel.swift`
- `clients/iphone/Sources/Views/SessionsScreen.swift`
- `clients/android/app/src/main/java/com/rookery/rook/net/RookApi.kt`
- `clients/android/app/src/main/java/com/rookery/rook/RookViewModel.kt`
- `clients/android/app/src/main/java/com/rookery/rook/ui/AgentPickerScreen.kt`

## Steps

- [ ] Confirm and document the v1 behavior boundaries in this change set: rename everywhere, delete everywhere, recent-view ordering, and no pin/manual reorder.
- [ ] Extend the server session domain with explicit operations for rename, delete, and mark-as-viewed/touch so the product behavior is modeled intentionally rather than as a GET side effect.
- [ ] Add public REST routes for session management (rename, delete, and viewed/touch) and keep the session list response shape aligned with the existing client models.
- [ ] Update server-side session tests to cover rename persistence, destructive delete behavior, and recent-view ordering based on the chosen touch/view operation.
- [ ] Update shared Apple client networking in `RookKit` to call the new session-management APIs and expose any updated session fields cleanly.
- [ ] Update Mac session flow so creating or opening a session records it as most recently viewed, and add session row management UI for rename/delete without breaking the primary click-to-resume interaction.
- [ ] Update iPhone session flow so creating or opening a session records it as most recently viewed, and add native-feeling rename/delete affordances that keep the card layout visually simple.
- [ ] Update Android session flow so creating or opening a session records it as most recently viewed, and add native-feeling rename/delete affordances that keep tap-to-resume as the primary action.
- [ ] Handle current-session edge cases consistently across clients: renaming the active session updates visible labels immediately, and deleting the active session exits chat/list state cleanly.
- [ ] Refresh session lists/state after rename/delete/view operations so the acting client reflects the new title/order immediately; decide whether any additional passive refresh is needed for non-acting clients in v1.
- [ ] Add or update focused client tests for the new state-management behavior where the existing Swift/Kotlin test harnesses make that practical.
- [ ] Update relevant READMEs and product/architecture notes if the public session-management contract or session ordering semantics are now meaningfully different.
- [ ] Run tests/build/typecheck appropriate to the change run and pass.
- [ ] Review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code.
- [ ] Remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around.
- [ ] Update `AS-BUILT-ARCHITECTURE/` as needed.
- [ ] Update `PRODUCT/` as needed.

## Exit criteria

- [ ] Mac, iPhone, and Android users can rename any session from the session list without the rows becoming permanently busy/editable.
- [ ] Mac, iPhone, and Android users can delete any session, including the currently open one, with clean navigation/state handling.
- [ ] Newly created sessions appear at the top of the list.
- [ ] Opening/resuming a session moves it to the top even when no new prompt is sent.
- [ ] Session ordering behavior is consistent because it is stored on the server and returned through the shared session list API.
- [ ] Server tests cover rename/delete/recent-view ordering behavior.
- [ ] Client behavior is covered by focused tests or clearly justified manual verification where automated coverage is impractical.
- [ ] Architecture/product docs and README surfaces match the final session-management behavior.
