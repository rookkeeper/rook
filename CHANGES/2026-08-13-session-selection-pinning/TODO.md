# Session pinning — fresh implementation

## Context

Reimplement session pinning from the current baseline commit `7d7b2a7`.

An earlier implementation was merged as PR #156 and later reverted by PR #158. The existing `OUTCOMES.md` records that historical attempt; it is not evidence that pinning is present in the current code. This plan deliberately starts over against the current ACP-only transcript architecture and the session behavior that remains on `main`.

Pinning should give users a durable way to keep important sessions easy to find while preserving the existing server-owned recency, activity, rename, delete, and resume behavior.

## Decision details

- The implementation starts from commit `7d7b2a7`, not from the reverted pinning commits or the old implementation worktree.
- Pin state and pinned order are server-owned and durable so Mac, iPhone, and Android share one session organization.
- The session-selection UI has two sections: `Pinned` followed by `Recent`.
- Pinned sessions are excluded from Recent. Recent sessions retain the existing server recency ordering by `updatedAt DESC`.
- Pinned sessions use durable `pinnedOrder`; pinning and reordering do not change recency.
- Newly created sessions start unpinned.
- Pinning and unpinning are explicit secondary actions. Existing click/tap-to-resume, rename, delete, activity status, session touch, and chat behavior remain intact.
- Mac supports drag-and-drop into Pinned, positional reordering within Pinned, and dragging a pinned session back to Recent to unpin it and move it to the top of recents. Mac should use available session-list height without making rows permanently draggable or adding noisy handles.
- iPhone and Android support native-feeling Pin/Unpin actions. Mobile drag reordering is out of scope.
- The global session-selection surfaces show the shared Pinned/Recent organization. Per-agent session lists must not duplicate or contradict the global organization; keep them focused on selecting sessions for that agent.
- The implementation must remain compatible with the current ACP-only playback model. It must not restore server transcript persistence, REST transcript hydration, or any other reverted compatibility path.
- Arbitrary manual ordering of all sessions remains out of scope. This change uses pinning as the deliberate replacement for that portion of issue #129.

## Work checklist

### Plan and baseline

- [x] Inspect the current session repository, REST contract, shared client models, and all three global session-selection surfaces at `7d7b2a7`.
- [x] Create a fresh implementation worktree and branch from the planning commit; do not reuse the reverted pinning implementation branch.

### Server and shared session contract

- [x] Add migration-safe durable pin state and pinned ordering to the current session schema and repository.
- [x] Define and implement pin/unpin and pinned-order operations without changing session recency unless the explicit Mac drag-to-Recent behavior requires a touch.
- [x] Expose pin state/order and the necessary management operations through the session REST API.
- [x] Add server tests for persistence, migration initialization, pin/unpin, pinned ordering, list partitioning, recency preservation, deletion, and malformed or conflicting order requests.
- [x] Update RookKit and Android session models/networking for the shared pin fields and operations.

### Client behavior

- [x] Update the Mac global session-selection UI with Pinned and Recent sections, available-height layout, secondary Pin/Unpin actions, positional drag/drop, drag-out unpinning, empty-section messaging, and restrained drop feedback.
- [x] Update iPhone with Pinned and Recent sections and native Pin/Unpin actions without adding mobile drag handles or gestures.
- [x] Update Android with Pinned and Recent sections and Pin/Unpin actions through the existing overflow/menu pattern.
- [x] Preserve existing activity pills only where they currently belong, preserve chat status presentation, and ensure rename/delete/touch/resume refreshes do not lose pin state or order.
- [x] Add focused client/model/UI tests or documented manual checks for partitioning, stable pinned ordering, pin/unpin refreshes, deletion, and recency behavior.

### Documentation, compatibility, and validation

- [x] Update relevant PRODUCT, AS-BUILT-ARCHITECTURE, and package README documentation for the server-owned pinned/recent contract and platform behavior.
- [x] Inspect every changed file for retained compatibility surfaces; annotate any intentionally retained compatibility behavior or record that none exists.
- [x] Run focused server, RookKit, Mac, and iPhone validation; Android build remains blocked because no Java runtime is installed.
- [x] Run final validation, inspect the diff and lifecycle record, and record deferred Android validation explicitly.
