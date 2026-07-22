# iPhone manual regression checklist

Use this while refactoring the Mac model to make sure shared behavior does not drift.

## Server state

- [x] Launch the iPhone app with server available
- [x] Confirm server reaches `online`
- [ ] Launch with server unavailable
- [ ] Confirm offline/unauthorized behavior still works as expected
- [ ] Confirm refresh/reattach behavior still works after app foregrounding

## Sessions

- [x] Load agents successfully
- [x] Load sessions successfully
- [x] Start a new session
- [x] Resume an existing session
- [x] Confirm current session and chat visibility behavior still works

## Chat

- [x] Send a normal message
- [x] Confirm user block appears immediately
- [x] Confirm assistant streaming text renders correctly
- [x] Confirm thinking blocks still render correctly
- [x] Confirm tool call blocks still render and update correctly
- [x] Cancel a running turn
- [x] Confirm cancelled runs show stable final UI state
- [x] Confirm queued messages still deliver when the agent becomes idle

## Connection / reconnect

- [ ] While attached to a session, background and foreground the app
- [ ] Confirm reconnect behavior still works
- [ ] Confirm the session remains usable after reconnect
- [ ] Confirm queued messages are not lost

## Environment offers

- [x] Receive an environment offer
- [x] Approve an offer
- [x] Reject/defer an offer
- [x] Confirm offer state clears or advances correctly

## Environment list

- [x] Open the environment list
- [x] Confirm list loading works
- [x] Join an environment
- [x] Leave an environment
- [x] Confirm entered/exited state still stays in sync with the UI

## Place/location-specific behavior

- [ ] Confirm place environment behavior still works as it did before the Mac refactor
- [ ] Confirm nearby candidate handling still works
- [ ] Confirm place reannouncement still works after app activation

## Drift checks against Mac refactor

- [ ] Confirm session semantics have not unintentionally diverged from Mac
- [ ] Confirm offer/list behavior has not unintentionally diverged from Mac in shared concepts
- [ ] Confirm no server-state regressions were introduced by Mac-side controller extraction
