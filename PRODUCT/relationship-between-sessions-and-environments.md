# Relationship between sessions and environments

A session is one public Rook conversation backed by one ACP runtime subprocess. An environment is a context such as a website, physical location, app surface, or project directory. A session may explicitly enter multiple environments.

## Bundle decisions

The user decides on bundles, not individual capabilities. Decisions are keyed by the exact canonical content hash:

- **Accept** — allow this bundle for the current session/visit.
- **Ignore** — skip it for the current session/visit.
- **Approve** — persist approval for this exact revision across future sessions.
- **Reject** — persist rejection for this exact revision across future sessions.

Only `approve` and `reject` are stored durably in the application database. `accept` and `ignore` are session-scoped in memory. Personal bundles are trusted user content and bypass the offer flow.

A changed agent-visible bundle content hash is a new reviewable revision, even if its publisher version or bundle name is unchanged.

## How a session consumes environments

1. A provider registers an environment candidate.
2. The server resolves known repository environments and matching bundles.
3. The session explicitly enters an environment.
4. Offers are presented for undecided non-personal bundles.
5. Accepted/approved or personal bundles are materialized into the session workspace.
6. The runtime is restarted with the new skill paths and generated instructions.

The session does not implicitly enter parent environments, and availability does not itself load capabilities.

## Session isolation

Each public session has its own ACP runtime subprocess, materialized capability workspace, entered-environment membership, and ephemeral accept/ignore decisions. The durable approve/reject record is application-wide by content hash. Thus approving a canonical bundle in one session can make it eligible in another session, but the second session must still explicitly enter the environment.

## Restart behavior

Environment changes do not mutate an existing runtime's files in place. Rook synchronizes writable edits, rebuilds the workspace from repository content, starts a replacement runtime, and only retires the old process after successful ACP session loading. Transcript and session membership remain durable.

Concurrent edits to one personal bundle are currently last-write-wins/deferred; conflict merging is future work.
