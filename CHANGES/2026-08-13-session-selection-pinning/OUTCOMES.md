# Outcomes

- Added durable server-owned pinned state/order and shared Pinned/Recent session selection across Mac, iPhone, and Android.
- Added Mac available-height layout and drag/drop pinning; mobile clients use native Pin/Unpin actions.
- Validation passed for server, RookKit, iPhone, and Mac. Android remains deferred because no Java runtime is installed.
- PR [#156](https://github.com/rookkeeper/rook/pull/156) merged as `be93d9b18b2d75cb5633b2b7e9a0af9a56398052`.
- GitHub issue #150 closed by the merge. Issue #129 remains open; its remaining arbitrary manual-reorder scope is superseded by the pinned/recent model.
- Starting planning commit: `c8dd427`. Cleanup is deferred because the implementation worktree still hosts a live server process; no server was stopped.
