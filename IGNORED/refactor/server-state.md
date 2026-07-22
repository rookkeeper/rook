# Server state refactor

## Scope

- [x] Extract server lifecycle state out of `RookMacModel`
- [x] Move health polling ownership into a dedicated controller
- [x] Move online/offline/starting transitions into one place
- [x] Keep session/agent loading triggers explicit
- [ ] Keep the server-state boundary compatible with current iPhone behavior where practical, without forcing shared extraction now

## Current responsibilities in `RookMacModel`

- [ ] Own server status UI state
- [ ] Poll health on a timer
- [ ] Start/stop managed server
- [ ] React to server-online transitions
- [ ] Trigger agent/session loading when server becomes healthy

## Target component

- [x] `ServerStateController`

## Proposed responsibilities

- [x] Own `serverState`
- [x] Own `managedServerRunning`
- [x] Own health timer lifecycle
- [x] Expose callbacks/events for `didBecomeOnline` and `didBecomeOffline`
- [x] Expose explicit lifecycle methods such as `start()`, `stop()`, and `refreshNow()`
- [x] Hide polling details from `RookMacModel`

## Dependencies

- [x] `RookAPI`
- [x] `ServerController`
- [x] callbacks into composition root for follow-on actions

## Extraction steps

- [x] Add a Mac manual verification checklist for online/offline/starting transitions before refactoring
- [ ] Compare the extracted boundary against `RookModel.refreshHealth()` so shared semantics do not drift unnecessarily
- [x] Move health timer setup out of `RookMacModel.init`
- [x] Move `refreshHealth()` logic into `ServerStateController`
- [x] Move `startServer()` and `stopServer()` orchestration into the controller
- [x] Add explicit lifecycle entry points such as `start()`, `stop()`, and `refreshNow()`
- [x] Replace direct state mutation in `RookMacModel` with controller output bindings

## Risks

- [ ] Avoid creating loops between server-online callbacks and reconnect/session-loading behavior
- [x] Keep environment emission hook on server-online explicit
- [ ] Avoid making the Mac controller depend too much on local-server management details if later iPhone-aligned extraction is desired
