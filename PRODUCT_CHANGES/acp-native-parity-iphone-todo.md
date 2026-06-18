# iPhone ACP native parity todo

## Goal
Bring the iPhone app to parity with the ACP-native web client for the client/UI surface that now lives in shared `RookKit`, with iPhone-specific glue and verification on top.

## Shared prerequisites the iPhone app depends on
- [ ] Make `clients/RookKit/Sources/RookKit/Net/AcpSocket.swift` ACP-native at web parity instead of handling a narrower translated event set.
- [ ] Add first-class shared handling for `session/request_permission`.
- [ ] Add shared handling for `session/set_mode` and `current_mode_update`.
- [ ] Add shared handling for `session/set_config_option` and `config_option_update`.
- [ ] Preserve ACP extension points, including `_meta` and custom `_...` methods.
- [ ] Add `_rookery/steering_prompt` support as a shared client capability.
- [ ] Extend shared usage parsing to keep optional `cost` alongside context usage.
- [ ] Bring shared tool-call normalization up to web parity, including provider differences and empty `{}` raw IO cases.
- [ ] Audit shared stop-reason handling so `cancelled` is modeled as a clean stop, not a generic error.
- [ ] Keep shared queue state rich enough for edit, delete, and send-now flows.

## iPhone model/state glue
- [ ] Audit `clients/iphone/Sources/RookModel.swift` against the ACP-native web reducer behavior.
- [ ] Add iPhone model state for permission prompts, including pending request details and approve/deny actions.
- [ ] Add iPhone model state for ACP modes and current mode updates.
- [ ] Add iPhone model state for ACP config options and live option updates.
- [ ] Store and surface richer stop reasons in iPhone state.
- [ ] Store and surface usage cost in addition to context usage counts.
- [ ] Expose an iPhone action for `_rookery/steering_prompt` / send-now behavior.
- [ ] Expand queued-message state so queued items can be edited before send.
- [ ] Expand queued-message state so queued items can be promoted to immediate send while a run is in flight.

## iPhone UI work
- [ ] Add a visible permission-prompt UI for `session/request_permission`.
- [ ] Add ACP mode controls to the iPhone chat/settings UI.
- [ ] Add ACP config-option controls to the iPhone chat/settings UI.
- [ ] Put ACP settings behind a compact gear affordance instead of always showing them inline.
- [ ] Avoid repeated mini-label + picker-label duplication in the ACP settings UI; keep the control labels compact.
- [ ] Show usage cost anywhere the iPhone app already shows context usage/status.
- [ ] Keep usage/context indicators colocated with chat status in a compact right-justified cluster.
- [ ] Surface stop/cancel semantics clearly in the UI so cancelled runs read as intentionally stopped.
- [ ] Ensure assistant markdown actually renders as markdown, including code blocks / fenced content, not plain text only.
- [ ] Ensure tool-call rendering matches web expectations after normalization changes.
- [ ] Fix tool-argument streaming so snapshot-style updates do not get appended repeatedly; only real deltas should accumulate.
- [ ] Add queue item editing affordances.
- [ ] Keep queue delete behavior working after queue-state changes.
- [ ] Add queue send-now affordances that route through steering-prompt support.
- [ ] Add scroll behavior parity: auto-scroll while streaming by default, pause it when the user scrolls away, resume on the next user send or when the user returns to the bottom.
- [ ] Verify plan blocks still render correctly after the broader ACP pass.
- [ ] Verify any iPhone-specific resume/deep-link flows still land in the right chat after the ACP/state changes.

## Verification
- [ ] Run the busy-agent queued-message test flow and verify queue edit works.
- [ ] Run the busy-agent queued-message test flow and verify queue delete works.
- [ ] Run the busy-agent queued-message test flow and verify send-now / steering works mid-turn.
- [ ] Verify stop uses `session/cancel` and the UI ends in a clean cancelled state.
- [ ] Verify permission prompts appear and actions round-trip correctly.
- [ ] Verify mode changes round-trip and `current_mode_update` stays in sync.
- [ ] Verify config-option changes round-trip and `config_option_update` stays in sync.
- [ ] Verify usage updates include cost when the server sends it.
- [ ] Verify tool calls with odd raw IO still render sensibly.
- [ ] Final-check the iPhone app against the ACP overview items: `session/prompt`, `session/update`, `session/request_permission`, `session/cancel`, `session/set_mode`, `session/set_config_option`, plans, tool calls, usage/context, stop reasons, and extension points.
