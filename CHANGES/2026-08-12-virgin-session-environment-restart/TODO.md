# Virgin session environment restart (issue #151)

## Context

Joining an environment restarts the session's runtime via `session/load`. The claude
adapter implements `session/load` as a hard resume of the persisted Claude Code
transcript, and Claude Code writes that transcript lazily on first prompt — so a
never-prompted session has nothing to resume, the load fails with `-32002 Resource not
found`, and the session is permanently bricked (environment membership is already
recorded, the runtime is dead, every later prompt fails). Reproduced and diagnosed in
issue #151. Any runtime with lazy persistence would fail the same way; the assumption
lives in our restart path.

## Decision details

- Fix in `restartSessionForEnvironmentChange` (`server/src/runtime/services/AgentRuntimeManager.ts`).
- Keep `session/load` as the happy path, unchanged.
- On load failure, fall back to `session/new` **only when the session's transcript
  contains no content events** (no `user_message_chunk`, `agent_message_chunk`,
  `agent_thought_chunk`, or `tool_call` — `run_failed` markers alone do not count as
  content). This preserves the existing guarantee that a load failure never silently
  discards conversation history: the fallback fires only when there is provably no
  history to lose. It also heals sessions already bricked by this bug, whose
  transcripts hold only `run_failed` markers.
- The `session/new` fallback reuses the session's existing `cwd` and the new
  environment configuration. If the runtime returns a different runtime session id,
  persist it on the session record.
- When no transcript repository is configured, keep today's behavior (rethrow).
- Non-goals: no adapter/`claude-agent-acp` changes; no change to the join-membership
  ordering (membership recorded before restart); no client changes.

## Work checklist

- [ ] Reactive fallback in `restartSessionForEnvironmentChange`: on load failure,
      check transcript for content events; if none, `session/new` with same cwd and
      new configuration, verify/update `runtimeSessionId`, replace the runtime.
- [ ] Persist a changed `runtimeSessionId` via the session repository.
- [ ] Log the fallback distinctly (info: virgin session recreated for environment
      change; keep the load error in the log entry).
- [ ] Helper to classify transcript content events, colocated with the transcript
      event definitions in `sessionTranscriptEvents.ts` if that is its natural home.
- [ ] Tests (vitest, mock runtime patterns from `acpFacade.test.ts`): load succeeds →
      unchanged path; load fails + empty transcript → recreated via session/new; load
      fails + `run_failed`-only transcript → recreated; load fails + transcript with
      user/agent content → rethrows and closes replacement; `session/new` returning a
      new id → record updated.
- [ ] `npm run typecheck` and `npm test` in `server/` pass.
