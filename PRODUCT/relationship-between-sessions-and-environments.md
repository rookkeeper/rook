# Relationship between sessions and environments

A session is one public Rook conversation backed by one ACP runtime subprocess. An environment is a context such as a website, physical location, app surface, or project directory. A session may explicitly enter multiple environments.

## Session-selection organization

The shared session-selection view has two sections:

- **Pinned** — sessions with durable server-owned pin state, shown above Recent and excluded from it.
- **Recent** — all unpinned sessions, sorted by `updatedAt` descending.

Pinning or unpinning does not change recency. Mac supports dragging a row into Pinned; iPhone and Android expose Pin/Unpin through native row-management actions. Empty pinned guidance is platform-specific and should describe only that platform's available action.

## Session-selection activity

The session-selection list displays the server-authoritative `activityStatus`:

- `Active` — an ACP turn is in progress.
- `Ready` — a turn completed successfully and has not been acknowledged.
- `Error` — a turn failed and has not been acknowledged.
- `On` — the runtime is alive with no pending attention.
- `Off` — the runtime is not alive with no pending attention.

The precedence is `Active` > `Ready` > `Error` > `On` > `Off`. Opening a session acknowledges `Ready` or `Error`; automatic resume does not. The visible main selection list refreshes quietly every five seconds. Chat status text and tool-call details remain separate from this pill.

## Bundle decisions

The user decides on bundles, not individual capabilities. Decisions are keyed by the exact canonical content hash:

- **Accept** — allow this bundle for the current session/visit.
- **Ignore** — skip it for the current session/visit.
- **Approve** — persist approval for this exact bundle content hash across future sessions.
- **Reject** — persist rejection for this exact bundle content hash across future sessions.

Only `approve` and `reject` are stored durably in the application database. `accept` and `ignore` are session-scoped in memory. Personal bundles are trusted user content and bypass the offer flow.

A changed agent-visible bundle content hash is a new reviewable bundle, even if its publisher or bundle id is unchanged.

## How a session consumes environments

1. A provider registers an environment candidate.
2. The server resolves known repository environments and matching bundles.
3. The session explicitly enters an environment.
4. Offers are presented for undecided non-personal bundles.
5. Accepted/approved or personal bundles are linked/materialized into the session workspace.
6. The runtime is restarted with the agent workspace as cwd when environment membership changes. Pi receives one-run project approval for that generated workspace so non-interactive ACP startup discovers `.agents/skills`; this is separate from the bundle decision flow.

The session does not implicitly enter parent environments, and availability does not itself load capabilities.

## Session isolation

Each public session has its own ACP runtime subprocess, disposable agent workspace links, entered-environment membership, and ephemeral accept/ignore decisions. Writable SQLite sources can be shared by multiple sessions; project sources are linked directly. The durable approve/reject record is application-wide by content hash. Thus approving a canonical bundle in one session can make it eligible in another session, but the second session must still explicitly enter the environment.

## Restart behavior

Environment changes update the session's links and generated aggregate, start a replacement runtime, and only retire the old process after successful ACP session loading. Shared file edits are watched and do not independently require runtime restart. Transcript and session membership remain durable.

Concurrent edits to one personal bundle are currently last-write-wins/deferred; conflict merging is future work.
