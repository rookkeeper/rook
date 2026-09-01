# Outcomes

- Rook now serializes Pi ACP session-mapping mutations across public sessions and waits for active prompts before environment-driven runtime replacement.
- Added regression coverage and updated server/product architecture documentation.
- PR [#183](https://github.com/rookkeeper/rook/pull/183) merged into `main` as `042858f`.
- The upstream `pi-acp` cross-process persistence fix remains follow-up work; this change mitigates Rook-managed processes only.

Starting commit: `22e9292` (`origin/main` before this work).
Ending merge commit: `042858f`.
