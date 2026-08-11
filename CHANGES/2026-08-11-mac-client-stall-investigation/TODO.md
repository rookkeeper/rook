# Mac client stall watchdog

> **TODO 1 — first step only:** This change is the first increment of an ongoing stall investigation. It adds diagnostic logging and a main-thread watchdog so the next occurrence gives us better evidence; it does not claim to fix or fully explain the stall. Keep this `CHANGES/` directory open for follow-up investigation rather than creating an `OUTCOMES.md` for this step.

## Context

Implement the highest-value diagnostic piece from the stall investigation: a local macOS client watchdog that can report when the main actor/main thread stops making progress. The watchdog should help distinguish a main-thread stall from a broader macOS lifecycle or system pause without adding telemetry throughout the application.

This is diagnostic-only. It must not send telemetry remotely, capture window contents, change Accessibility behavior, or alter the production server/database. The first implementation should remain focused on the Mac client and use structured local logging.

## Details

The watchdog should:

- maintain a lightweight heartbeat from the main actor
- monitor that heartbeat from a background queue that can continue while the main actor is blocked
- emit a high-priority unified-log record when the heartbeat is stale for a configurable threshold
- include only diagnostic metadata: client instance ID, last known operation label, foreground app/PID if available, app visibility state if available, Accessibility trust state if available, and server/session identifiers if available
- avoid logging window titles, URLs, screen text, transcript content, or other private content
- avoid duplicate warning spam during one continuous stall, then permit a new warning after recovery
- provide enough context to correlate two simultaneously running Rook clients

The watchdog should expose a small testable core for heartbeat age/stall detection, while the process/lifecycle integration remains in the Mac client. It should be possible to exercise detection logic without sleeping for several seconds in a unit test.

The first pass does not need automatic `sample`/spindump capture or AX-call instrumentation. Those can be added later if the watchdog establishes that the main actor is stalling but the cause remains unclear.

## Steps

- [x] Add a Mac-local diagnostics/watchdog component with a unique client-instance identifier and a monotonic heartbeat.
- [x] Run the watchdog from a background queue and emit one unified-log warning per detected stale-heartbeat episode.
- [x] Record safe contextual metadata and the last registered operation label without collecting user-facing content.
- [x] Integrate heartbeat updates with the Mac app's main-actor lifecycle and diagnostics-relevant operations.
- [x] Add focused tests for stale-heartbeat detection, recovery, duplicate suppression, and configurable thresholds.
- [x] Document how to inspect the watchdog records with macOS unified-log tools and how to correlate multiple client instances.
- [x] Run the appropriate macOS tests/build checks and confirm they pass.
- [x] Review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code.
- [x] Remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around.
- [x] Update `AS-BUILT-ARCHITECTURE/` as needed; no architecture change was needed.
- [x] Update `PRODUCT/` as needed; this diagnostic-only change does not alter product behavior.

## Exit criteria

- [ ] A blocked Mac main actor produces a useful local unified-log warning without requiring the main actor to run.
- [ ] A healthy client does not emit repeated false warnings during normal timer jitter.
- [x] Two running clients have distinguishable diagnostic instance IDs.
- [x] Tests cover the watchdog's state transitions and the relevant Mac build/test checks pass.
- [x] The implementation does not collect private window or transcript content and does not alter server behavior.
