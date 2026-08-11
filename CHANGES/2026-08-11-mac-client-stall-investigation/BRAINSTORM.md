# Mac Client Stall Investigation

This is a collaborative notebook for tracking down long beachball / responsiveness stalls in the macOS Rook client. We are investigating before choosing an implementation direction.

The main question is: **which synchronous call, system service, or lifecycle condition can stop the Mac client long enough that its UI and health polling both appear frozen?**

Use **observed-data entries** for observations from logs, reproductions, samples, and experiments. Keep observations separate from hypotheses; a later event may overturn an earlier explanation.

## Scope and constraints

- Focus first on the macOS client and its interaction with macOS Accessibility, Automation, HID, WindowServer, and app lifecycle services.
- Do not assume that a server request gap means the server was unhealthy.
- Keep the production server/database on port `7665` untouched during experiments.
- The isolated development profile may be used for reproduction.
- The logical-transcript persistence work is separate; the small transcript observed in this event does not explain the stall.

## Event 001 — Observed data: synchronized Rook pause around August 11, 2026 at 1:37 PM

### What was observed

- The isolated development server had no client requests from **13:36:55.099 to 13:37:49.116** — a 54-second gap.
- The server process remained alive and healthy. After the gap, health requests arrived in a burst and completed immediately.
- The production server on port `7665` showed a similar client-request gap: approximately **13:36:56 to 13:37:48**.
- Two Mac Rook processes were involved:
  - development client: PID `14315`
  - production-like client: PID `2925`
- macOS unified logs reported slow HID responses for both processes:
  - `Rook [14315]: slow hid response (17.4s)`
  - `Rook [2925]: slow hid response (28.1s)`
- The same period included Accessibility/TCC authorization activity, an AppleScript authorization request, and RunningBoard visibility changes.
- The current session contained only 14 transcript records, so transcript replay/database volume was not a plausible explanation for this particular pause.

### What this establishes

The server was not obviously stalled: it continued to answer requests quickly when requests arrived, and its own timers/logging continued. The missing requests came from the client side or from macOS suspending/blocking the clients before their timers could issue requests.

The fact that both Rook clients paused at nearly the same time is important, but it is not yet proof that both were blocked in the same Rook call. It could indicate a shared macOS service or system event, or it could be a red herring caused by both clients having the same foreground-app/perception architecture and being affected together.

### Current hypothesis

The leading Rook-specific hypothesis is a synchronous Accessibility call blocking the macOS main actor/main thread. The relevant path currently includes:

- `ForegroundAppMonitor.poll()` and `emitContext(for:)`
- `AppEnvironmentProvider.handleForegroundApp(...)`
- `AppEnvironmentProvider.logRawContext(...)`
- `AXReader.focusedWindowTitle(...)`
- `AXReader.focusedWindowDocumentValues(...)`
- `AXReader.activeTabURL(...)`, which walks an Accessibility tree
- generic and specialized provider polling
- Finder provider AppleScript work

These calls run from main-actor-driven timers or callbacks and have no explicit timeout. If a target application or macOS Accessibility/TCC service stops answering, both the UI and unrelated main-actor work such as health polling could appear frozen. Two Rook processes performing the same calls against the same system services could explain the synchronized symptoms.

### Important uncertainty

We do **not** yet have a stack sample proving that `AXReader` or a particular Accessibility API call was executing during the 54-second interval. The HID and TCC evidence may instead point to a broader WindowServer, HID, permission, or application-visibility problem. The next investigation should capture the call stack while the stall is active rather than infer it only from request gaps.

## Investigation ideas

- Add entry/exit timing around every synchronous AX operation, including the target PID and attribute being read.
- Add timing around foreground activation, context refresh, generic-provider polling, specialist-provider polling, Finder AppleScript, and health refresh.
- Capture `sample`/spindump output for both Rook processes during a reproduced stall.
- Correlate client logs with macOS unified logs using process IDs and precise timestamps.
- Reproduce with only one Rook client running, then with both clients running, to test whether the synchronized pause depends on duplicate foreground monitors.
- Reproduce while changing focus among Chromium, Zed, Finder, Terminal, and an app with Accessibility permission disabled.
- Check whether the pause occurs when Accessibility is trusted but the target app has a slow or unavailable AX tree.
- Determine whether RunningBoard visibility changes merely explain delayed health timers or are a consequence of the main-thread stall.
- Treat the server's request gap as a symptom until a client-side stack or timing trace proves otherwise.

## Telemetry direction for the next occurrence

A useful first pass can be low-risk instrumentation rather than a large logging overhaul:

1. **Structured operation timing.** Wrap every synchronous AX and AppleScript operation with a monotonic start/end measurement. Log the operation name, target PID, foreground bundle ID, result code, and duration. Use `Logger`/unified logging and keep window titles, URLs, and document contents out of the diagnostic record.
2. **Main-thread heartbeat watchdog.** Update a heartbeat from the main actor and monitor it from a background queue. If it stops advancing for 2–5 seconds, emit a high-priority record containing the last known operation, app visibility state, frontmost PID, Accessibility trust state, and server/session identifiers. A watchdog warning can still be emitted while the main thread is stuck inside an AX call.
3. **Open-operation tracking.** Give each potentially blocking operation an ID and log its start before entering the system API. If no completion arrives, the open record identifies the call that was in flight even when the main actor never returns.
4. **Lifecycle correlation.** Log app active/inactive, hide/unhide, sleep/wake, foreground-app changes, TCC permission changes, and health-timer firings with process IDs and monotonic plus wall-clock timestamps.
5. **Reproduction-time stack capture.** When the watchdog fires, capture a `sample`/spindump for the affected Rook process if practical. This is the piece most likely to turn the AX hypothesis into proof.
6. **One-client versus two-client experiments.** Include a client-instance identifier in logs and repeat the same scenario with one Rook process, then both. That distinguishes a shared macOS stall from duplicate monitors amplifying one another.

The telemetry should be bounded and privacy-conscious: durations and identifiers by default, no screen text or window contents, and a small rotating local buffer or unified log retention rather than an indefinite transcript of activity.

## Open questions

- Did both clients call into Accessibility at the same moment, or were they independently suspended by macOS?
- Which process was frontmost and which Accessibility call was in flight at the beginning of the gap?
- Does `AXUIElementCopyAttributeValue` block for tens of seconds in this environment?
- Can Accessibility reads be isolated from the main actor and bounded with a timeout without weakening environment detection?
- Are AppleScript/TCC authorization prompts causal, incidental, or a separate event in the same system-wide stall?
- Is the production client required for reproduction, or does one client exhibit the same behavior alone?
