# Outcomes

- ACP runtime history and `session/load` are now the sole session hydration path.
- Server transcript persistence, REST hydration, and compatibility paths were removed.
- Client-facing ACP notifications are bounded to 10 kB, and reconnect replay replaces cached state.
- Loaded session handles retain their sockets; cached Mac session reentry is immediate and concurrent loads are coalesced.
- Finder environment polling was moved off the main actor, bounded, and corrected to avoid slow AppleScript references.
- Validated with server tests/builds, RookKit tests, Mac tests/build, iPhone simulator build, and launcher tests. Android validation was not possible because Java was unavailable.

PR: #160, merge commit `15e0c9f2a0e052f8ee6a8937e4db7a56fc234e3c`.
Start commit: `e8a28e7`.
End implementation commit: `1c0dd6587dc5b5207a6293b265b52455cfd08438`.
