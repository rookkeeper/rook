# Outcomes

- Merged PR #152 (`b4f73ce`), merged by the maintainer after integrating the fix
  with the runtime-liveness machinery from #169.
- Joining an environment no longer permanently bricks a never-prompted session:
  when the replacement runtime's `session/load` fails and the session's durable
  `prompted` flag is false, the server recreates the runtime session via
  `session/new` and persists the new runtime session id. Prompted sessions keep
  the strict behavior (close the replacement and rethrow) so history is never
  silently discarded.
- Mid-flight redesign: the original fix proved "never prompted" from the server
  transcript store; when the transcript-replay redesign removed that store, the
  evidence source was reworked to a durable `prompted` column on the sessions
  table (set when a prompt is first forwarded; pre-existing databases backfill
  to `1` so unknown history counts as real history).
- Deferred follow-up (unfiled): after a server restart, opening a never-prompted
  session replays `session/load` through `requestForSession` and fails the same
  way — same root cause, different entry point; the durable flag added here
  would serve that fix too.

Starting commit: `6c804db`
Ending merge commit: `b4f73ce`
