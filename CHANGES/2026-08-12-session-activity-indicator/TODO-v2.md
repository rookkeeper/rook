# Session selection activity pill

## Context

Show reliable background activity on the session-selection page without changing the chat experience.

## Implementation lessons

- Keep activity presentation exclusively in the session-selection list.
- Leave the chat footer/status line unchanged; it remains the place for live protocol details such as tool calls.
- Poll the visible main session-selection list every 5 seconds; do not poll from per-agent lists or chat views.
- Refresh rows in place without showing a loading state or repainting the surrounding screen.
- Keep the per-agent session list free of activity pills; its rows only select a session.
- Let the server provide the state. Clients must not infer it from selection or socket state.

## Decisions

- The session pill displays `Active`, `Ready`, `Error`, `On`, or `Off` from `activityStatus`.
- `Active` has priority over pending attention; `Ready` and `Error` persist until the user opens the session.
- Opening a session acknowledges pending attention. Automatic resume does not.
- The server derives the status from turn lifecycle, runtime liveness, and durable attention state.

## Work checklist

- [ ] Keep server turn tracking, durable attention, touch acknowledgment, and activity-status API behavior.
- [ ] Keep the pill only on the main session-selection page across supported clients.
- [ ] Remove activity polling and activity presentation from per-agent session pages and chat views.
- [ ] Add quiet 10-second selection-page refreshes that update existing rows without loading/repaint glitches.
- [ ] Preserve existing chat status text and tool-call reporting.
- [ ] Add focused tests for state precedence, acknowledgment, polling updates, and stable selection-page rendering.
- [ ] Run server, shared-client, and available native-client validation.
