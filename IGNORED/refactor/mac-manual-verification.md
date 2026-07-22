# Mac manual verification checklist

Use this before, during, and after major refactor steps.

## Server state

- [x] Launch the Mac app with server already running
- [x] Confirm server reaches `online`
- [x] Launch the Mac app with server stopped
- [x] Confirm server shows offline/starting correctly
- [x] Start the managed server from the app
- [x] Stop the managed server from the app
- [x] Confirm online/offline transitions do not loop or get stuck

## Sessions

- [x] Load agents successfully
- [x] Load sessions successfully
- [x] Start a new session
- [x] Resume an existing session
- [x] Confirm auto-resume still works when expected

## Chat

- [x] Send a normal message
- [x] Confirm user block appears immediately
- [x] Confirm assistant streaming text renders correctly
- [x] Confirm thinking blocks still render correctly
- [x] Confirm tool call blocks still render and update correctly
- [x] Confirm plan updates still render correctly
- [x] Confirm usage updates still render correctly
- [x] Cancel a running turn
- [x] Confirm cancelled runs show stable final UI state
- [x] Confirm queued messages still deliver when the agent becomes idle

## Connection / reconnect

- [ ] While attached to a session, simulate a connection loss
- [ ] Confirm reconnect behavior starts automatically
- [ ] Confirm the session reloads after reconnect
- [ ] Confirm queued messages are not lost during reconnect
- [ ] Confirm connection-loss errors are still surfaced appropriately

## Environment flow

- [x] Switch between normal Mac apps and confirm app environments update
- [x] Confirm app-only environment derivation still produces expected `mac:` IDs
- [ ] Switch to a supported browser and confirm `web:` environments appear
- [ ] Confirm hierarchical browser URL environments still derive correctly
- [ ] Switch to Obsidian and confirm vault-derived environment behavior still works
- [x] Confirm dwell timing still prevents immediate duplicate emits
- [x] Confirm repeated title/context refreshes do not cause noisy duplicate registration
- [x] Confirm environment flow still works after server offline/online transitions

## Environment offers

- [x] Receive an environment offer
- [x] Confirm the offer view opens correctly
- [x] Approve an offer
- [x] Reject/defer an offer
- [x] Confirm queued offers still advance correctly

## Environment list

- [x] Open the environment list
- [x] Confirm list loading works
- [x] Confirm auto-refresh works
- [x] Join an environment
- [x] Leave an environment
- [x] Confirm socket-driven entered/exited state stays in sync with the list

## Feature removals during this refactor

### Voice/hotkey
- [x] Confirm voice UI/state is removed or intentionally absent
- [x] Confirm chat still works normally without voice hooks

### Bridge/computer control
- [x] Confirm bridge/computer-control UI/state is removed or intentionally absent
- [x] Confirm environment flow still works after bridge-adjacent removal

### Permissions
- [x] Confirm any removed permission UI/state is gone
- [ ] If permissions remain for environment flow, confirm request/check behavior still works
