# Mac client stall investigation

> **TODO 1 — first step completed:** PR #139 added the local Mac stall watchdog and diagnostic logging. The wider cause remains under investigation. This is the working document; do not create an `OUTCOMES.md` until the beachball investigation is actually finished.

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

- [ ] Add a Mac-local diagnostics/watchdog component with a unique client-instance identifier and a monotonic heartbeat.
- [ ] Run the watchdog from a background queue and emit one unified-log warning per detected stale-heartbeat episode.
- [ ] Record safe contextual metadata and the last registered operation label without collecting user-facing content.
- [ ] Integrate heartbeat updates with the Mac app's main-actor lifecycle and diagnostics-relevant operations.
- [ ] Add focused tests for stale-heartbeat detection, recovery, duplicate suppression, and configurable thresholds.
- [ ] Document how to inspect the watchdog records with macOS unified-log tools and how to correlate multiple client instances.
- [ ] Run the appropriate macOS tests/build checks and confirm they pass.
- [ ] Review the final diff for leftover backward-compatibility code, compatibility documentation, fallback paths, temporary shims, abandoned experiments, and other no-longer-needed transitional code.
- [ ] Remove all unnecessary backward-compatibility code and compatibility documentation rather than keeping it around.
- [ ] Update `AS-BUILT-ARCHITECTURE/` as needed.
- [ ] Update `PRODUCT/` as needed.

## TODO 2 — Remove Rook from environment inspection and audit generic AX perception

Event 002 found a roughly 41-second `activeTabURL` lookup against the other Rook process. That exposed a broader design issue beyond the watchdog: generic perception can treat another Rook instance as an external app, apply browser-specific Accessibility behavior to it, and block the main actor while searching for a URL that cannot exist there.

### Immediate safeguard

- [ ] Define one internal-Rook bundle-ID predicate that covers the production app and all worktree/development Rook bundle IDs.
- [ ] Make `ForegroundAppMonitor` ignore every internal Rook activation, not only `Bundle.main.bundleIdentifier`.
- [ ] Ensure the generic and specialist environment providers never inspect or register another Rook instance as a user environment.
- [ ] Decide what happens to the currently active provider when an internal Rook window becomes frontmost; it must stop polling the previous external app rather than retaining that target PID.
- [ ] Add tests covering production Rook, worktree Rook, and ordinary external-app bundle IDs.

### Generic AX perception audit

- [x] Probe representative installed members of the WebKit, Chromium, Gecko, and Electron families using only focused-window `AXDocument`, `AXFilename`, and top-level `AXURL` values.
- [x] Record whether those top-level signals reliably identify the current page URL and satisfy the intended `web:` environment detection; use sanitized values and do not log browsing history into this document.
- [ ] If the top-level signals meet the requirement, remove `activeTabURL` and Chromium priming from the generic path rather than preserving a speculative browser fallback.

#### Manual browser-family probe — August 11, 2026

Using Safari, Chrome, Firefox, and Slack with `https://example.com/` as the browser test page:

- **Safari/WebKit:** top-level `AXDocument`, `AXFilename`, and `AXURL` did not provide the page URL; nested `AXWebArea` did.
- **Chrome/Chromium:** top-level `AXDocument` provided the page URL; nested `AXWebArea` returned the same URL. `activeTabURL` appears redundant for Chrome in this run.
- **Firefox/Gecko:** top-level attributes did not provide the page URL; nested `AXWebArea` did.
- **Slack/Electron:** top-level values were empty/non-useful; nested `AXWebArea` exposed Slack's internal web URL. Slack already has a specialist detector, so this does not by itself justify generic browser URL discovery for Electron apps.

The initial result is therefore not “delete `activeTabURL` everywhere.” It is: top-level signals are sufficient for Chrome but not Safari or Firefox, so nested URL discovery is still needed if generic `web:` detection must support those browsers. The next design decision is whether to keep it only for an explicit browser allowlist and exclude Electron/non-browser apps entirely.

- [ ] Optionally repeat the Chromium test with a second fork such as Edge, Brave, Arc, or Vivaldi before finalizing the allowlist.
- [ ] If a browser genuinely requires nested URL discovery, isolate it behind an explicit browser/Electron allowlist or capability check and document the failing browsers and exact reason.
- [ ] Ensure generic document/path discovery remains separate from browser-only URL discovery.
- [ ] Move Chromium accessibility-tree priming out of the generic `focusedWindow` read path; only prime targets that need it.
- [ ] Audit synchronous AX calls for per-call timeouts, main-actor blocking, repeated tree reads, and safe off-main-actor execution.
- [ ] Reproduce with one Rook and with two Rooks, then capture nested AX timings or stacks to distinguish a pathological Rook AX tree from a cross-process wait.

## Exit criteria

- [ ] A blocked Mac main actor produces a useful local unified-log warning without requiring the main actor to run.
- [ ] A healthy client does not emit repeated false warnings during normal timer jitter.
- [ ] Two running clients have distinguishable diagnostic instance IDs.
- [ ] Tests cover the watchdog's state transitions and the relevant Mac build/test checks pass.
- [ ] The implementation does not collect private window or transcript content and does not alter server behavior.
